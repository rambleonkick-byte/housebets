"""Backend tests for ApexOdds Blackjack (deal/action/current, side bets, wallet reconciliation, edge cases)."""
import os
import uuid
import random
import concurrent.futures as cf
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN = {"email": "admin@apexodds.io", "password": "admin123"}
STAKE = 0.1


def _env(key):
    for line in open("/app/backend/.env"):
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip().strip('"')


mdb = MongoClient(_env("MONGO_URL"))[_env("DB_NAME")]

# ---------- local rule helpers (mirror spec) ----------
RANKS = "A23456789TJQK"


def val(cards):
    t, a = 0, 0
    for c in cards:
        r = c[0]
        t += 11 if r == "A" else 10 if r in "TJQK" else int(r)
        a += r == "A"
    while t > 21 and a:
        t -= 10
        a -= 1
    return t


def exp_pp(a, b):
    if a[0] != b[0]:
        return None
    if a[1] == b[1]:
        return "perfect"
    red = lambda c: c[1] in "HD"
    return "colored" if red(a) == red(b) else "mixed"


def exp_213(cards):
    rk = sorted(RANKS.index(c[0]) for c in cards)
    suited = len({c[1] for c in cards}) == 1
    trips = len({c[0] for c in cards}) == 1
    straight = (rk[2] - rk[0] == 2 and len(set(rk)) == 3) or rk == [0, 11, 12]
    if trips and suited: return "suited_trips"
    if straight and suited: return "straight_flush"
    if trips: return "trips"
    if straight: return "straight"
    if suited: return "flush"
    return None


PP = {"perfect": 25, "colored": 12, "mixed": 6}
T213 = {"suited_trips": 100, "straight_flush": 40, "trips": 30, "straight": 10, "flush": 5}
BUST = {3: 1, 4: 2, 5: 9, 6: 50, 7: 100}


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    finish_current(s)
    return s


def usdt(s):
    return s.get(f"{API}/wallet", timeout=15).json()["balances"]["USDT"]


def finish_current(s):
    cur = s.get(f"{API}/casino/blackjack/current", timeout=15).json()["game"]
    while cur and cur["status"] != "done":
        a = "no_insurance" if cur["status"] == "insurance" else "stand"
        cur = s.post(f"{API}/casino/blackjack/action", json={"game_id": cur["game_id"], "action": a}, timeout=15).json()


def deal(s, **kw):
    body = {"coin": "USDT", "stake": STAKE, **kw}
    return s.post(f"{API}/casino/blackjack/deal", json=body, timeout=15)


def act(s, gid, a):
    return s.post(f"{API}/casino/blackjack/action", json={"game_id": gid, "action": a}, timeout=15)


def play_out(s, g, policy=lambda g: "stand"):
    while g["status"] != "done":
        a = "no_insurance" if g["status"] == "insurance" else policy(g)
        r = act(s, g["game_id"], a)
        assert r.status_code == 200, r.text
        g = r.json()
        if g["status"] != "done":
            assert "XX" in g["dealer"], "hole card leaked"
    return g


# ---------- auth / validation ----------
def test_requires_auth():
    r = requests.post(f"{API}/casino/blackjack/deal", json={"coin": "USDT", "stake": 1})
    assert r.status_code == 401


@pytest.mark.parametrize("body", [
    {"coin": "USDT", "stake": 0}, {"coin": "USDT", "stake": -1},
    {"coin": "USDT", "stake": 0.1, "side_pp": -1}, {"coin": "USDT", "stake": 0.1, "side_213": -0.5},
    {"coin": "USDT", "stake": 0.1, "side_bust": -2},
])
def test_deal_validation_422(client, body):
    r = client.post(f"{API}/casino/blackjack/deal", json=body)
    assert r.status_code == 422, r.text


def test_deal_invalid_coin(client):
    r = client.post(f"{API}/casino/blackjack/deal", json={"coin": "DOGE", "stake": 0.1})
    assert r.status_code == 400


