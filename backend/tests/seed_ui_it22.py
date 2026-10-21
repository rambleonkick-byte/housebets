# Seed a UI test player for iteration 22 (run with arg "clean" to remove). Prints email/password.
import os, sys, json, uuid, requests
from pymongo import MongoClient
sys.path.insert(0, os.path.dirname(__file__))
from test_promo_fixes_it22 import _mongo, _login, _selection, ADMIN

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
STATE = "/tmp/seed_ui_it22.json"

if len(sys.argv) > 1 and sys.argv[1] == "clean":
    st = json.load(open(STATE)); db = _mongo()
    from bson import ObjectId
    for col in ("wallets", "bets", "casino_games", "transactions", "rewards", "free_bets", "promo_redemptions",
                "withdrawals", "notifications", "fair_seeds", "admin_log"):
        db[col].delete_many({"user_id": st["uid"]})
    db.users.delete_one({"_id": ObjectId(st["uid"])})
    db.promo_codes.delete_many({"code": {"$regex": "^UI" + st["tag"]}})
    print("cleaned", st); sys.exit()

tag = uuid.uuid4().hex[:5].upper()
adm = _login(**ADMIN)
email = f"test_ui22_{tag.lower()}@example.com"
p = requests.Session()
uid = p.post(f"{BASE_URL}/api/auth/register", json={"name": "TEST UI22", "email": email, "password": "Passw0rd!"}).json()["id"]
codes = {}
for suf, body in (("CASH", {"type": "cash", "amount": 20, "wager_mult": 1}), ("FBA", {"type": "free_bet", "amount": 10}),
                  ("FBB", {"type": "free_bet", "amount": 5}), ("FBC", {"type": "free_bet", "amount": 7})):
    c = f"UI{tag}{suf}"; assert adm.post(f"{BASE_URL}/api/admin/promos", json={"code": c, **body}).status_code == 200
    assert p.post(f"{BASE_URL}/api/promo/redeem", json={"code": c}).status_code == 200; codes[suf] = c
sel = _selection()
fbs = {f["amount"]: f["id"] for f in p.get(f"{BASE_URL}/api/free-bets").json()["free_bets"]}
open_fb = p.post(f"{BASE_URL}/api/bets", json={"selections": [sel], "stake": 10, "coin": "USD", "free_bet_id": fbs[10]}).json()["bet"]
won_fb = p.post(f"{BASE_URL}/api/bets", json={"selections": [sel], "stake": 5, "coin": "USD", "free_bet_id": fbs[5]}).json()["bet"]
_mongo().bets.update_one({"id": won_fb["id"]}, {"$set": {"status": "won", "payout": round(won_fb["potential_payout"] - 5, 2)}})
normal = p.post(f"{BASE_URL}/api/bets", json={"selections": [sel], "stake": 2, "coin": "USD"}).json()["bet"]
st = {"uid": uid, "email": email, "password": "Passw0rd!", "tag": tag, "codes": codes, "open_fb": open_fb, "won_fb_id": won_fb["id"],
      "won_fb_pp": won_fb["potential_payout"], "normal": normal["id"], "fbc_left": fbs[7]}
json.dump(st, open(STATE, "w")); print(json.dumps(st, indent=1))
