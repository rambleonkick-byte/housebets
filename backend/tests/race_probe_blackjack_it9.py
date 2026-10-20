"""Iteration 9 probe: 16+ parallel mixed hit/stand/double on same blackjack hand; one casino_games record per hand
(nonce+user_id), wallet delta == total_payout - total_stake, no stuck locks; unknown game_id -> 404."""
import os, sys, uuid, random, requests, concurrent.futures as cf
from pymongo import MongoClient

env = dict(l.strip().split("=", 1) for l in open("/app/backend/.env") if "=" in l)
mdb = MongoClient(env["MONGO_URL"].strip('"'))[env["DB_NAME"].strip('"')]
API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
EMAIL, PW = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else ("player@apexodds.io", "player123")
PAR = int(os.environ.get("PAR", "16"))
s = requests.Session()
r = s.post(f"{API}/auth/login", json={"email": EMAIL, "password": PW})
assert r.status_code == 200, r.text
ck = s.cookies.get_dict()
uid = s.get(f"{API}/auth/me").json()["id"]
bal = lambda: s.get(f"{API}/wallet").json()["balances"]["USDT"]

# unknown id -> 404
r = s.post(f"{API}/casino/blackjack/action", json={"game_id": str(uuid.uuid4()), "action": "hit"})
print("unknown id:", r.status_code, r.text)


def finish():
    cur = s.get(f"{API}/casino/blackjack/current").json()["game"]
    n = 0
    while cur and cur["status"] != "done" and n < 50:
        n += 1
        a = "no_insurance" if cur["status"] == "insurance" else "stand"
        r = s.post(f"{API}/casino/blackjack/action", json={"game_id": cur["game_id"], "action": a})
        if r.status_code == 200:
            cur = r.json()


finish()
bad, rounds, statuses, recs = 0, 0, {}, []
for i in range(int(os.environ.get("ROUNDS", "30"))):
    b0 = bal()
    g = s.post(f"{API}/casino/blackjack/deal", json={"coin": "USDT", "stake": 0.1}).json()
    gid = g.get("game_id")
    if g.get("status") == "insurance":
        g = s.post(f"{API}/casino/blackjack/action", json={"game_id": gid, "action": "no_insurance"}).json()
    if g.get("status") == "active":
        rounds += 1
        acts = [random.choice(["hit", "stand", "double", "hit"]) for _ in range(PAR)]
        with cf.ThreadPoolExecutor(PAR) as ex:
            rs = list(ex.map(lambda a: requests.post(f"{API}/casino/blackjack/action",
                                                     json={"game_id": gid, "action": a}, cookies=ck), acts))
        for r in rs:
            statuses[r.status_code] = statuses.get(r.status_code, 0) + 1
        finish()
    doc = mdb.bj_games.find_one({"id": gid})
    nrec = mdb.casino_games.count_documents({"user_id": uid, "game": "blackjack", "nonce": doc["nonce"]})
    d = round(bal() - b0, 8)
    exp = round(doc["total_payout"] - doc["total_stake"], 8)
    recs.append(nrec)
    if abs(d - exp) > 1e-6 or nrec != 1 or doc.get("lock"):
        bad += 1
        print("MISMATCH", gid, "delta", d, "expected", exp, "records", nrec, "lock", doc.get("lock"))
print("records-per-hand", set(recs), "active-rounds", rounds, "mismatches", bad, "statuses", statuses,
      "stuck-locks", mdb.bj_games.count_documents({"user_id": uid, "lock": {"$nin": [None, False]}}),
      "open", mdb.bj_games.count_documents({"user_id": uid, "open": True}))