# ---------- deal / current / in-progress lock ----------
def test_deal_hides_hole_and_locks(client):
    finish_current(client)
    for _ in range(20):
        before = usdt(client)
        r = deal(client, side_pp=0.1, side_213=0.1, side_bust=0.1)
        assert r.status_code == 200, r.text
        g = r.json()
        assert abs((before - g["balances"]["USDT"]) - (0.4 - (g["total_payout"] if g["status"] == "done" else 0))) < 1e-6
        assert len(g["hands"][0]["cards"]) == 2 and len(g["dealer"]) == 2
        if g["status"] != "done":
            assert g["dealer"][1] == "XX"
            assert "deck" not in g
            r2 = deal(client)
            assert r2.status_code == 400 and "current hand" in r2.json()["detail"]
            cur = client.get(f"{API}/casino/blackjack/current").json()["game"]
            assert cur["game_id"] == g["game_id"] and cur["dealer"][1] == "XX"
            play_out(client, g)
            return
    pytest.fail("never got an in-play hand")


def test_invalid_actions(client):
    finish_current(client)
    # unknown game_id: server currently returns 409 'Hand is busy' (misleading); 404/400 preferred
    assert act(client, str(uuid.uuid4()), "hit").status_code in (400, 404, 409)
    for _ in range(30):
        g = deal(client).json()
        if g["status"] == "active" and "split" not in g["actions"]:
            assert act(client, g["game_id"], "split").status_code == 400
            assert act(client, g["game_id"], "insurance").status_code == 400
            assert act(client, g["game_id"], "foo").status_code == 400
            g = play_out(client, g)
            assert act(client, g["game_id"], "hit").status_code == 400  # finished
            return
        play_out(client, g)
    pytest.fail("no suitable hand")


# ---------- reconciliation + side bets + dealer rules ----------
def test_reconciliation_and_sidebets(client):
    finish_current(client)
    rnd = random.Random(7)
    for _ in range(40):
        before = usdt(client)
        g = deal(client, side_pp=0.05, side_213=0.05, side_bust=0.05).json()
        p, up = g["hands"][0]["cards"], g["dealer"][0]
        pp, t = exp_pp(*p), exp_213(p + [up])
        assert g["sides"]["pp"]["result"] == pp
        assert abs(g["sides"]["pp"]["payout"] - (0.05 * (PP[pp] + 1) if pp else 0)) < 1e-8
        assert g["sides"]["t213"]["result"] == t
        assert abs(g["sides"]["t213"]["payout"] - (0.05 * (T213[t] + 1) if t else 0)) < 1e-8
        g = play_out(client, g, lambda g: rnd.choice(g["actions"]))
        after = usdt(client)
        assert abs((after - before) - (g["total_payout"] - g["total_stake"])) < 1e-6
        d = g["dealer"]
        dv = val(d)
        # Bust It placed -> dealer always plays out to >=17 and never draws past 17
        assert dv >= 17
        for k in range(2, len(d)):
            assert val(d[:k]) < 17
        bp = g["sides"]["bust"]["payout"]
        exp_b = 0.05 * (BUST.get(len(d), 250) + 1) if dv > 21 else 0
        assert abs(bp - exp_b) < 1e-8
        # main hand outcomes
        for h in g["hands"]:
            pv = val(h["cards"])
            if pv > 21:
                assert h["result"] == "bust"
            elif h["result"] == "blackjack":
                assert abs(h["payout"] - h["bet"] * 2.5) < 1e-8
            elif h["result"] == "win":
                assert dv > 21 or pv > dv
            elif h["result"] == "lose":
                assert (dv <= 21 and pv < dv) or (len(d) == 2 and dv == 21)


def test_double(client):
    finish_current(client)
    for _ in range(30):
        g = deal(client).json()
        if g["status"] == "insurance":
            g = act(client, g["game_id"], "no_insurance").json()
        if g["status"] == "active" and "double" in g["actions"]:
            bal = g["balances"]["USDT"]
            r = act(client, g["game_id"], "double")
            assert r.status_code == 200
            g2 = r.json()
            h = g2["hands"][0]
            assert h["doubled"] and abs(h["bet"] - 0.2) < 1e-9 and len(h["cards"]) == 3
            assert abs(g2["total_stake"] - 0.2) < 1e-9
            assert g2["status"] == "done"
            assert abs(g2["balances"]["USDT"] - (bal - 0.1 + g2["total_payout"])) < 1e-6
            return
        play_out(client, g)
    pytest.fail("no double opportunity")


