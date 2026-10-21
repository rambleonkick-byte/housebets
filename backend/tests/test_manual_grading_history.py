# Iteration 23: Manual bet grading (won/lost/void, free bets), admin player history, auto-settle regression
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN = {"email": "admin@apexodds.io", "password": "admin123"}
SGO_EVENT = "RXJ6e7zy3upVSBy1mFUP"


def _mongo():
    env = dict(l.strip().split("=", 1) for l in open("/app/backend/.env") if "=" in l)
    return MongoClient(env["MONGO_URL"].strip('"'))[env["DB_NAME"].strip('"')]


DB = _mongo()


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return s


def _register():
    email = f"test_it23_{uuid.uuid4().hex[:8]}@example.com"
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/register", json={"name": "TEST It23", "email": email, "password": "Passw0rd!"})
    assert r.status_code in (200, 201), r.text
    return s, r.json()["id"]


def _bal(uid):
    return DB.wallets.find_one({"user_id": uid})["balances"].get("USD", 0)


def _insert_bet(uid, stake=10.0, odds=2.5, free_bet_id=None, event_id="TEST_EVT", market="moneyline", side="home", line=None):
    bid = "TEST_" + uuid.uuid4().hex
    DB.bets.insert_one({
        "id": bid, "user_id": uid, "bet_type": "single", "stake": stake, "coin": "USD",
        "total_odds": odds, "potential_payout": round(stake * odds, 6), "status": "open",
        "selections": [{"event_id": event_id, "league": "nba", "league_label": "NBA", "home": "WAS", "away": "BOS",
                        "market": market, "pick": f"TEST {side}", "side": side, "line": line, "odds": odds}],
        "free_bet": bool(free_bet_id), "free_bet_id": free_bet_id,
        "created_at": datetime.now(timezone.utc).isoformat()})
    return bid


@pytest.fixture(scope="module")
def ctx():
    adm = _login(**ADMIN)
    p, uid = _register()
    r = adm.post(f"{BASE_URL}/api/admin/users/{uid}/adjust", json={"coin": "USD", "amount": 100, "reason": "TEST it23"})
    assert r.status_code == 200, r.text
    yield {"admin": adm, "p": p, "uid": uid}
    adm.delete(f"{BASE_URL}/api/admin/users/{uid}")


def _txs(uid, typ):
    return list(DB.transactions.find({"user_id": uid, "type": typ}))


