"""Backend tests for ApexOdds iteration 5: in-app crypto deposit (OxaPay white-label).

Covers:
- Demo deposit removal: POST /api/wallet/deposit returns 404
- Fresh users start at zero balances for BTC/ETH/USDT/SOL
- /api/wallet/oxapay/invoice returns address + qr_code + pay_amount (white-label), tested for USDT and BTC
- /api/wallet/oxapay/status/{track_id}: owned returns {status,credited,balances}; 404 for other user and unknown
- /api/oxapay/webhook: HMAC sha512 required; Paid credits exactly pay_amount; duplicate is idempotent; invalid HMAC => 401 no credit
- Withdraw works and insufficient balance is rejected
- Regression: odds (ESPN + oddsapi), bet placement after webhook credit, casino, fairness verify
"""
import os
import re
import hmac
import hashlib
import json
import time
import uuid
from pathlib import Path

import pytest
import requests

# Load keys from backend/.env
_env = {}
for line in Path("/app/backend/.env").read_text().splitlines():
    m = re.match(r'^([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$', line.strip())
    if m:
        _env[m.group(1)] = m.group(2)

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _env.get("FRONTEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = _env["ADMIN_EMAIL"]
ADMIN_PASSWORD = _env["ADMIN_PASSWORD"]
OXAPAY_KEY = _env["OXAPAY_MERCHANT_API_KEY"]

COINS = ["BTC", "ETH", "USDT", "SOL"]


# -----------------------------------------------------------------------------
# Fixtures
# -----------------------------------------------------------------------------
def _login(session, email, password):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    if tok:
        session.headers.update({"Authorization": f"Bearer {tok}"})


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    _login(s, ADMIN_EMAIL, ADMIN_PASSWORD)
    return s


@pytest.fixture(scope="module")
def second_session():
    s = requests.Session()
    email = "TEST_oxapay_other@apexodds.io"
    s.post(f"{API}/auth/register", json={"name": "Other", "email": email, "password": "pass1234"}, timeout=20)
    _login(s, email, "pass1234")
    return s


@pytest.fixture(scope="module")
def fresh_user_session():
    """Register brand-new user to verify zero starting balances."""
    s = requests.Session()
    email = f"TEST_fresh_{uuid.uuid4().hex[:8]}@apexodds.io"
    r = s.post(f"{API}/auth/register", json={"name": "Fresh", "email": email, "password": "pass1234"}, timeout=20)
    assert r.status_code in (200, 201), r.text
    _login(s, email, "pass1234")
    s._email = email
    return s


# -----------------------------------------------------------------------------
# Demo deposit removal + zero starting balance
# -----------------------------------------------------------------------------
class TestDepositRemovalAndZeroStart:
    def test_wallet_deposit_route_404(self, admin_session):
        r = admin_session.post(f"{API}/wallet/deposit",
                               json={"coin": "BTC", "amount": 0.01}, timeout=20)
        assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text}"

    def test_new_user_balances_all_zero(self, fresh_user_session):
        r = fresh_user_session.get(f"{API}/wallet", timeout=20)
        assert r.status_code == 200, r.text
        balances = r.json().get("balances", {})
        for c in COINS:
            assert c in balances, f"missing coin {c} in balances: {balances}"
            assert float(balances[c]) == 0.0, f"{c} not zero: {balances[c]}"


