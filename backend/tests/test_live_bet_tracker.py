# Live Bet Tracker (it24): _live_leg unit logic, GET /api/bets/live, lost-leg parlay settlement short-circuit
import os
import sys
import uuid
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

sys.path.insert(0, "/app/backend")
os.environ.setdefault("REACT_APP_BACKEND_URL", open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0])
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN = {"email": "admin@apexodds.io", "password": "admin123"}
FINISHED = "RXJ6e7zy3upVSBy1mFUP"


def _mongo():
    env = dict(l.strip().split("=", 1) for l in open("/app/backend/.env") if "=" in l)
    return MongoClient(env["MONGO_URL"].strip('"'))[env["DB_NAME"].strip('"')]


DB = _mongo()


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(**ADMIN)


@pytest.fixture(scope="module")
def player(admin):
    email = f"test_it24_{uuid.uuid4().hex[:8]}@example.com"
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/register", json={"name": "TEST It24", "email": email, "password": "Passw0rd!"})
    assert r.status_code in (200, 201), r.text
    uid = r.json()["id"]
    a = admin.post(f"{BASE_URL}/api/admin/users/{uid}/adjust", json={"coin": "USD", "amount": 50, "reason": "test"})
    assert a.status_code == 200, a.text
    yield s, uid
    admin.delete(f"{BASE_URL}/api/admin/users/{uid}")


def _sel(event_id, market, side, line=None, odds=2.0, home="HOM", away="AWY"):
    return {"event_id": event_id, "league": "nba", "league_label": "NBA", "home": home, "away": away,
            "market": market, "pick": f"TEST {market} {side} {line}", "side": side, "line": line, "odds": odds}


def _insert(uid, sels, bet_type=None, stake=1.0):
    bid = "TEST_" + uuid.uuid4().hex
    odds = 1.0
    for s in sels:
        odds *= s["odds"]
    DB.bets.insert_one({"id": bid, "user_id": uid, "bet_type": bet_type or ("parlay" if len(sels) > 1 else "single"),
                        "stake": stake, "coin": "USD", "total_odds": odds, "potential_payout": round(stake * odds, 6),
                        "status": "open", "selections": sels, "free_bet": False, "free_bet_id": None,
                        "created_at": datetime.now(timezone.utc).isoformat()})
    return bid


# ---------- unit: _live_leg with synthetic events ----------
@pytest.fixture(scope="module")
def S():
    import server as S  # noqa
    return S


def _ev(state, hs, as_, pr=None, cancelled=False):
    return {"event_id": "X", "state": state, "cancelled": cancelled, "start": None, "clock": "Q3 4:12",
            "home": {"score": hs}, "away": {"score": as_}, "player_results": pr or {}, "rounds": None}


class TestLiveLegUnit:
    def test_pre_and_missing(self, S):
        assert S._live_leg(_sel("X", "moneyline", "home"), None)["state"] == "pre"
        assert S._live_leg(_sel("X", "moneyline", "home"), _ev("pre", None, None))["state"] == "pre"

    def test_moneyline_spread_in_play(self, S):
        ev = _ev("in", 50, 40)
        r = S._live_leg(_sel("X", "moneyline", "home"), ev)
        assert r["status"] == "winning" and r["home_score"] == 50 and r["clock"] == "Q3 4:12" and "progress" not in r
        assert S._live_leg(_sel("X", "moneyline", "away"), ev)["status"] == "losing"
        assert S._live_leg(_sel("X", "spread", "away", 12.5), ev)["status"] == "winning"
        assert S._live_leg(_sel("X", "spread", "home", -12.5), ev)["status"] == "losing"

    def test_total_in_play(self, S):
        ev = _ev("in", 50, 40)  # total 90
        r = S._live_leg(_sel("X", "total", "over", 85.5), ev)
        assert r["status"] == "won" and r["progress"] == {"current": 90.0, "line": 85.5, "side": "over"}
        assert S._live_leg(_sel("X", "total", "under", 85.5), ev)["status"] == "lost"
        assert S._live_leg(_sel("X", "alt_total", "over", 200.5), ev)["status"] == "losing"
        assert S._live_leg(_sel("X", "total", "under", 200.5), ev)["status"] == "winning"

    def test_prop_in_play(self, S):
        ev = _ev("in", 50, 40, {"p1:points": 22})
        r = S._live_leg(_sel("X", "prop", "points:p1:over", 19.5), ev)
        assert r["status"] == "won" and r["progress"]["current"] == 22
        assert S._live_leg(_sel("X", "prop", "points:p1:under", 19.5), ev)["status"] == "lost"
        assert S._live_leg(_sel("X", "prop", "points:p1:over", 29.5), ev)["status"] == "losing"
        # no stat yet
        r = S._live_leg(_sel("X", "prop", "points:p2:under", 9.5), ev)
        assert r["status"] == "winning" and r["progress"]["current"] == 0.0
        assert S._live_leg(_sel("X", "prop", "points:p2:over", 9.5), ev)["status"] == "losing"

    def test_final(self, S):
        ev = _ev("post", 50, 40, {"p1:points": 22})
        assert S._live_leg(_sel("X", "moneyline", "home"), ev)["status"] == "won"
        assert S._live_leg(_sel("X", "moneyline", "away"), ev)["status"] == "lost"
        assert S._live_leg(_sel("X", "total", "over", 90), ev)["status"] == "push"
        assert S._live_leg(_sel("X", "prop", "points:p1:over", 19.5), ev)["status"] == "won"
        assert S._live_leg(_sel("X", "prop", "points:p9:over", 19.5), ev)["status"] == "pending"
        assert S._live_leg(_sel("X", "moneyline", "home"), _ev("post", 1, 1, cancelled=True))["status"] == "push"

    def test_in_play_total_equal_line_not_push(self, S):
        # Edge: mid-game total exactly on a whole-number line -> should not be shown as a final 'push'
        r = S._live_leg(_sel("X", "total", "over", 90), _ev("in", 50, 40))
        assert r["status"] != "push", f"in-play total==line shows {r['status']}"


