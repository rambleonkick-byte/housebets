# Iteration 19: retest of USD-wallet fixes from iteration 18
# (min withdrawal, alert amount_usd, admin Withdrawn in USD, affiliate NGR/claim in USD, legacy _adjust -> USD)
import os
import uuid
import pytest
import requests
from bson import ObjectId
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN = {"email": "admin@apexodds.io", "password": "admin123"}
DB = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
ADDR = "bc1qtestaddress000000"


def _cleanup(uids):
    for uid in uids:
        for c in ["wallets", "bets", "casino_games", "transactions", "withdrawals", "static_addresses",
                  "static_deposits", "notifications", "bj_games", "mine_games", "fair_seeds", "admin_actions",
                  "oxa_invoices", "affiliates"]:
            DB[c].delete_many({"user_id": uid})
        DB.affiliate_ledger.delete_many({"$or": [{"affiliate_id": uid}, {"player_id": uid}]})
        DB.affiliate_earnings.delete_many({"$or": [{"affiliate_id": uid}, {"player_id": uid}]})
        DB.users.delete_one({"_id": ObjectId(uid)})


def _register(ref=None):
    s = requests.Session()
    email = f"test_it19_{uuid.uuid4().hex[:8]}@example.com"
    body = {"name": "TEST IT19", "email": email, "password": "test1234"}
    if ref:
        body["ref_code"] = ref
    r = s.post(f"{API}/auth/register", json=body, timeout=20)
    assert r.status_code == 200, r.text
    uid = s.get(f"{API}/auth/me", timeout=15).json()["id"]
    return s, uid


def _set_usd(uid, amt):
    DB.wallets.update_one({"user_id": uid}, {"$set": {"balances": {"USD": amt}}}, upsert=True)


def _bal(uid):
    return DB.wallets.find_one({"user_id": uid})["balances"]


@pytest.fixture(scope="module")
def created():
    ids = []
    yield ids
    _cleanup(ids)


@pytest.fixture(scope="module")
def user(created):
    s, uid = _register()
    created.append(uid)
    _set_usd(uid, 500.0)
    return {"s": s, "id": uid}


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    assert s.post(f"{API}/auth/login", json=ADMIN, timeout=15).status_code == 200
    return s


# --- min withdrawal ---
@pytest.mark.parametrize("amt", [0.5, 0.001, 0.99])
def test_min_withdrawal(user, amt):
    r = user["s"].post(f"{API}/wallet/withdraw", json={"coin": "BTC", "amount": amt, "address": ADDR}, timeout=20)
    assert r.status_code == 400, r.text
    assert r.json()["detail"] == "Minimum withdrawal is $1.00"
    assert _bal(user["id"]) == {"USD": 500.0}


def test_withdraw_exactly_one_dollar_ok(user, admin):
    r = user["s"].post(f"{API}/wallet/withdraw", json={"coin": "USDT", "amount": 1, "address": "TXyzTestAddress0000000000000000000"}, timeout=20)
    assert r.status_code == 200, r.text
    assert r.json()["balances"] == {"USD": 499.0}
    assert admin.post(f"{API}/admin/withdrawals/{r.json()['withdrawal_id']}/reject", timeout=20).status_code == 200
    assert _bal(user["id"]) == {"USD": 500.0}


# --- deposit alerts include amount_usd ---
def test_deposit_alert_amount_usd(user):
    h = "TEST-H-" + uuid.uuid4().hex
    DB.static_deposits.insert_one({"user_id": user["id"], "tx_hash": h, "coin": "BTC", "net": "BTC", "amount": 0.0005,
                                   "amount_usd": 41.48, "notified": False, "created_at": "2026-01-01T00:00:00+00:00"})
    d = user["s"].get(f"{API}/wallet/deposit-alerts", timeout=40).json()
    a = [x for x in d["alerts"] if x["tx_hash"] == h]
    assert a and a[0]["amount_usd"] == 41.48 and a[0]["amount"] == 0.0005 and a[0]["coin"] == "BTC"
    n = DB.notifications.find_one({"user_id": user["id"], "key": f"dep:{h}"})
    assert n and n["amount_usd"] == 41.48