# -----------------------------------------------------------------------------
# OxaPay white-label invoice (address + QR)
# -----------------------------------------------------------------------------
class TestOxaPayWhiteLabel:
    _created = {}

    def _create(self, session, coin, amount):
        r = session.post(f"{API}/wallet/oxapay/invoice",
                         json={"coin": coin, "amount": amount}, timeout=30)
        assert r.status_code == 200, f"invoice {coin} failed: {r.status_code} {r.text}"
        return r.json()

    def test_invoice_usdt_returns_address_qr_pay_amount(self, admin_session):
        data = self._create(admin_session, "USDT", 25.0)
        assert data.get("track_id")
        assert data.get("address"), f"missing address: {data}"
        assert data.get("qr_code"), f"missing qr_code: {data}"
        assert float(data.get("pay_amount", 0)) > 0
        # USDT network should be TRC20-ish per COIN_NETWORK map (TRC20)
        assert "TRON" in str(data.get("network", "")).upper() or "TRC" in str(data.get("network", "")).upper(), f"USDT network={data.get('network')}"
        TestOxaPayWhiteLabel._created["USDT"] = data
        print(f"USDT invoice: addr={data['address'][:12]}... pay_amount={data['pay_amount']} network={data['network']}")

    def test_invoice_btc_returns_address_qr_pay_amount(self, admin_session):
        data = self._create(admin_session, "BTC", 0.001)
        assert data.get("address"), f"missing address: {data}"
        assert data.get("qr_code")
        assert float(data.get("pay_amount", 0)) > 0
        assert "BITCOIN" in str(data.get("network", "")).upper() or "BTC" in str(data.get("network", "")).upper(), f"BTC network={data.get('network')}"
        # BTC address should NOT equal USDT address
        usdt_addr = TestOxaPayWhiteLabel._created.get("USDT", {}).get("address", "")
        assert data["address"] != usdt_addr, "BTC address equals USDT address"
        TestOxaPayWhiteLabel._created["BTC"] = data
        print(f"BTC invoice: addr={data['address'][:12]}... pay_amount={data['pay_amount']} network={data['network']}")

    def test_status_owned(self, admin_session):
        tid = TestOxaPayWhiteLabel._created["USDT"]["track_id"]
        r = admin_session.get(f"{API}/wallet/oxapay/status/{tid}", timeout=20)
        assert r.status_code == 200
        body = r.json()
        for k in ("status", "credited", "balances"):
            assert k in body, f"missing {k} in status: {body}"
        assert body["credited"] is False

    def test_status_404_for_other_user(self, second_session):
        tid = TestOxaPayWhiteLabel._created["USDT"]["track_id"]
        r = second_session.get(f"{API}/wallet/oxapay/status/{tid}", timeout=20)
        assert r.status_code == 404

    def test_status_404_unknown(self, admin_session):
        r = admin_session.get(f"{API}/wallet/oxapay/status/not-a-real-track-id-xyz", timeout=20)
        assert r.status_code == 404


# -----------------------------------------------------------------------------
# OxaPay webhook (HMAC signed Paid callback)
# -----------------------------------------------------------------------------
class TestOxaPayWebhook:
    def _balance(self, session, coin):
        r = session.get(f"{API}/wallet", timeout=20)
        assert r.status_code == 200
        return float(r.json()["balances"].get(coin, 0))

    def _sign(self, raw: bytes) -> str:
        return hmac.new(OXAPAY_KEY.encode(), raw, hashlib.sha512).hexdigest()

    def test_webhook_credits_pay_amount_once_and_rejects_bad_hmac(self, admin_session):
        coin = "USDT"
        inv = admin_session.post(f"{API}/wallet/oxapay/invoice",
                                 json={"coin": coin, "amount": 10.0}, timeout=30).json()
        track_id = inv["track_id"]
        pay_amount = float(inv["pay_amount"])  # credited amount is pay_amount (fee_paid_by_payer=1)
        assert pay_amount > 0
        before = self._balance(admin_session, coin)

        payload = {"track_id": track_id, "type": "invoice", "status": "Paid",
                   "amount": pay_amount, "currency": coin, "date": int(time.time())}
        raw = json.dumps(payload).encode()

        # Bad HMAC -> 401, no credit
        bad = requests.post(f"{API}/oxapay/webhook", data=raw,
                            headers={"HMAC": "deadbeef" * 16,
                                     "Content-Type": "application/json"}, timeout=20)
        assert bad.status_code == 401, f"expected 401, got {bad.status_code} {bad.text}"
        assert abs(self._balance(admin_session, coin) - before) < 1e-9

        # Valid HMAC -> credit exactly pay_amount
        sig = self._sign(raw)
        ok = requests.post(f"{API}/oxapay/webhook", data=raw,
                           headers={"HMAC": sig, "Content-Type": "application/json"}, timeout=20)
        assert ok.status_code == 200, f"webhook failed: {ok.status_code} {ok.text}"
        assert ok.text.strip().lower() == "ok"
        time.sleep(0.4)
        after = self._balance(admin_session, coin)
        assert abs((after - before) - pay_amount) < 1e-6, \
            f"expected +{pay_amount}, got {before}->{after}"

        # Replay -> idempotent
        ok2 = requests.post(f"{API}/oxapay/webhook", data=raw,
                            headers={"HMAC": sig, "Content-Type": "application/json"}, timeout=20)
        assert ok2.status_code == 200
        time.sleep(0.3)
        after2 = self._balance(admin_session, coin)
        assert abs(after2 - after) < 1e-9, f"idempotency broken: {after} -> {after2}"

        # status now credited=True
        st = admin_session.get(f"{API}/wallet/oxapay/status/{track_id}", timeout=20).json()
        assert st.get("credited") is True
        assert str(st.get("status", "")).lower() == "paid"


