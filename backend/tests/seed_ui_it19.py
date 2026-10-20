# UI seed for iteration 19 (seed | cleanup)
import os, sys, json, uuid, requests
from bson import ObjectId
from pymongo import MongoClient
from dotenv import load_dotenv
load_dotenv("/app/backend/.env"); load_dotenv("/app/frontend/.env")
API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
DB = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
ST = "/tmp/ui_it19.json"
if sys.argv[1] == "seed":
    s = requests.Session(); email = f"test_ui19_{uuid.uuid4().hex[:8]}@example.com"
    assert s.post(f"{API}/auth/register", json={"name": "TEST UI19", "email": email, "password": "test1234"}).status_code == 200
    uid = s.get(f"{API}/auth/me").json()["id"]
    DB.wallets.update_one({"user_id": uid}, {"$set": {"balances": {"USD": 500.0}}})
    boosts = requests.get(f"{API}/boosts", timeout=90).json().get("boosts") or []
    bet_id = None
    keys = ["event_id", "league", "league_label", "home", "away", "market", "pick", "side", "line", "odds"]
    for b in boosts:
        leg = {k: b["legs"][0].get(k) for k in keys}
        r = s.post(f"{API}/bets", json={"selections": [leg], "stake": 5, "coin": "USD", "bet_type": "single"}, timeout=30)
        if r.status_code == 200:
            bet_id = r.json().get("bet", r.json()).get("id"); break
    print("bet", bet_id)
    DB.bets.insert_one({"id": "TEST-" + uuid.uuid4().hex, "user_id": uid, "coin": "BTC", "stake": 0.0001, "potential_payout": 0.0002,
                        "payout": 0.0002, "status": "won", "bet_type": "single", "odds": 2.0, "selections": [], "created_at": "2025-12-01T00:00:00+00:00",
                        "settled_at": "2025-12-02T00:00:00+00:00"})
    h = "TEST-H-" + uuid.uuid4().hex
    DB.static_deposits.insert_one({"user_id": uid, "tx_hash": h, "coin": "BTC", "net": "BTC", "amount": 0.0005, "amount_usd": 41.48,
                                   "notified": False, "created_at": "2026-01-10T00:00:00+00:00"})
    r = s.post(f"{API}/wallet/withdraw", json={"coin": "BTC", "amount": 25, "address": "bc1qtestaddress000000"}, timeout=30)
    print("wd", r.status_code, r.text[:150])
    json.dump({"email": email, "uid": uid, "bet": bet_id, "wd": r.json().get("withdrawal_id")}, open(ST, "w"))
    print(json.load(open(ST)))
else:
    uid = json.load(open(ST))["uid"]
    for c in ["wallets", "bets", "casino_games", "transactions", "withdrawals", "static_addresses", "static_deposits",
              "notifications", "bj_games", "mine_games", "fair_seeds", "admin_actions", "affiliates"]:
        DB[c].delete_many({"user_id": uid})
    DB.users.delete_one({"_id": ObjectId(uid)}); print("cleaned")
