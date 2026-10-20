"""Iteration 9: foreign game_id -> 404, stale lock (>15s) recovered, fresh lock -> 409."""
import os, requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
env = dict(l.strip().split("=", 1) for l in open("/app/backend/.env") if "=" in l)
mdb = MongoClient(env["MONGO_URL"].strip('"'))[env["DB_NAME"].strip('"')]
API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
a, p = requests.Session(), requests.Session()
a.post(f"{API}/auth/login", json={"email": "admin@apexodds.io", "password": "admin123"})
p.post(f"{API}/auth/login", json={"email": "player@apexodds.io", "password": "player123"})
for _ in range(20):
    g = p.post(f"{API}/casino/blackjack/deal", json={"coin": "USDT", "stake": 0.1}).json()
    if g.get("status") == "insurance":
        g = p.post(f"{API}/casino/blackjack/action", json={"game_id": g["game_id"], "action": "no_insurance"}).json()
    if g.get("status") == "active":
        break
gid = g["game_id"]
print("foreign:", a.post(f"{API}/casino/blackjack/action", json={"game_id": gid, "action": "stand"}).status_code)
mdb.bj_games.update_one({"id": gid}, {"$set": {"lock": "x", "lock_at": datetime.now(timezone.utc).isoformat()}})
print("fresh lock:", p.post(f"{API}/casino/blackjack/action", json={"game_id": gid, "action": "stand"}).status_code)
old = (datetime.now(timezone.utc) - timedelta(seconds=30)).isoformat()
mdb.bj_games.update_one({"id": gid}, {"$set": {"lock": "x", "lock_at": old}})
r = p.post(f"{API}/casino/blackjack/action", json={"game_id": gid, "action": "stand"})
print("stale lock:", r.status_code, r.json().get("status"), "lock after:", mdb.bj_games.find_one({"id": gid}).get("lock"))
# legacy lock=True with no lock_at
for _ in range(20):
    g = p.post(f"{API}/casino/blackjack/deal", json={"coin": "USDT", "stake": 0.1}).json()
    if g.get("status") == "insurance":
        g = p.post(f"{API}/casino/blackjack/action", json={"game_id": g["game_id"], "action": "no_insurance"}).json()
    if g.get("status") == "active":
        break
mdb.bj_games.update_one({"id": g["game_id"]}, {"$set": {"lock": True}, "$unset": {"lock_at": ""}})
print("legacy lock=True no lock_at:", p.post(f"{API}/casino/blackjack/action", json={"game_id": g["game_id"], "action": "stand"}).status_code)
mdb.bj_games.update_one({"id": g["game_id"]}, {"$set": {"lock": None}})
print("cleanup stand:", p.post(f"{API}/casino/blackjack/action", json={"game_id": g["game_id"], "action": "stand"}).status_code)