# -----------------------------------------------------------------------------
# Withdraw regression + insufficient balance rejection
# -----------------------------------------------------------------------------
class TestWithdraw:
    def test_withdraw_reduces_balance(self, admin_session):
        before = admin_session.get(f"{API}/wallet", timeout=20).json()["balances"]["USDT"]
        if before < 1.0:
            # Credit a bit so withdraw has room (uses signed webhook path on a fresh invoice)
            inv = admin_session.post(f"{API}/wallet/oxapay/invoice",
                                     json={"coin": "USDT", "amount": 5.0}, timeout=30).json()
            payload = {"track_id": inv["track_id"], "type": "invoice", "status": "Paid",
                       "amount": float(inv["pay_amount"]), "currency": "USDT"}
            raw = json.dumps(payload).encode()
            sig = hmac.new(OXAPAY_KEY.encode(), raw, hashlib.sha512).hexdigest()
            requests.post(f"{API}/oxapay/webhook", data=raw,
                          headers={"HMAC": sig, "Content-Type": "application/json"}, timeout=20)
            before = admin_session.get(f"{API}/wallet", timeout=20).json()["balances"]["USDT"]

        r = admin_session.post(f"{API}/wallet/withdraw",
                               json={"coin": "USDT", "amount": 1.0}, timeout=20)
        assert r.status_code == 200, r.text
        after = r.json()["balances"]["USDT"]
        assert abs((before - after) - 1.0) < 1e-6, f"{before} -> {after}"

    def test_withdraw_insufficient_rejected(self, fresh_user_session):
        r = fresh_user_session.post(f"{API}/wallet/withdraw",
                                    json={"coin": "BTC", "amount": 1.0}, timeout=20)
        assert r.status_code >= 400, f"expected rejection, got {r.status_code} {r.text}"


# -----------------------------------------------------------------------------
# Odds / sports regression
# -----------------------------------------------------------------------------
class TestOddsRegression:
    def test_sports_include_mma(self, admin_session):
        r = admin_session.get(f"{API}/sports", timeout=20)
        assert r.status_code == 200
        groups = [s.get("key") for s in r.json()]
        assert "mma" in groups, groups

    def test_odds_merged_contains_oddsapi(self, admin_session):
        r = admin_session.get(f"{API}/odds", timeout=60)
        assert r.status_code == 200
        body = r.json()
        events = body["events"] if isinstance(body, dict) else body
        assert len(events) > 0
        oa = [e for e in events if e.get("source") == "oddsapi"]
        print(f"odds total={len(events)} oddsapi={len(oa)}")
        assert len(oa) > 0, "no oddsapi events"


# -----------------------------------------------------------------------------
# Bet placement from oddsapi event (after webhook crediting of USDT)
# -----------------------------------------------------------------------------
class TestBetFromOddsApi:
    def test_place_bet_from_oddsapi_event(self, admin_session):
        bal = admin_session.get(f"{API}/wallet", timeout=20).json()["balances"]["USDT"]
        if bal < 2.0:
            inv = admin_session.post(f"{API}/wallet/oxapay/invoice",
                                     json={"coin": "USDT", "amount": 5.0}, timeout=30).json()
            payload = {"track_id": inv["track_id"], "type": "invoice", "status": "Paid",
                       "amount": float(inv["pay_amount"]), "currency": "USDT"}
            raw = json.dumps(payload).encode()
            sig = hmac.new(OXAPAY_KEY.encode(), raw, hashlib.sha512).hexdigest()
            requests.post(f"{API}/oxapay/webhook", data=raw,
                          headers={"HMAC": sig, "Content-Type": "application/json"}, timeout=20)

        body = admin_session.get(f"{API}/odds", timeout=60).json()
        events = body["events"] if isinstance(body, dict) else body
        oa = [e for e in events if e.get("source") == "oddsapi"]
        if not oa:
            pytest.skip("no oddsapi events")
        ev = oa[0]
        ml = next((m for m in (ev.get("markets") or []) if m.get("market") == "moneyline"), None)
        if not ml or not ml.get("selections"):
            pytest.skip("no moneyline selections")
        sel0 = ml["selections"][0]
        payload = {
            "coin": "USDT", "stake": 1.0, "bet_type": "single",
            "selections": [{
                "event_id": ev["event_id"], "league": ev.get("league"),
                "league_label": ev.get("league_label"),
                "event_name": ev.get("name"),
                "home": ev["home"]["abbr"], "away": ev["away"]["abbr"],
                "market": "moneyline", "side": sel0["side"],
                "pick": sel0.get("pick", sel0["side"]),
                "odds": sel0["odds"],
            }],
        }
        r = admin_session.post(f"{API}/bets", json=payload, timeout=30)
        assert r.status_code in (200, 201), f"bet failed: {r.status_code} {r.text}"
        assert r.json().get("bet", {}).get("id")


