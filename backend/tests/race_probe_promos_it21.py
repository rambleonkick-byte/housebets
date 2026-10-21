# Race probe: concurrent redemption of the same cash code by one user, and max_uses=3 under 8 concurrent users
import os, uuid, concurrent.futures as cf, requests
from pymongo import MongoClient
from bson import ObjectId
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
env = dict(l.strip().split("=", 1) for l in open("/app/backend/.env") if "=" in l)
db = MongoClient(env["MONGO_URL"].strip('"'))[env["DB_NAME"].strip('"')]
adm = requests.Session(); adm.post(f"{BASE}/api/auth/login", json={"email": "admin@apexodds.io", "password": "admin123"})
tag = uuid.uuid4().hex[:5].upper()
c1, c2 = f"RACE{tag}A", f"RACE{tag}B"
adm.post(f"{BASE}/api/admin/promos", json={"code": c1, "type": "cash", "amount": 10})
adm.post(f"{BASE}/api/admin/promos", json={"code": c2, "type": "cash", "amount": 1, "max_uses": 3})
users = []
for i in range(8):
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/register", json={"name": "TEST race", "email": f"test_race_{tag.lower()}{i}@example.com", "password": "Passw0rd!"})
    users.append((s, r.json()["id"]))
try:
    s0 = users[0][0]
    with cf.ThreadPoolExecutor(8) as ex:
        codes = list(ex.map(lambda _: s0.post(f"{BASE}/api/promo/redeem", json={"code": c1}).status_code, range(8)))
    bal = s0.get(f"{BASE}/api/auth/me").json()["balances"]["USD"]
    print("same-user race statuses", codes, "balance", bal, "OK" if bal == 10 else "DOUBLE CREDIT BUG")
    with cf.ThreadPoolExecutor(8) as ex:
        codes = list(ex.map(lambda u: u[0].post(f"{BASE}/api/promo/redeem", json={"code": c2}).status_code, users))
    uses = db.promo_codes.find_one({"code": c2})["uses"]
    print("max_uses race", codes, "uses", uses, "OK" if codes.count(200) == 3 and uses == 3 else "BUG")
finally:
    for _, uid in users:
        for col in ("wallets", "transactions", "rewards", "promo_redemptions", "free_bets"):
            db[col].delete_many({"user_id": uid})
        db.users.delete_one({"_id": ObjectId(uid)})
    db.promo_codes.delete_many({"code": {"$in": [c1, c2]}})
