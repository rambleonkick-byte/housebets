# Migration probe (iteration 19): seed legacy crypto bj/mine games + crypto affiliate ledger, restart backend, verify.
# Usage: python probe_migration_it19.py seed | verify
import os, sys, json, uuid, requests
from bson import ObjectId
from pymongo import MongoClient
from dotenv import load_dotenv
load_dotenv("/app/backend/.env"); load_dotenv("/app/frontend/.env")
API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
DB = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
STATE = "/tmp/mig_it19.json"


def reg():
    s = requests.Session(); email = f"test_mig19_{uuid.uuid4().hex[:8]}@example.com"
    assert s.post(f"{API}/auth/register", json={"name": "TEST MIG", "email": email, "password": "test1234"}).status_code == 200
    return email, s.get(f"{API}/auth/me").json()["id"]


if sys.argv[1] == "seed":
    e1, u1 = reg(); e2, u2 = reg()
    DB.wallets.update_one({"user_id": u1}, {"$set": {"balances": {"USD": 0, "USDT": 20}, "usd_migrated": False}})
    DB.wallets.update_one({"user_id": u2}, {"$set": {"balances": {"USD": 0}}})
    DB.bj_games.insert_one({"id": "TEST-" + uuid.uuid4().hex, "user_id": u1, "coin": "USDT", "total_stake": 10.0,
                            "status": "active", "open": True, "hands": [], "dealer": [], "created_at": "2026-01-01"})
    DB.bj_games.insert_one({"id": "TEST-" + uuid.uuid4().hex, "user_id": u2, "coin": "USDT", "total_stake": 5.0,
                            "status": "insurance", "open": True, "hands": [], "dealer": [], "created_at": "2026-01-01"})
    DB.mine_games.insert_one({"id": "TEST-" + uuid.uuid4().hex, "user_id": u1, "coin": "USDT", "stake": 3.0,
                              "status": "active", "created_at": "2026-01-01"})
    DB.affiliate_ledger.insert_one({"affiliate_id": u1, "player_id": u2, "coin": "USDT", "credited": 2.5})
    json.dump({"u": [[e1, u1], [e2, u2]]}, open(STATE, "w")); print("seeded", u1, u2)
elif sys.argv[1] == "verify":
    st = json.load(open(STATE)); (e1, u1), (e2, u2) = st["u"]
    print("w1", DB.wallets.find_one({"user_id": u1}, {"_id": 0, "balances": 1, "usd_migrated": 1}))
    print("w2", DB.wallets.find_one({"user_id": u2}, {"_id": 0, "balances": 1}))
    for g in DB.bj_games.find({"user_id": {"$in": [u1, u2]}}, {"_id": 0, "user_id": 1, "status": 1, "open": 1, "void_reason": 1}):
        print("bj", g)
    for g in DB.mine_games.find({"user_id": u1}, {"_id": 0, "status": 1, "void_reason": 1}):
        print("mine", g)
    print("ledger", list(DB.affiliate_ledger.find({"affiliate_id": u1}, {"_id": 0})))
    print("refund tx", list(DB.transactions.find({"user_id": {"$in": [u1, u2]}, "hash": {"$regex": "^usd-migration"}}, {"_id": 0, "amount": 1, "hash": 1})))
    for e in (e1, e2):
        s = requests.Session(); s.post(f"{API}/auth/login", json={"email": e, "password": "test1234"})
        r = s.post(f"{API}/casino/blackjack/deal", json={"coin": "USD", "stake": 1})
        print("deal", e, r.status_code, r.text[:120])
        print("current", s.get(f"{API}/casino/blackjack/current").text[:120])
elif sys.argv[1] == "cleanup":
    st = json.load(open(STATE))
    for _, uid in st["u"]:
        for c in ["wallets", "bets", "casino_games", "transactions", "withdrawals", "notifications", "bj_games",
                  "mine_games", "fair_seeds", "affiliates", "static_addresses"]:
            DB[c].delete_many({"user_id": uid})
        DB.affiliate_ledger.delete_many({"$or": [{"affiliate_id": uid}, {"player_id": uid}]})
        DB.affiliate_earnings.delete_many({"$or": [{"affiliate_id": uid}, {"player_id": uid}]})
        DB.users.delete_one({"_id": ObjectId(uid)})
    print("cleaned")
