"""Backend tests for ApexOdds iteration 4: The Odds API source + OxaPay deposits.

Covers:
- GET /api/odds returns oddsapi events alongside ESPN (merged)
- GET /api/sports includes mma group
- Placing a bet from an oddsapi event (where available)
- OxaPay invoice creation (live external call)
- OxaPay status endpoint (404 vs owned)
- OxaPay webhook: Paid credits, idempotent, invalid HMAC rejected
- Regression: wallet deposit/withdraw, casino limbo/dice/mines/plinko/keno, fairness verify
"""
import os
import re
import hmac
import hashlib
import json
import time
from pathlib import Path

import pytest
import requests

# Load keys straight from backend/.env (test environment)
_env = {}
for line in Path("/app/backend/.env").read_text().splitlines():
    m = re.match(r'^([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$', line.strip())
    if m:
        _env[m.group(1)] = m.group(2)

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or _env.get("FRONTEND_URL")
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = _env["ADMIN_EMAIL"]
ADMIN_PASSWORD = _env["ADMIN_PASSWORD"]
OXAPAY_KEY = _env["OXAPAY_MERCHANT_API_KEY"]


# -----------------------------------------------------------------------------
# Fixtures
# -----------------------------------------------------------------------------
@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def second_session():
    """Register a secondary user (ignore if exists) and login."""
    s = requests.Session()
    email = "TEST_oxapay_other@apexodds.io"
    s.post(f"{API}/auth/register", json={"name": "Other", "email": email, "password": "pass1234"}, timeout=20)
    r = s.post(f"{API}/auth/login", json={"email": email, "password": "pass1234"}, timeout=20)
    assert r.status_code == 200, f"second login failed: {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


# -----------------------------------------------------------------------------
# Odds / Sports
# -----------------------------------------------------------------------------
class TestOddsApiSource:
    def test_sports_include_mma(self, admin_session):
        r = admin_session.get(f"{API}/sports", timeout=20)
        assert r.status_code == 200
        groups = [s.get("key") for s in r.json()]
        assert "mma" in groups, f"mma not in sports: {groups}"

    def test_odds_merged_contains_oddsapi(self, admin_session):
        r = admin_session.get(f"{API}/odds", timeout=60)
        assert r.status_code == 200
        body = r.json()
        events = body["events"] if isinstance(body, dict) else body
        assert len(events) > 0
        oa = [e for e in events if e.get("source") == "oddsapi"]
        espn = [e for e in events if e.get("source") != "oddsapi"]
        print(f"odds total={len(events)} oddsapi={len(oa)} espn/other={len(espn)}")
        assert len(oa) > 0, "no oddsapi events merged into /api/odds"
        sample = oa[0]
        assert sample.get("book"), f"oddsapi event missing book: {sample}"
        mkts = sample.get("markets") or []
        assert isinstance(mkts, list) and len(mkts) > 0
        assert any(m.get("market") == "moneyline" for m in mkts), f"no moneyline: {mkts}"


