# USD-only wallet refactor (iteration 18): prices, bets/casino USD-only, static deposit webhook -> USD,
# withdraw in USD paid in crypto, admin reject refunds USD, admin adjust USD, migration idempotency.
import os
import json
import hmac
import hashlib
import uuid
import asyncio
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
MERCHANT_KEY = os.environ.get("OXAPAY_MERCHANT_API_KEY")
ADMIN = {"email": "admin@apexodds.io", "password": "admin123"}


def run(x):
    if asyncio.iscoroutine(x):
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(x)
        finally:
            loop.close()
    return x


def mdb():
    return AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


_SYNC = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


async def _set_usd(uid, amt):
    await mdb().wallets.update_one({"user_id": uid}, {"$set": {"balances": {"USD": amt}}}, upsert=True)


async def _wallet(uid):
    return await mdb().wallets.find_one({"user_id": uid}, {"_id": 0})


async def _cleanup(uids):
    db = mdb()
    for uid in uids:
        for c in ["wallets", "bets", "casino_games", "transactions", "withdrawals", "static_addresses",
                  "static_deposits", "notifications", "bj_games", "mine_games", "fair_seeds", "admin_actions",
                  "oxa_invoices", "affiliates"]:
            await db[c].delete_many({"user_id": uid})
        await db.users.delete_one({"_id": ObjectId(uid)})


@pytest.fixture(scope="module")
def user():
    s = requests.Session()
    email = f"test_usd_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{API}/auth/register", json={"name": "TEST USD", "email": email, "password": "test1234"}, timeout=20)
    assert r.status_code == 200, r.text
    uid = s.get(f"{API}/auth/me", timeout=15).json()["id"]
    run(_set_usd(uid, 1000.0))
    yield {"s": s, "id": uid, "email": email}
    run(_cleanup([uid]))


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200
    return s


def bal(user):
    return user["s"].get(f"{API}/wallet", timeout=20).json()["balances"]


# --- prices ---
def test_prices_live_usd():
    d = requests.get(f"{API}/prices", timeout=30).json()
    assert d["live"] is True
    assert d["rates"]["USD"] == 1.0 and d["rates"]["USDT"] == 1.0
    assert d["rates"]["BTC"] > 1000 and d["rates"]["ETH"] > 100 and d["rates"]["SOL"] > 1


# --- new wallet ---
def test_new_wallet_only_usd(user):
    b = bal(user)
    assert set(b.keys()) == {"USD"}, b
    assert b["USD"] == 1000.0