class TestGrade:
    def test_grade_won(self, ctx):
        uid = ctx["uid"]
        bid = _insert_bet(uid, 10, 2.5)
        before = _bal(uid)
        r = ctx["admin"].post(f"{BASE_URL}/api/admin/bets/{bid}/grade", json={"result": "won"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "won" and d["payout"] == 25 and d["graded_by"] == ADMIN["email"]
        assert "_id" not in d
        assert round(_bal(uid) - before, 6) == 25
        assert any(t["amount"] == 25 for t in _txs(uid, "payout"))

    def test_grade_lost(self, ctx):
        uid = ctx["uid"]
        bid = _insert_bet(uid, 20, 3.0)
        before = _bal(uid)
        r = ctx["admin"].post(f"{BASE_URL}/api/admin/bets/{bid}/grade", json={"result": "lost"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "lost" and d["payout"] == 0 and d["lossback"] == 2.0
        assert round(_bal(uid) - before, 6) == 2.0
        assert any(t["hash"] == "lossback:" + bid for t in _txs(uid, "lossback"))

    def test_grade_void(self, ctx):
        uid = ctx["uid"]
        bid = _insert_bet(uid, 15, 2.0)
        before = _bal(uid)
        r = ctx["admin"].post(f"{BASE_URL}/api/admin/bets/{bid}/grade", json={"result": "void"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "void" and r.json()["payout"] == 15
        assert round(_bal(uid) - before, 6) == 15
        assert any(t["amount"] == 15 for t in _txs(uid, "refund"))

    def test_free_bet_void_restores_token(self, ctx):
        uid = ctx["uid"]
        fid = "TEST_FB_" + uuid.uuid4().hex[:8]
        DB.free_bets.insert_one({"id": fid, "user_id": uid, "amount": 5.0, "status": "used",
                                 "created_at": datetime.now(timezone.utc).isoformat()})
        bid = _insert_bet(uid, 5, 3.0, free_bet_id=fid)
        DB.free_bets.update_one({"id": fid}, {"$set": {"bet_id": bid}})
        before = _bal(uid)
        r = ctx["admin"].post(f"{BASE_URL}/api/admin/bets/{bid}/grade", json={"result": "void"})
        assert r.status_code == 200, r.text
        assert r.json()["payout"] == 0
        assert _bal(uid) == before
        fb = DB.free_bets.find_one({"id": fid})
        assert fb["status"] == "available" and "bet_id" not in fb

    def test_free_bet_won_pays_winnings_only(self, ctx):
        uid = ctx["uid"]
        bid = _insert_bet(uid, 5, 3.0, free_bet_id="TEST_FB_X")
        before = _bal(uid)
        r = ctx["admin"].post(f"{BASE_URL}/api/admin/bets/{bid}/grade", json={"result": "won"})
        assert r.status_code == 200
        assert r.json()["payout"] == 10
        assert round(_bal(uid) - before, 6) == 10

    def test_free_bet_lost_no_lossback(self, ctx):
        uid = ctx["uid"]
        bid = _insert_bet(uid, 5, 3.0, free_bet_id="TEST_FB_Y")
        before = _bal(uid)
        r = ctx["admin"].post(f"{BASE_URL}/api/admin/bets/{bid}/grade", json={"result": "lost"})
        assert r.status_code == 200
        assert not r.json().get("lossback")
        assert _bal(uid) == before

    def test_regrade_settled_400(self, ctx):
        bid = _insert_bet(ctx["uid"], 1, 2.0)
        assert ctx["admin"].post(f"{BASE_URL}/api/admin/bets/{bid}/grade", json={"result": "lost"}).status_code == 200
        before = _bal(ctx["uid"])
        r = ctx["admin"].post(f"{BASE_URL}/api/admin/bets/{bid}/grade", json={"result": "won"})
        assert r.status_code == 400
        assert _bal(ctx["uid"]) == before

    def test_invalid_result_400(self, ctx):
        bid = _insert_bet(ctx["uid"], 1, 2.0)
        r = ctx["admin"].post(f"{BASE_URL}/api/admin/bets/{bid}/grade", json={"result": "push"})
        assert r.status_code == 400
        assert DB.bets.find_one({"id": bid})["status"] == "open"
        DB.bets.delete_one({"id": bid})

    def test_unknown_bet_400(self, ctx):
        r = ctx["admin"].post(f"{BASE_URL}/api/admin/bets/nope-{uuid.uuid4().hex}/grade", json={"result": "won"})
        assert r.status_code == 400

    def test_non_admin_403(self, ctx):
        bid = _insert_bet(ctx["uid"], 1, 2.0)
        r = ctx["p"].post(f"{BASE_URL}/api/admin/bets/{bid}/grade", json={"result": "won"})
        assert r.status_code == 403
        r = ctx["p"].get(f"{BASE_URL}/api/admin/users/{ctx['uid']}/history")
        assert r.status_code == 403
        assert requests.post(f"{BASE_URL}/api/admin/bets/{bid}/grade", json={"result": "won"}).status_code == 401
        DB.bets.delete_one({"id": bid})

    def test_admin_action_logged(self, ctx):
        r = ctx["admin"].get(f"{BASE_URL}/api/admin/users/{ctx['uid']}/log")
        acts = [a["action"] for a in r.json()["actions"]]
        assert "grade_won" in acts and "grade_lost" in acts and "grade_void" in acts


class TestHistory:
    def test_history_lists_settled_and_casino(self, ctx):
        uid = ctx["uid"]
        cid = "TEST_CO_" + uuid.uuid4().hex[:6]
        DB.bets.insert_one({"id": cid, "user_id": uid, "bet_type": "single", "stake": 3, "coin": "USD", "total_odds": 2,
                            "potential_payout": 6, "status": "cashed_out", "cashout_amount": 4.5, "selections": [],
                            "created_at": datetime.now(timezone.utc).isoformat()})
        # play a real casino game
        r = ctx["p"].post(f"{BASE_URL}/api/casino/dice", json={"coin": "USD", "stake": 1, "target": 50, "direction": "over"})
        played = r.status_code == 200
        h = ctx["admin"].get(f"{BASE_URL}/api/admin/users/{uid}/history")
        assert h.status_code == 200
        d = h.json()
        statuses = {b["status"] for b in d["bets"]}
        assert "open" not in statuses
        assert {"won", "lost", "void", "cashed_out"} <= statuses
        for g in d["games"]:
            assert "server_seed" not in g and "_id" not in g
            for k in ("game", "multiplier", "stake", "payout"):
                assert k in g
        if played:
            assert any(g["game"] == "dice" for g in d["games"])
        else:
            print("dice endpoint response", r.status_code, r.text[:200])

    def test_history_unknown_user_404(self, ctx):
        assert ctx["admin"].get(f"{BASE_URL}/api/admin/users/000000000000000000000000/history").status_code == 404
        assert ctx["admin"].get(f"{BASE_URL}/api/admin/users/bad/history").status_code == 404

    def test_open_bets_endpoint_only_open(self, ctx):
        bid = _insert_bet(ctx["uid"], 2, 2.0)
        r = ctx["admin"].get(f"{BASE_URL}/api/admin/users/{ctx['uid']}/bets")
        assert r.status_code == 200
        bets = r.json()["bets"]
        assert all(b["status"] == "open" for b in bets) and any(b["id"] == bid for b in bets)
        DB.bets.delete_one({"id": bid})


class TestAutoSettleRegression:
    def test_sweep_settles_finished_event(self, ctx):
        uid = ctx["uid"]
        bid = _insert_bet(uid, 10, 2.0, event_id=SGO_EVENT, market="total", side="over", line=1.5)
        before = _bal(uid)
        r = ctx["admin"].post(f"{BASE_URL}/api/admin/bets/settle-sweep", timeout=120)
        assert r.status_code == 200, r.text
        b = DB.bets.find_one({"id": bid})
        assert b["status"] == "won", b
        assert b["payout"] == 20 and not b.get("graded_by")
        assert round(_bal(uid) - before, 6) == 20