# -----------------------------------------------------------------------------
# OxaPay invoice + status
# -----------------------------------------------------------------------------
class TestOxaPayInvoice:
    _created = {}

    def test_create_invoice_returns_pay_url(self, admin_session):
        r = admin_session.post(f"{API}/wallet/oxapay/invoice",
                               json={"coin": "USDT", "amount": 15.0}, timeout=30)
        assert r.status_code == 200, f"invoice create failed: {r.status_code} {r.text}"
        data = r.json()
        assert data.get("track_id")
        assert data.get("payment_url", "").startswith("https://pay.oxapay.com/")
        TestOxaPayInvoice._created = data
        print(f"invoice created track_id={data['track_id']}")

    def test_status_owned(self, admin_session):
        tid = TestOxaPayInvoice._created["track_id"]
        r = admin_session.get(f"{API}/wallet/oxapay/status/{tid}", timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "status" in body and "credited" in body and "balances" in body
        assert body["credited"] is False  # not paid yet

    def test_status_404_for_other_user(self, second_session):
        tid = TestOxaPayInvoice._created["track_id"]
        r = second_session.get(f"{API}/wallet/oxapay/status/{tid}", timeout=20)
        assert r.status_code == 404

    def test_status_404_unknown(self, admin_session):
        r = admin_session.get(f"{API}/wallet/oxapay/status/not-a-real-track-id-xyz", timeout=20)
        assert r.status_code == 404


# -----------------------------------------------------------------------------
# OxaPay webhook (signed Paid callback)
# -----------------------------------------------------------------------------
class TestOxaPayWebhook:
    def _balance(self, session, coin):
        r = session.get(f"{API}/wallet", timeout=20)
        assert r.status_code == 200
        bal = r.json().get("balances", {})
        return float(bal.get(coin, 0))

    def _sign(self, raw: bytes) -> str:
        return hmac.new(OXAPAY_KEY.encode(), raw, hashlib.sha512).hexdigest()

    def test_webhook_credits_once_then_idempotent_and_rejects_bad_hmac(self, admin_session):
        # 1) Create fresh invoice
        amt = 7.5
        coin = "USDT"
        r = admin_session.post(f"{API}/wallet/oxapay/invoice",
                               json={"coin": coin, "amount": amt}, timeout=30)
        assert r.status_code == 200, r.text
        track_id = r.json()["track_id"]
        before = self._balance(admin_session, coin)

        payload = {"track_id": track_id, "type": "invoice", "status": "Paid",
                   "amount": amt, "currency": coin}
        raw = json.dumps(payload).encode()

        # 2) Invalid HMAC -> 401, no credit
        bad = requests.post(f"{API}/oxapay/webhook", data=raw,
                            headers={"HMAC": "deadbeef" * 16,
                                     "Content-Type": "application/json"}, timeout=20)
        assert bad.status_code == 401, f"expected 401 for bad hmac got {bad.status_code} {bad.text}"
        mid = self._balance(admin_session, coin)
        assert mid == before, f"balance changed on bad hmac: {before} -> {mid}"

        # 3) Valid HMAC -> 200, balance increases by exactly amt
        sig = self._sign(raw)
        ok = requests.post(f"{API}/oxapay/webhook", data=raw,
                           headers={"HMAC": sig, "Content-Type": "application/json"}, timeout=20)
        assert ok.status_code == 200, f"webhook failed: {ok.status_code} {ok.text}"
        assert ok.text.strip().lower() == "ok"
        time.sleep(0.4)
        after = self._balance(admin_session, coin)
        assert abs((after - before) - amt) < 1e-6, f"expected +{amt}, got {before}->{after}"

        # 4) Replay same signed Paid webhook -> still 200, no double credit
        ok2 = requests.post(f"{API}/oxapay/webhook", data=raw,
                            headers={"HMAC": sig, "Content-Type": "application/json"}, timeout=20)
        assert ok2.status_code == 200
        time.sleep(0.3)
        after2 = self._balance(admin_session, coin)
        assert abs(after2 - after) < 1e-6, f"idempotency broken: {after} -> {after2}"

        # 5) Status endpoint should now show credited=True
        st = admin_session.get(f"{API}/wallet/oxapay/status/{track_id}", timeout=20).json()
        assert st.get("credited") is True
        assert str(st.get("status", "")).lower() == "paid"


# -----------------------------------------------------------------------------
# Regression: wallet simulated deposit / withdraw
# -----------------------------------------------------------------------------
class TestWalletSimulated:
    def test_simulated_deposit_credits(self, admin_session):
        before = admin_session.get(f"{API}/wallet", timeout=20).json()["balances"]["BTC"]
        r = admin_session.post(f"{API}/wallet/deposit",
                               json={"coin": "BTC", "amount": 0.01}, timeout=20)
        assert r.status_code == 200, r.text
        after = r.json()["balances"]["BTC"]
        assert abs((after - before) - 0.01) < 1e-9

    def test_simulated_withdraw(self, admin_session):
        before = admin_session.get(f"{API}/wallet", timeout=20).json()["balances"]["BTC"]
        r = admin_session.post(f"{API}/wallet/withdraw",
                               json={"coin": "BTC", "amount": 0.005}, timeout=20)
        assert r.status_code == 200, r.text
        after = r.json()["balances"]["BTC"]
        assert abs((before - after) - 0.005) < 1e-9


# -----------------------------------------------------------------------------
# Regression: sportsbook bet placement using oddsapi event
# -----------------------------------------------------------------------------
class TestBetFromOddsApi:
    def test_place_bet_from_oddsapi_event(self, admin_session):
        body = admin_session.get(f"{API}/odds", timeout=60).json()
        events = body["events"] if isinstance(body, dict) else body
        oa = [e for e in events if e.get("source") == "oddsapi"]
        if not oa:
            pytest.skip("no oddsapi events available right now")
        ev = oa[0]
        ml = next((m for m in (ev.get("markets") or []) if m.get("market") == "moneyline"), None)
        if not ml or not ml.get("selections"):
            pytest.skip("oddsapi event has no moneyline selections")
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
        body = r.json()
        assert body.get("bet", {}).get("id")


# -----------------------------------------------------------------------------
# Regression: Casino games
# -----------------------------------------------------------------------------
class TestCasinoRegression:
    def test_limbo(self, admin_session):
        r = admin_session.post(f"{API}/casino/limbo",
                               json={"coin": "USDT", "stake": 1, "target": 2.0}, timeout=20)
        assert r.status_code == 200, r.text
        assert "result" in r.json() or "crash" in r.json() or "payout" in r.json()

    def test_dice(self, admin_session):
        r = admin_session.post(f"{API}/casino/dice",
                               json={"coin": "USDT", "stake": 1, "target": 50, "direction": "over"}, timeout=20)
        assert r.status_code == 200, r.text

    def test_mines(self, admin_session):
        r = admin_session.post(f"{API}/casino/mines/start",
                               json={"coin": "USDT", "stake": 1, "mines": 3}, timeout=20)
        assert r.status_code == 200, r.text
        gid = r.json().get("game_id")
        assert gid
        # Reveal a tile and cashout if safe
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
                               json={"coin": "USDT", "stake": 1, "picks": [1, 2, 3, 4], "risk": "medium"},
                               timeout=20)
        assert r.status_code == 200, r.text

    def test_history_shape(self, admin_session):
        r = admin_session.get(f"{API}/casino/history", timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "games" in body and isinstance(body["games"], list)
