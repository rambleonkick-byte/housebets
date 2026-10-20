# OxaPay static-address webhook: credit tx.currency (not address coin), dedupe, unsupported, HMAC
import hashlib
import hmac
import json
import os
import uuid

import pytest
import requests
from pymongo import MongoClient


def _env(path, key):
    for line in open(path):
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip().strip('"')


BASE_URL = _env("/app/frontend/.env", "REACT_APP_BACKEND_URL").rstrip("/")
OXA_KEY = _env("/app/backend/.env", "OXAPAY_MERCHANT_API_KEY")
mdb = MongoClient(_env("/app/backend/.env", "MONGO_URL"))[_env("/app/backend/.env", "DB_NAME")]
PROTECTED = {"admin@apexodds.io", "dhensley727@icloud.com"}
RUN = uuid.uuid4().hex[:8]
TRACK = f"TEST-TRACK-{RUN}"


def send(body, key=OXA_KEY):
    raw = json.dumps(body).encode()
    sig = hmac.new(key.encode(), raw, hashlib.sha512).hexdigest()
    return requests.post(f"{BASE_URL}/api/oxapay/webhook", data=raw,
                         headers={"HMAC": sig, "Content-Type": "application/json"}, timeout=30)


def evt(*txs):
    return {"type": "static_address", "track_id": TRACK, "txs": list(txs)}


@pytest.fixture(scope="module")
def user():
    email = f"test_static_{RUN}@example.com"
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/register", json={"name": "TEST Static", "email": email, "password": "Passw0rd!123"})
    assert r.status_code in (200, 201), r.text
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    me = s.get(f"{BASE_URL}/api/auth/me").json()
    uid = me.get("id") or me.get("user", {}).get("id")
    assert uid
    s.get(f"{BASE_URL}/api/wallet")  # ensure wallet
    mdb.static_addresses.insert_one({"user_id": uid, "coin": "SOL", "net": "SOL",
                                     "address": f"TESTADDR{RUN}", "track_id": TRACK})
    yield {"s": s, "id": uid, "email": email}
    assert email not in PROTECTED
    for c in ("wallets", "static_addresses", "static_deposits", "transactions", "notifications",
              "bets", "casino_games", "affiliates", "user_sessions", "login_attempts"):
        mdb[c].delete_many({"user_id": uid})
    mdb.users.delete_one({"email": email})  # users keyed by ObjectId _id; match by unique test email


def bal(u):
    return u["s"].get(f"{BASE_URL}/api/wallet").json()["balances"]


class TestStaticDeposit:
    def test_bad_hmac_401(self, user):
        r = send(evt({"tx_hash": f"BAD{RUN}", "status": "confirmed", "sent_amount": 999, "currency": "USDT"}), key="wrong")
        assert r.status_code == 401
        assert bal(user)["USDT"] == 0

    def test_usdt_to_sol_address_credits_usdt(self, user):
        before = bal(user)
        r = send(evt({"tx_hash": f"TESTHASH1-{RUN}", "status": "confirmed", "sent_amount": 200,
                      "received_amount": 200, "currency": "USDT", "value": 200}))
        assert r.status_code == 200 and r.text.strip('"') == "ok"
        after = bal(user)
        assert after["USDT"] == pytest.approx(before["USDT"] + 200)
        assert after["SOL"] == before["SOL"]
        sd = mdb.static_deposits.find_one({"tx_hash": f"TESTHASH1-{RUN}"})
        assert sd["coin"] == "USDT" and sd["amount"] == 200 and sd["user_id"] == user["id"]
        tx = mdb.transactions.find_one({"hash": f"oxapay-static:TESTHASH1-{RUN}"})
        assert tx["coin"] == "USDT" and tx["amount"] == 200 and tx["type"] == "deposit"

    def test_resend_dedupes(self, user):
        before = bal(user)
        r = send(evt({"tx_hash": f"TESTHASH1-{RUN}", "status": "confirmed", "sent_amount": 200, "currency": "USDT"}))
        assert r.status_code == 200
        assert bal(user) == before
        assert mdb.transactions.count_documents({"hash": f"oxapay-static:TESTHASH1-{RUN}"}) == 1

    def test_sol_currency_credits_sol(self, user):
        before = bal(user)
        send(evt({"tx_hash": f"TESTHASH2-{RUN}", "status": "confirmed", "sent_amount": 1.5, "currency": "SOL"}))
        after = bal(user)
        assert after["SOL"] == pytest.approx(before["SOL"] + 1.5)
        assert after["USDT"] == before["USDT"]

    def test_missing_currency_falls_back_to_address_coin(self, user):
        before = bal(user)
        send(evt({"tx_hash": f"TESTHASH3-{RUN}", "status": "confirmed", "sent_amount": 0.5}))
        after = bal(user)
        assert after["SOL"] == pytest.approx(before["SOL"] + 0.5)
        assert mdb.static_deposits.find_one({"tx_hash": f"TESTHASH3-{RUN}"})["coin"] == "SOL"

    def test_lowercase_currency(self, user):
        before = bal(user)
        send(evt({"tx_hash": f"TESTHASH5-{RUN}", "status": "confirmed", "sent_amount": 10, "currency": "usdt"}))
        assert bal(user)["USDT"] == pytest.approx(before["USDT"] + 10)

    def test_unsupported_currency_not_credited(self, user):
        before = bal(user)
        send(evt({"tx_hash": f"TESTHASH4-{RUN}", "status": "confirmed", "sent_amount": 500, "currency": "TRX"}))
        assert bal(user) == before
        assert mdb.static_deposits.find_one({"tx_hash": f"TESTHASH4-{RUN}"}) is None

    def test_unconfirmed_not_credited(self, user):
        before = bal(user)
        send(evt({"tx_hash": f"TESTHASH6-{RUN}", "status": "pending", "sent_amount": 50, "currency": "USDT"}))
        assert bal(user) == before

    def test_usd_total_reasonable(self, user):
        b = bal(user)
        rates = requests.get(f"{BASE_URL}/api/prices").json()["rates"]
        usd = sum(b[c] * float(rates.get(c, 0)) for c in b)
        sol_usd = 2.0 * float(rates["SOL"])
        print("balances", b, "rates", rates, "usd", usd)
        assert b["USDT"] == pytest.approx(210)
        assert usd == pytest.approx(210 * float(rates.get("USDT", 1)) + sol_usd, rel=0.01)
        assert usd < 210 + sol_usd + 5