# --- withdrawal alerts + notification include amount_usd; admin Withdrawn sums amount_usd ---
def test_withdrawal_alert_and_admin_withdrawn_usd(user, admin):
    s, uid = user["s"], user["id"]
    r = s.post(f"{API}/wallet/withdraw", json={"coin": "BTC", "amount": 100, "address": ADDR}, timeout=30)
    assert r.status_code == 200, r.text
    wid = r.json()["withdrawal_id"]
    rows = admin.get(f"{API}/admin/users", params={"q": "test_it19"}, timeout=30).json()["users"]
    row = next(x for x in rows if x["id"] == uid)
    assert row["withdrawals"] == {"USD": 100.0}, row["withdrawals"]
    q = admin.get(f"{API}/admin/withdrawals", params={"status": "pending_approval"}, timeout=20).json()["withdrawals"]
    assert any(x["id"] == wid and x["amount_usd"] == 100 for x in q)
    assert admin.post(f"{API}/admin/withdrawals/{wid}/reject", timeout=20).status_code == 200
    assert _bal(uid) == {"USD": 500.0}
    d = s.get(f"{API}/wallet/deposit-alerts", timeout=40).json()
    w = [x for x in d["withdrawals"] if x["id"] == wid]
    assert w and w[0]["stage"] == "refunded" and w[0]["amount_usd"] == 100
    n = DB.notifications.find_one({"user_id": uid, "key": f"wd:{wid}:refunded"})
    assert n and n["amount_usd"] == 100
    rows = admin.get(f"{API}/admin/users", params={"q": "test_it19"}, timeout=30).json()["users"]
    row = next(x for x in rows if x["id"] == uid)
    assert row["withdrawals"] in ({}, {"USD": 0.0}), row["withdrawals"]


# --- affiliate: legacy crypto casino rows valued in USD, claim credits USD ---
def test_affiliate_legacy_crypto_ngr_claims_usd(created):
    sa, aff = _register()
    created.append(aff)
    code = sa.get(f"{API}/affiliate", timeout=30).json()["code"]
    sp, pid = _register(ref=code)
    created.append(pid)
    assert DB.users.find_one({"_id": ObjectId(pid)}).get("referred_by") == aff
    DB.casino_games.insert_one({"id": str(uuid.uuid4()), "user_id": pid, "game": "dice", "coin": "USDT", "stake": 100.0,
                                "multiplier": 0, "payout": 0.0, "won": False, "detail": {}, "created_at": "2026-01-01T00:00:00+00:00"})
    DB.casino_games.insert_one({"id": str(uuid.uuid4()), "user_id": pid, "game": "dice", "coin": "USD", "stake": 50.0,
                                "multiplier": 0, "payout": 0.0, "won": False, "detail": {}, "created_at": "2026-01-01T00:00:00+00:00"})
    p = sa.get(f"{API}/affiliate", timeout=30).json()
    assert set(p["available"].keys()) == {"USD"}, p["available"]
    assert abs(p["available"]["USD"] - 15.0) < 0.01
    assert DB.affiliate_ledger.count_documents({"affiliate_id": aff, "coin": {"$ne": "USD"}}) == 0
    _set_usd(aff, 0.0)
    r = sa.post(f"{API}/affiliate/claim", timeout=30)
    assert r.status_code == 200, r.text
    assert set(r.json()["balances"].keys()) == {"USD"}
    assert abs(r.json()["balances"]["USD"] - 15.0) < 0.01
    assert sa.post(f"{API}/affiliate/claim", timeout=30).status_code == 400


# --- regression: dice in USD ---
def test_dice_usd_regression(user):
    before = _bal(user["id"])["USD"]
    r = user["s"].post(f"{API}/casino/dice", json={"coin": "USD", "stake": 1, "target": 50, "direction": "over"}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert set(d["balances"].keys()) == {"USD"}
    assert round(d["balances"]["USD"] - (before - 1 + d["payout"]), 6) == 0
