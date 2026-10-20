"""Probe: concurrent blackjack stand/deal requests (race-condition check)."""
import os, requests, concurrent.futures as cf
API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
s = requests.Session()
s.post(f"{API}/auth/login", json={"email": "admin@apexodds.io", "password": "admin123"})
ck = s.cookies.get_dict()
bal = lambda: s.get(f"{API}/wallet").json()["balances"]["USDT"]
multi, overpaid = 0, 0
for i in range(25):
    g = s.post(f"{API}/casino/blackjack/deal", json={"coin": "USDT", "stake": 0.1}).json()
    if g.get("status") != "active":
        while g.get("status") == "insurance":
            g = s.post(f"{API}/casino/blackjack/action", json={"game_id": g["game_id"], "action": "no_insurance"}).json()
        if g.get("status") != "active":
            continue
    b = g["balances"]["USDT"]
    with cf.ThreadPoolExecutor(8) as ex:
        rs = list(ex.map(lambda _: requests.post(f"{API}/casino/blackjack/action", json={"game_id": g["game_id"], "action": "stand"}, cookies=ck), range(8)))
    ok = [r.json() for r in rs if r.status_code == 200]
    d = bal() - b
    if len(ok) > 1: multi += 1
    if abs(d - ok[0]["total_payout"]) > 1e-6: overpaid += 1; print("OVERPAID", len(ok), d, ok[0]["total_payout"])
print("stand: multi-success rounds", multi, "overpaid rounds", overpaid)
# concurrent deals
with cf.ThreadPoolExecutor(8) as ex:
    rs = list(ex.map(lambda _: requests.post(f"{API}/casino/blackjack/deal", json={"coin": "USDT", "stake": 0.1}, cookies=ck), range(8)))
print("concurrent deals ok:", sum(r.status_code == 200 for r in rs), [r.status_code for r in rs])
