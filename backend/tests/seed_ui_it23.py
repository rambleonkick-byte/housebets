# Seed a TEST player with open bets + casino game for UI grading tests (it23). Prints uid and bet ids.
import os, sys, uuid, json, requests
sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("REACT_APP_BACKEND_URL", open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0])
from test_manual_grading_history import DB, BASE_URL, ADMIN, _login, _register, _insert_bet  # noqa

adm = _login(**ADMIN)
p, uid = _register()
adm.post(f"{BASE_URL}/api/admin/users/{uid}/adjust", json={"coin": "USD", "amount": 100, "reason": "TEST it23 ui"})
p.post(f"{BASE_URL}/api/casino/dice", json={"coin": "USD", "stake": 2, "target": 50, "direction": "over"})
fid = "TEST_FB_" + uuid.uuid4().hex[:8]
DB.free_bets.insert_one({"id": fid, "user_id": uid, "amount": 5.0, "status": "used", "created_at": "2026-01-01T00:00:00+00:00"})
ids = {"won": _insert_bet(uid, 10, 2.5), "lost": _insert_bet(uid, 20, 3.0), "void": _insert_bet(uid, 15, 2.0),
       "fb_void": _insert_bet(uid, 5, 3.0, free_bet_id=fid)}
print(json.dumps({"uid": uid, "fid": fid, "bets": ids, "balance": DB.wallets.find_one({"user_id": uid})["balances"]["USD"]}))