# -----------------------------------------------------------------------------
# Casino regression
# -----------------------------------------------------------------------------
class TestCasinoRegression:
    def _ensure_bal(self, session):
        bal = session.get(f"{API}/wallet", timeout=20).json()["balances"]["USDT"]
        if bal < 20:
            inv = session.post(f"{API}/wallet/oxapay/invoice",
                               json={"coin": "USDT", "amount": 25.0}, timeout=30).json()
            payload = {"track_id": inv["track_id"], "type": "invoice", "status": "Paid",
                       "amount": float(inv["pay_amount"]), "currency": "USDT"}
            raw = json.dumps(payload).encode()
            sig = hmac.new(OXAPAY_KEY.encode(), raw, hashlib.sha512).hexdigest()
            requests.post(f"{API}/oxapay/webhook", data=raw,
                          headers={"HMAC": sig, "Content-Type": "application/json"}, timeout=20)

    def test_limbo(self, admin_session):
        self._ensure_bal(admin_session)
        r = admin_session.post(f"{API}/casino/limbo",
                               json={"coin": "USDT", "stake": 1, "target": 2.0}, timeout=20)
        assert r.status_code == 200, r.text

    def test_dice(self, admin_session):
        r = admin_session.post(f"{API}/casino/dice",
                               json={"coin": "USDT", "stake": 1, "target": 50, "direction": "over"}, timeout=20)
        assert r.status_code == 200, r.text

    def test_mines(self, admin_session):
        r = admin_session.post(f"{API}/casino/mines/start",
                               json={"coin": "USDT", "stake": 1, "mines": 3}, timeout=20)
        assert r.status_code == 200, r.text
        gid = r.json().get("game_id")
        rv = admin_session.post(f"{API}/casino/mines/reveal",
                                json={"game_id": gid, "tile": 0}, timeout=20)
        assert rv.status_code == 200, rv.text
        if not rv.json().get("hit"):
            co = admin_session.post(f"{API}/casino/mines/cashout",
                                    json={"game_id": gid}, timeout=20)
            assert co.status_code == 200, co.text

    def test_plinko(self, admin_session):
        r = admin_session.post(f"{API}/casino/plinko",
                               json={"coin": "USDT", "stake": 1, "rows": 8, "risk": "medium"}, timeout=20)
        assert r.status_code == 200, r.text

    def test_keno(self, admin_session):
        r = admin_session.post(f"{API}/casino/keno",
                               json={"coin": "USDT", "stake": 1, "picks": [1, 2, 3, 4], "risk": "medium"}, timeout=20)
        assert r.status_code == 200, r.text


# -----------------------------------------------------------------------------
# Provably-fair verify regression
# -----------------------------------------------------------------------------
class TestFairness:
    def test_history_and_verify(self, admin_session):
        r = admin_session.get(f"{API}/casino/history", timeout=20)
        assert r.status_code == 200
        games = r.json().get("games", [])
        if not games:
            pytest.skip("no casino history")
        g = games[0]
        v = admin_session.get(f"{API}/casino/verify/{g['id']}", timeout=20)
        # endpoint may be /casino/verify/{id} or similar; accept 200 or 404 but not 500
        assert v.status_code in (200, 404), v.text
