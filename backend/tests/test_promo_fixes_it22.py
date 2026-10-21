# Iteration 22 retest: free-bet auto-cashout 400, void/cashed_out excluded from wagering + VIP points, wallet tx types
import os
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN = {"email": "admin@apexodds.io", "password": "admin123"}
TAG = uuid.uuid4().hex[:6].upper()
CODES = []


def _mongo():
    env = dict(l.strip().split("=", 1) for l in open("/app/backend/.env") if "=" in l)
    return MongoClient(env["MONGO_URL"].strip('"'))[env["DB_NAME"].strip('"')]


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return s


def _register():
    email = f"test_it22_{uuid.uuid4().hex[:8]}@example.com"
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/register", json={"name": "TEST It22", "email": email, "password": "Passw0rd!"})
    assert r.status_code in (200, 201), r.text
    return s, r.json()["id"]


def _promo(adm, suffix, **kw):
    code = f"T{TAG}{suffix}"
    r = adm.post(f"{BASE_URL}/api/admin/promos", json={"code": code, **kw})
    assert r.status_code == 200, r.text
    CODES.append(code)
    return code


def _selection():
    r = requests.get(f"{BASE_URL}/api/odds", timeout=60)
    for ev in r.json()["events"]:
        if ev["state"] != "pre":
            continue
        for m in ev["markets"]:
            if m["market"] == "moneyline":
                s = m["selections"][0]
                return {"event_id": ev["event_id"], "league": ev["league"], "league_label": ev["league_label"],
                        "home": ev["home"]["abbr"], "away": ev["away"]["abbr"], "market": "moneyline",
                        "pick": s["pick"], "side": s["side"], "line": s["line"], "odds": s["odds"]}
    pytest.skip("No pre-game moneyline available")


@pytest.fixture(scope="module")
def ctx():
    adm = _login(**ADMIN)
    p, uid = _register()
    yield {"admin": adm, "p": p, "uid": uid}
    db = _mongo()
    from bson import ObjectId
    for col in ("wallets", "bets", "casino_games", "transactions", "rewards", "free_bets", "promo_redemptions",
                "withdrawals", "notifications", "fair_seeds", "admin_log"):
        db[col].delete_many({"user_id": uid})
    db.users.delete_one({"_id": ObjectId(uid)})
    db.promo_codes.delete_many({"code": {"$in": CODES}})


def _prof(p):
    return p.get(f"{BASE_URL}/api/profile").json()


# --- free bet auto-cashout rejected ---
def test_free_bet_auto_cashout_400(ctx):
    adm, p = ctx["admin"], ctx["p"]
    code = _promo(adm, "FB", type="free_bet", amount=10)
    assert p.post(f"{BASE_URL}/api/promo/redeem", json={"code": code}).status_code == 200
    fid = p.get(f"{BASE_URL}/api/free-bets").json()["free_bets"][0]["id"]
    sel = _selection()
    ctx["sel"] = sel
    r = p.post(f"{BASE_URL}/api/bets", json={"selections": [sel], "stake": 10, "coin": "USD", "free_bet_id": fid})
    assert r.status_code == 200, r.text
    bid = r.json()["bet"]["id"]
    ctx["fb_bet"] = r.json()["bet"]
    a = p.post(f"{BASE_URL}/api/bets/{bid}/auto-cashout", json={"target": 5})
    assert a.status_code == 400 and "Free bets" in a.json()["detail"]
    a2 = p.post(f"{BASE_URL}/api/bets/{bid}/auto-cashout", json={"target": None})
    assert a2.status_code == 400
    assert _mongo().bets.find_one({"id": bid}).get("auto_cashout") in (None, 0)


# --- wallet tx: bonus (+label) and free_bet entries ---
def test_wallet_transactions_types(ctx):
    adm, p = ctx["admin"], ctx["p"]
    code = _promo(adm, "CASH", type="cash", amount=25, wager_mult=1)
    r = p.post(f"{BASE_URL}/api/promo/redeem", json={"code": code})
    assert r.status_code == 200, r.text
    txs = p.get(f"{BASE_URL}/api/wallet").json()["transactions"]
    bonus = [t for t in txs if t["type"] == "bonus"]
    fb = [t for t in txs if t["type"] == "free_bet"]
    assert bonus and bonus[0]["amount"] == 25 and code in (bonus[0].get("label") or "")
    assert fb, f"no free_bet tx: {[t['type'] for t in txs]}"
    ctx["bonus_label"] = bonus[0].get("label")
    print("bonus tx:", bonus[0], "free_bet tx:", fb[0])


# --- void / cashed_out excluded from wagering and VIP points ---
def test_void_and_cashed_out_excluded(ctx):
    adm, p, uid = ctx["admin"], ctx["p"], ctx["uid"]
    r = adm.post(f"{BASE_URL}/api/admin/users/{uid}/adjust", json={"coin": "USD", "amount": 100, "reason": "TEST fund"})
    assert r.status_code == 200, r.text
    base = _prof(p)
    w0, pts0, rem0 = base["wagered"], base["vip"]["points"], base["wagering"]["remaining"]
    ids = []
    for _ in range(3):
        b = p.post(f"{BASE_URL}/api/bets", json={"selections": [ctx["sel"]], "stake": 4, "coin": "USD"})
        assert b.status_code == 200, b.text
        ids.append(b.json()["bet"]["id"])
    after = _prof(p)
    assert round(after["wagered"] - w0, 2) == 12
    assert round(after["vip"]["points"] - pts0, 2) == 36  # 3x sports weighting
    db = _mongo()
    db.bets.update_one({"id": ids[0]}, {"$set": {"status": "void"}})
    db.bets.update_one({"id": ids[1]}, {"$set": {"status": "cashed_out", "cashout_amount": 3.5}})
    db.bets.update_one({"id": ids[2]}, {"$set": {"status": "lost"}})
    fin = _prof(p)
    assert round(fin["wagered"] - w0, 2) == 4, fin["wagered"]
    assert round(fin["vip"]["points"] - pts0, 2) == 12, fin["vip"]["points"]
    assert round(fin["wagering"]["remaining"], 2) == round(max(0, rem0 - 4), 2)


def test_real_cashout_excluded_if_quote(ctx):
    p = ctx["p"]
    w0 = _prof(p)["wagered"]
    b = p.post(f"{BASE_URL}/api/bets", json={"selections": [ctx["sel"]], "stake": 3, "coin": "USD"})
    assert b.status_code == 200
    bid = b.json()["bet"]["id"]
    assert round(_prof(p)["wagered"] - w0, 2) == 3
    q = p.get(f"{BASE_URL}/api/bets/cashout-quotes").json()["quotes"].get(bid)
    if not q:
        pytest.skip("no cash-out quote available")
    c = p.post(f"{BASE_URL}/api/bets/{bid}/cashout", json={"expected": q})
    assert c.status_code == 200, c.text
    assert round(_prof(p)["wagered"], 2) == round(w0, 2)


def test_profile_regression(ctx):
    d = _prof(ctx["p"])
    for k in ("deposits", "withdrawals", "bonuses", "sports", "casino", "pnl", "wagered", "vip", "wagering", "free_bets"):
        assert k in d
    assert d["bonuses"] == 25
    assert len(d["vip"]["tiers"]) == 15 if "tiers" in d["vip"] else True