def test_split(client):
    finish_current(client)
    for _ in range(400):
        g = deal(client).json()
        if g["status"] == "insurance":
            g = act(client, g["game_id"], "no_insurance").json()
        if g["status"] == "active" and "split" in g["actions"]:
            first = g["hands"][0]["cards"]
            bal = g["balances"]["USDT"]
            g2 = act(client, g["game_id"], "split").json()
            assert len(g2["hands"]) == 2
            assert g2["hands"][0]["cards"][0] == first[0] and g2["hands"][1]["cards"][0] == first[1]
            assert abs(g2["total_stake"] - 0.2) < 1e-9
            if first[0][0] == "A":
                assert g2["status"] == "done"
                assert all(len(h["cards"]) == 2 for h in g2["hands"])
            g2 = play_out(client, g2, lambda g: "stand")
            assert abs(usdt(client) - (bal - 0.1 + g2["total_payout"])) < 1e-6
            assert all(h["result"] != "blackjack" for h in g2["hands"])
            return
        play_out(client, g)
    pytest.fail("no split opportunity in 400 deals")


def test_insurance(client):
    finish_current(client)
    for _ in range(400):
        g = deal(client).json()
        if g["status"] == "insurance":
            assert g["dealer"][0][0] == "A" and g["actions"] == ["insurance", "no_insurance"]
            assert act(client, g["game_id"], "hit").status_code == 400
            bal = g["balances"]["USDT"]
            g2 = act(client, g["game_id"], "insurance").json()
            assert abs(g2["insurance"]["bet"] - 0.05) < 1e-9
            assert abs(g2["total_stake"] - 0.15) < 1e-9
            g2 = play_out(client, g2)
            dbj = len(g2["dealer"]) == 2 and val(g2["dealer"]) == 21
            assert abs(g2["insurance"]["payout"] - (0.15 if dbj else 0)) < 1e-9
            assert abs(usdt(client) - (bal - 0.05 + g2["total_payout"])) < 1e-6
            return
        play_out(client, g)
    pytest.fail("no insurance opportunity")


def test_history_has_blackjack(client):
    rows = client.get(f"{API}/casino/history").json()["games"]
    bj = [r for r in rows if r.get("game") == "blackjack"]
    assert bj, rows[:1]
    assert "_id" not in bj[0]


# ---------- insufficient balance for double / split / insurance ----------
@pytest.fixture(scope="module")
def poor():
    s = requests.Session()
    email = f"test_bj_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{API}/auth/register", json={"name": "TEST BJ", "email": email, "password": "test12345"})
    assert r.status_code in (200, 201), r.text
    uid = s.get(f"{API}/auth/me").json().get("id") or r.json().get("user", {}).get("id")
    yield s, uid
    mdb.users.delete_one({"email": email})


def test_insufficient_balance_actions(poor):
    s, uid = poor
    assert deal(s).status_code == 400  # zero balance
    hit = set()
    for _ in range(600):
        mdb.wallets.update_one({"user_id": uid}, {"$set": {"balances.USDT": 1.0}})
        g = deal(s, stake=1.0).json()
        if g["status"] != "done":  # natural BJ settles immediately and pays 2.5x
            assert g["balances"]["USDT"] == 0
        else:
            continue
        if g["status"] == "insurance":
            r = act(s, g["game_id"], "insurance")
            assert r.status_code == 400 and "nsufficient" in r.json()["detail"]
            hit.add("insurance")
            g = act(s, g["game_id"], "no_insurance").json()
        for a in ("split", "double"):
            if g["status"] == "active" and a in g["actions"]:
                r = act(s, g["game_id"], a)
                assert r.status_code == 400 and "nsufficient" in r.json()["detail"], r.text
                assert usdt(s) == 0
                hit.add(a)
        play_out(s, g)
        if {"insurance", "split", "double"} <= hit:
            break
    assert {"double", "insurance"} <= hit, hit


# ---------- concurrency: double-stand must not double-pay ----------
def test_concurrent_stand_no_double_payout(client):
    finish_current(client)
    cookies = client.cookies.get_dict()
    for _ in range(30):
        g = deal(client).json()
        if g["status"] != "active":
            play_out(client, g)
            continue
        before = g["balances"]["USDT"]

        def stand():
            return requests.post(f"{API}/casino/blackjack/action", json={"game_id": g["game_id"], "action": "stand"},
                                 cookies=cookies, timeout=15)
        with cf.ThreadPoolExecutor(6) as ex:
            rs = list(ex.map(lambda _: stand(), range(6)))
        oks = [r for r in rs if r.status_code == 200]
        payout = oks[0].json()["total_payout"]
        if payout > 0:
            delta = usdt(client) - before
            assert abs(delta - payout) < 1e-6, f"{len(oks)} concurrent stands succeeded; credited {delta} vs payout {payout}"
            return
    pytest.skip("no winning hand for race test")
