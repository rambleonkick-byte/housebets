"""Probe: concurrent MIXED hit/stand blackjack actions (lock-release race check). Checks wallet delta == total_payout and one casino_games record per hand."""
import os, requests, random, concurrent.futures as cf
from pymongo import MongoClient
env = dict(l.strip().split("=", 1) for l in open("/app/backend/.env") if "=" in l)
mdb = MongoClient(env["MONGO_URL"].strip('"'))[env["DB_NAME"].strip('"')]
API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
s = requests.Session()
s.post(f"{API}/auth/login", json={"email": "admin@apexodds.io", "password": "admin123"})
ck = s.cookies.get_dict()
uid = s.get(f"{API}/auth/me").json().get("id")
bal = lambda: s.get(f"{API}/wallet").json()["balances"]["USDT"]
cur = s.get(f"{API}/casino/blackjack/current").json()["game"]
while cur and cur["status"] != "done":
    cur = s.post(f"{API}/casino/blackjack/action", json={"game_id": cur["game_id"], "action": "no_insurance" if cur["status"] == "insurance" else "stand"}).json()
bad, rounds, statuses, recs = 0, 0, {}, []
for i in range(int(os.environ.get("ROUNDS", "40"))):
    b0 = bal()
    g = s.post(f"{API}/casino/blackjack/deal", json={"coin": "USDT", "stake": 0.1}).json()
    while g.get("status") == "insurance":
        g = s.post(f"{API}/casino/blackjack/action", json={"game_id": g["game_id"], "action": "no_insurance"}).json()
    if g.get("status") != "active":
        continue
    rounds += 1
    acts = [random.choice(["hit", "stand", "hit"]) for _ in range(16)]
    with cf.ThreadPoolExecutor(16) as ex:
        rs = list(ex.map(lambda a: requests.post(f"{API}/casino/blackjack/action", json={"game_id": g["game_id"], "action": a}, cookies=ck), acts))
    for r in rs: statuses[r.status_code] = statuses.get(r.status_code, 0) + 1
    # finish
    cur = s.get(f"{API}/casino/blackjack/current").json()["game"]
    while cur and cur["status"] != "done":
        r = s.post(f"{API}/casino/blackjack/action", json={"game_id": cur["game_id"], "action": "stand"})
        if r.status_code == 409: continue
        cur = r.json()
    doc = mdb.bj_games.find_one({"id": g["game_id"]})
    nrec = mdb.casino_games.count_documents({"user_id": uid, "game": "blackjack", "detail.dealer": doc["dealer"], "nonce": doc["nonce"], "server_seed_hash": doc["server_seed_hash"]}) if doc else -1
    d = bal() - b0
    exp = doc["total_payout"] - doc["total_stake"]
    recs.append(nrec)
    if abs(d - exp) > 1e-6 or nrec != 1:
        bad += 1
        print("MISMATCH", g["game_id"], "delta", d, "expected", exp, "records", nrec)
print("records-per-hand", set(recs), "rounds", rounds, "mismatches", bad, "statuses", statuses, "stuck-locks", mdb.bj_games.count_documents({"lock": True}))
