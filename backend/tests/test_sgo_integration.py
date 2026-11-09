"""SportsGameOdds integration + bet placement + history tests."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://housebets-sportsbook-1--7khjr43r.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@apexodds.io"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="session")
def admin_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    token = r.json().get("access_token") or r.json().get("token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="session")
def fresh_user_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = f"TEST_fresh_{uuid.uuid4().hex[:8]}@apexodds.io"
    r = s.post(f"{API}/auth/register", json={"name": "Fresh", "email": email, "password": "pass1234"})
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    token = r.json().get("access_token") or r.json().get("token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s


# ---------- Sports / Odds (SGO) ----------
class TestSportsAndOdds:
    def test_sports_groups(self):
        r = requests.get(f"{API}/sports")
        assert r.status_code == 200
        data = r.json()
        keys = {s["key"] for s in data}
        assert {"soccer", "basketball", "football", "baseball", "hockey"}.issubset(keys)

    def test_odds_feed_structure(self):
        r = requests.get(f"{API}/odds")
        assert r.status_code == 200
        payload = r.json()
        assert "events" in payload
        events = payload["events"]
        assert isinstance(events, list) and len(events) > 0, "no SGO events returned"
        ev = events[0]
        assert ev["source"] == "sportsgameodds"
        assert ev.get("book")  # 'Top books'
        assert "markets" in ev and len(ev["markets"]) > 0
        # Odds should be decimal (float > 1.0)
        has_ml = False
        for m in ev["markets"]:
            for sel in m["selections"]:
                assert isinstance(sel["odds"], (int, float))
                assert sel["odds"] > 1.0, f"odds not decimal: {sel['odds']}"
            if m["market"] == "moneyline":
                has_ml = True
        assert has_ml, "no moneyline market on first event"

    def test_odds_leagues_coverage(self):
        r = requests.get(f"{API}/odds")
        events = r.json()["events"]
        leagues = {e["league"] for e in events}
        # Expect at least a couple leagues present (upcoming slate varies)
        assert len(leagues) >= 1
        assert leagues.issubset({"soccer", "basketball", "football", "baseball", "hockey"})


# ---------- Bet placement ----------
class TestBetPlacement:
    created_bet_id = None

    def _sel_from_event(self, ev, market_sel):
        return {
            "event_id": ev["event_id"],
            "league": ev["league"],
            "league_label": ev.get("league_label", ev["league"]),
            "home": ev["home"]["name"],
            "away": ev["away"]["name"],
            "market": "moneyline",
            "pick": market_sel["pick"],
            "side": market_sel["side"],
            "line": market_sel.get("line"),
            "odds": market_sel["odds"],
        }

    def _first_event_and_selection(self):
        r = requests.get(f"{API}/odds")
        for ev in r.json()["events"]:
            for m in ev["markets"]:
                if m["market"] == "moneyline" and m["selections"]:
                    return ev, m["selections"][0]
        pytest.skip("No moneyline markets available")

    def test_place_single_bet_admin(self, admin_client):
        me = admin_client.get(f"{API}/auth/me").json()
        before = (me.get("balances") or {}).get("USDT", 0)
        if before < 1:
            pytest.skip("admin has no USDT balance to bet with")
        ev, sel = self._first_event_and_selection()
        payload = {
            "coin": "USDT",
            "stake": 1.0,
            "bet_type": "single",
            "selections": [self._sel_from_event(ev, sel)],
        }
        r = admin_client.post(f"{API}/bets", json=payload)
        assert r.status_code == 200, f"place failed: {r.status_code} {r.text}"
        resp = r.json()
        bet = resp.get("bet", resp)
        assert bet.get("id")
        after = (resp.get("balances") or {}).get("USDT", 0)
        assert round(before - after, 6) >= 0.999, f"balance not debited: {before}->{after}"
        TestBetPlacement.created_bet_id = bet["id"]

    def test_parlay_multiplies_odds(self, admin_client):
        me = admin_client.get(f"{API}/auth/me").json()
        if (me.get("balances") or {}).get("USDT", 0) < 1:
            pytest.skip("admin has no USDT balance")
        events = requests.get(f"{API}/odds").json()["events"]
        legs = []
        for ev in events:
            for m in ev["markets"]:
                if m["market"] == "moneyline" and m["selections"]:
                    legs.append(self._sel_from_event(ev, m["selections"][0]))
                    break
            if len(legs) == 2:
                break
        if len(legs) < 2:
            pytest.skip("need 2 events for parlay")
        payload = {"coin": "USDT", "stake": 1.0, "bet_type": "parlay", "selections": legs}
        r = admin_client.post(f"{API}/bets", json=payload)
        assert r.status_code == 200, f"parlay failed: {r.text}"
        resp = r.json()
        bet = resp.get("bet", resp)
        combined = bet.get("total_odds")
        assert combined is not None
        expected = round(legs[0]["odds"] * legs[1]["odds"], 2)
        assert abs(combined - expected) < 0.05, f"parlay odds mismatch {combined} vs {expected}"

    def test_fresh_user_insufficient_balance(self, fresh_user_client):
        ev = requests.get(f"{API}/odds").json()["events"][0]
        sel = ev["markets"][0]["selections"][0]
        payload = {
            "coin": "USDT",
            "stake": 10.0,
            "bet_type": "single",
            "selections": [self._sel_from_event(ev, sel)],
        }
        r = fresh_user_client.post(f"{API}/bets", json=payload)
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"
        assert "insufficient" in r.text.lower() or "balance" in r.text.lower()


# ---------- Bet history ----------
class TestBetHistory:
    def test_list_bets_admin(self, admin_client):
        r = admin_client.get(f"{API}/bets")
        assert r.status_code == 200
        data = r.json()
        bets = data if isinstance(data, list) else data.get("bets", data.get("items", []))
        assert isinstance(bets, list)
        assert len(bets) >= 1