# ---------- API: /api/bets/live ----------
class TestLiveEndpoint:
    def test_requires_auth(self):
        assert requests.get(f"{BASE_URL}/api/bets/live").status_code == 401

    def test_finished_event_legs(self, player):
        s, uid = player
        sgo = DB  # noqa
        b_ou = _insert(uid, [_sel(FINISHED, "total", "under", 1.5), _sel(FINISHED, "total", "over", 1.5)], bet_type="single")
        b_ml = _insert(uid, [_sel(FINISHED, "moneyline", "home")])
        r = s.get(f"{BASE_URL}/api/bets/live", timeout=60)
        assert r.status_code == 200, r.text
        live = r.json()["live"]
        assert b_ou in live and b_ml in live
        u, o = live[b_ou]
        print("finished legs:", u, o, live[b_ml])
        assert u["state"] == "post" and u["status"] == "lost"
        assert o["status"] == "won"
        assert u["progress"]["line"] == 1.5 and u["progress"]["side"] == "under" and u["progress"]["current"] > 1.5
        assert isinstance(live[b_ml][0]["home_score"], (int, float))
        assert live[b_ml][0]["status"] in ("won", "lost", "push")
        DB.bets.delete_many({"id": {"$in": [b_ou, b_ml]}})

    def test_live_event_real_bets(self, player):
        s, uid = player
        evs = requests.get(f"{BASE_URL}/api/odds", timeout=90).json()["events"]
        live = [e for e in evs if e.get("state") == "in"]
        if not live:
            pytest.skip("no live events")
        placed = []
        for e in live:
            mk = {m["market"]: m for m in e.get("markets") or []}
            for mname in ("moneyline", "total"):
                if mname not in mk or not mk[mname]["selections"]:
                    continue
                sl = mk[mname]["selections"][0]
                body = {"selections": [{"event_id": e["event_id"], "league": e["league"], "league_label": e["league_label"],
                                        "home": e["home"]["abbr"], "away": e["away"]["abbr"], "market": mname,
                                        "pick": sl["pick"], "side": sl["side"], "line": sl.get("line"), "odds": sl["odds"]}],
                        "stake": 1, "coin": "USD", "bet_type": "single", "accept_better": True}
                r = s.post(f"{BASE_URL}/api/bets", json=body)
                print("place", mname, e["event_id"], r.status_code, r.text[:150])
                if r.status_code == 200:
                    placed.append((r.json()["bet"]["id"], mname))
            if placed:
                break
        if not placed:
            pytest.skip("could not place live bets")
        r = s.get(f"{BASE_URL}/api/bets/live", timeout=60)
        assert r.status_code == 200
        live_map = r.json()["live"]
        for bid, mname in placed:
            leg = live_map[bid][0]
            print("live leg", mname, leg)
            assert leg["state"] in ("in", "post")
            assert "home_score" in leg and "away_score" in leg and "clock" in leg
            assert leg["status"] in ("winning", "losing", "won", "lost", "push", "live", "pending")
            if mname == "total":
                assert "progress" in leg and leg["progress"]["side"] in ("over", "under")


# ---------- settlement: parlay with a lost leg settles immediately ----------
class TestLostLegSettlement:
    def test_parlay_lost_leg_settles(self, admin, player):
        _, uid = player
        bid = _insert(uid, [_sel(FINISHED, "total", "under", 1.5), _sel("TEST_NONEXISTENT_" + uuid.uuid4().hex[:6], "moneyline", "home")])
        r = admin.post(f"{BASE_URL}/api/admin/bets/settle-sweep", timeout=120)
        assert r.status_code == 200, r.text
        b = DB.bets.find_one({"id": bid})
        assert b["status"] == "lost", b["status"]
        assert b.get("lossback") == 0.1

    def test_parlay_pending_without_loss_stays_open(self, admin, player):
        _, uid = player
        bid = _insert(uid, [_sel(FINISHED, "total", "over", 1.5), _sel("TEST_NONEXISTENT_" + uuid.uuid4().hex[:6], "moneyline", "home")])
        admin.post(f"{BASE_URL}/api/admin/bets/settle-sweep", timeout=120)
        assert DB.bets.find_one({"id": bid})["status"] == "open"
        DB.bets.delete_one({"id": bid})