# --- casino USD only ---
@pytest.mark.parametrize("path,body", [
    ("dice", {"stake": 1, "target": 50, "direction": "over"}),
    ("limbo", {"stake": 1, "target": 2}),
    ("keno", {"stake": 1, "picks": [1, 2, 3], "risk": "medium"}),
    ("plinko", {"stake": 1, "risk": "medium", "rows": 16}),
])
def test_casino_usd_ok_and_crypto_rejected(user, path, body):
    r = user["s"].post(f"{API}/casino/{path}", json={**body, "coin": "BTC"}, timeout=20)
    assert r.status_code == 400, r.text
    before = bal(user)["USD"]
    r = user["s"].post(f"{API}/casino/{path}", json={**body, "coin": "USD"}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert set(d["balances"].keys()) == {"USD"}
    assert round(d["balances"]["USD"] - (before - 1 + d["payout"]), 6) == 0


def test_mines_usd(user):
    s = user["s"]
    assert s.post(f"{API}/casino/mines/start", json={"coin": "ETH", "stake": 1, "mines": 3}, timeout=20).status_code == 400
    r = s.post(f"{API}/casino/mines/start", json={"coin": "USD", "stake": 1, "mines": 3}, timeout=20)
    assert r.status_code == 200, r.text
    gid = r.json().get("game_id") or r.json().get("id") or r.json().get("game", {}).get("id")
    r2 = s.post(f"{API}/casino/mines/reveal", json={"game_id": gid, "tile": 0}, timeout=20)
    assert r2.status_code == 200, r2.text
    if r2.json().get("status", r2.json().get("game", {}).get("status")) == "active":
        r3 = s.post(f"{API}/casino/mines/cashout", json={"game_id": gid}, timeout=20)
        assert r3.status_code == 200, r3.text
    assert set(bal(user).keys()) == {"USD"}


def test_blackjack_usd(user):
    s = user["s"]
    assert s.post(f"{API}/casino/blackjack/deal", json={"coin": "SOL", "stake": 1}, timeout=20).status_code == 400
    r = s.post(f"{API}/casino/blackjack/deal", json={"coin": "USD", "stake": 1}, timeout=20)
    assert r.status_code == 200, r.text
    g = r.json()
    gid = g.get("id") or g.get("game_id") or (g.get("game") or {}).get("id")
    for _ in range(4):
        st = g.get("status") or (g.get("game") or {}).get("status")
        if st == "done":
            break
        act = "stand" if st == "active" else "insurance_no"
        r = s.post(f"{API}/casino/blackjack/action", json={"game_id": gid, "action": act}, timeout=20)
        if r.status_code != 200 and st == "insurance":
            r = s.post(f"{API}/casino/blackjack/action", json={"game_id": gid, "action": "no_insurance"}, timeout=20)
        assert r.status_code == 200, r.text
        g = r.json()
    assert set(bal(user).keys()) == {"USD"}


# --- sportsbook USD only ---
def test_bet_usd_ok_crypto_rejected(user):
    boosts = requests.get(f"{API}/boosts", timeout=90).json().get("boosts") or []
    if not boosts:
        pytest.skip("no boosts/odds available to build a selection")
    keys = ["event_id", "league", "league_label", "home", "away", "market", "pick", "side", "line", "odds"]
    leg = {k: boosts[0]["legs"][0].get(k) for k in keys}
    s = user["s"]
    r = s.post(f"{API}/bets", json={"selections": [leg], "stake": 2, "coin": "BTC", "bet_type": "single"}, timeout=30)
    assert r.status_code == 400, r.text
    before = bal(user)["USD"]
    r = s.post(f"{API}/bets", json={"selections": [leg], "stake": 2, "coin": "USD", "bet_type": "single"}, timeout=30)
    if r.status_code == 409:
        pytest.skip(f"selection changed: {r.text[:200]}")
    assert r.status_code == 200, r.text
    bet = r.json().get("bet", r.json())
    assert bet["coin"] == "USD" and bet["stake"] == 2
    assert round(bal(user)["USD"] - (before - 2), 6) == 0


# --- static deposit webhook ---
def _signed(body):
    raw = json.dumps(body).encode()
    sig = hmac.new(MERCHANT_KEY.encode(), raw, hashlib.sha512).hexdigest()
    return requests.post(f"{API}/oxapay/webhook", data=raw, timeout=30,
                         headers={"HMAC": sig, "Content-Type": "application/json"})


def test_static_deposit_btc_and_usdt_to_usd(user):
    uid = user["id"]
    tid = "T-" + uuid.uuid4().hex[:8]
    run(_SYNC.static_addresses.insert_one({"user_id": uid, "coin": "BTC", "net": "BTC", "address": "X", "track_id": tid}))
    rate = requests.get(f"{API}/prices", timeout=30).json()["rates"]["BTC"]
    before = run(_wallet(uid))["balances"]["USD"]
    h = "H-" + uuid.uuid4().hex
    r = _signed({"type": "static_address", "track_id": tid,
                 "txs": [{"tx_hash": h, "status": "confirmed", "sent_amount": 0.001, "currency": "BTC"}]})
    assert r.status_code == 200 and r.text == "ok"
    w = run(_wallet(uid))
    assert set(w["balances"].keys()) == {"USD"}
    gained = round(w["balances"]["USD"] - before, 2)
    assert abs(gained - round(0.001 * rate, 2)) <= max(0.02, rate * 0.001 * 0.005), (gained, rate)
    tx = run(_SYNC.transactions.find_one({"hash": "oxapay-static:" + h}))
    assert tx["coin"] == "USD" and tx["crypto_coin"] == "BTC" and tx["crypto_amount"] == 0.001
    sd = run(_SYNC.static_deposits.find_one({"tx_hash": h}))
    assert sd["amount_usd"] == tx["amount"]
    # replay -> no double credit
    _signed({"type": "static_address", "track_id": tid,
             "txs": [{"tx_hash": h, "status": "confirmed", "sent_amount": 0.001, "currency": "BTC"}]})
    assert run(_wallet(uid))["balances"]["USD"] == w["balances"]["USD"]
    # USDT 1:1
    h2 = "H-" + uuid.uuid4().hex
    _signed({"type": "static_address", "track_id": tid,
             "txs": [{"tx_hash": h2, "status": "confirmed", "sent_amount": 25.5, "currency": "USDT"}]})
    assert round(run(_wallet(uid))["balances"]["USD"] - w["balances"]["USD"], 2) == 25.5


def test_webhook_bad_signature():
    r = requests.post(f"{API}/oxapay/webhook", data=b'{"type":"static_address"}',
                      headers={"HMAC": "bad", "Content-Type": "application/json"}, timeout=15)
    assert r.status_code == 401


# --- withdraw ---
def test_withdraw_usd_to_btc_and_reject_refund(user, admin):
    s, uid = user["s"], user["id"]
    run(_set_usd(uid, 500.0))
    r = s.post(f"{API}/wallet/withdraw", json={"coin": "BTC", "amount": 600, "address": "bc1qtestaddress000000"}, timeout=30)
    assert r.status_code == 400
    rate = requests.get(f"{API}/prices", timeout=30).json()["rates"]["BTC"]
    r = s.post(f"{API}/wallet/withdraw", json={"coin": "BTC", "amount": 100, "address": "bc1qtestaddress000000"}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["balances"] == {"USD": 400.0}
    wd = run(_SYNC.withdrawals.find_one({"id": d["withdrawal_id"]}))
    assert wd["coin"] == "BTC" and wd["amount_usd"] == 100
    assert abs(wd["amount"] - 100 / rate) / (100 / rate) < 0.01
    tx = run(_SYNC.transactions.find_one({"hash": "withdraw:" + d["withdrawal_id"]}))
    assert tx["coin"] == "USD" and tx["amount"] == 100 and tx["crypto_coin"] == "BTC"
    # admin list shows it
    lst = admin.get(f"{API}/admin/withdrawals", params={"status": "pending_approval"}, timeout=20).json()["withdrawals"]
    assert any(x["id"] == d["withdrawal_id"] and x["amount_usd"] == 100 for x in lst)
    r = admin.post(f"{API}/admin/withdrawals/{d['withdrawal_id']}/reject", timeout=20)
    assert r.status_code == 200, r.text
    assert run(_wallet(uid))["balances"]["USD"] == 500.0
    # second reject -> 404
    assert admin.post(f"{API}/admin/withdrawals/{d['withdrawal_id']}/reject", timeout=20).status_code == 404


def test_withdraw_invalid(user):
    s = user["s"]
    assert s.post(f"{API}/wallet/withdraw", json={"coin": "USD", "amount": 10, "address": "bc1qtestaddress000000"}, timeout=20).status_code == 400
    assert s.post(f"{API}/wallet/withdraw", json={"coin": "BTC", "amount": -5, "address": "bc1qtestaddress000000"}, timeout=20).status_code == 400
    assert s.post(f"{API}/wallet/withdraw", json={"coin": "BTC", "amount": 10, "address": "short"}, timeout=20).status_code == 400


def test_withdraw_tiny_amount(user):
    # 0.001 USD rounds to 0.00 -> should be a clean 400 "Invalid"/"minimum", not create a $0 withdrawal
    r = user["s"].post(f"{API}/wallet/withdraw", json={"coin": "BTC", "amount": 0.001, "address": "bc1qtestaddress000000"}, timeout=20)
    print("tiny withdraw:", r.status_code, r.text[:200])
    assert r.status_code == 400


# --- admin adjust ---
def test_admin_adjust_usd(user, admin):
    uid = user["id"]
    start = run(_wallet(uid))["balances"]["USD"]
    r = admin.post(f"{API}/admin/users/{uid}/adjust", json={"coin": "USD", "amount": 12.34, "reason": "TEST adj"}, timeout=20)
    assert r.status_code == 200, r.text
    assert round(r.json()["balances"]["USD"] - (start + 12.34), 6) == 0
    r = admin.post(f"{API}/admin/users/{uid}/adjust", json={"coin": "BTC", "amount": 1, "reason": "TEST adj"}, timeout=20)
    assert r.status_code == 400
    r = admin.post(f"{API}/admin/users/{uid}/adjust", json={"coin": "USD", "amount": -10**7, "reason": "TEST adj"}, timeout=20)
    assert r.status_code == 400


# --- migration already applied, idempotent ---
def test_migration_state():
    async def q():
        db = mdb()
        bad = await db.wallets.count_documents({"$or": [{"balances.BTC": {"$exists": True}}, {"balances.ETH": {"$exists": True}},
                                                         {"balances.USDT": {"$exists": True}}, {"balances.SOL": {"$exists": True}}]})
        open_crypto = await db.bets.count_documents({"status": "open", "coin": {"$ne": "USD"}})
        wd_missing = await db.withdrawals.count_documents({"amount_usd": {"$exists": False}, "refunded": {"$ne": True}})
        admin_w = await db.wallets.find_one({"user_id": "6ad5bc3b615e5bf27f902ee4"})
        bj_crypto = await db.bj_games.count_documents({"open": True, "coin": {"$ne": "USD"}})
        return bad, open_crypto, wd_missing, admin_w, bj_crypto
    bad, open_crypto, wd_missing, admin_w, bj_crypto = run(q())
    print("open crypto blackjack hands:", bj_crypto)
    assert bad == 0 and open_crypto == 0 and wd_missing == 0
    assert admin_w["usd_migrated"] is True and "pre_usd_balances" in admin_w
