# Boosted combos (GET /api/boosts) + boost bet placement (POST /api/bets boost_id) + regression single/parlay
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
PCT = {"botd": 0.15, "boosted": 0.20, "golden": 0.30}
SEL_KEYS = ["event_id", "league", "league_label", "home", "away", "market", "pick", "side", "line", "odds"]


def strip(l):
    return {k: l.get(k) for k in SEL_KEYS}


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def boosts(s):
    r = s.get(f"{API}/boosts", timeout=90)
    assert r.status_code == 200
    b = r.json()["boosts"]
    if not b:
        s.get(f"{API}/odds", timeout=90)
        b = s.get(f"{API}/boosts", timeout=90).json()["boosts"]
    return b


@pytest.fixture(scope="module")
def auth(s):
    r = s.post(f"{API}/auth/login", json={"email": "admin@apexodds.io", "password": "admin123"}, timeout=20)
    if r.status_code != 200:
        pytest.skip("login failed")
    tok = r.json().get("token") or r.json().get("access_token")
    h = {"Authorization": f"Bearer {tok}"} if tok else {}
    return h


def bal(s, auth):
    r = s.get(f"{API}/auth/me", headers=auth, timeout=20)
    j = r.json()
    return (j.get("balances") or j.get("user", {}).get("balances") or {})


# --- GET /api/boosts structure + pricing ---
class TestBoostList:
    def test_count_and_tiers(self, boosts):
        assert 1 <= len(boosts) <= 3
        tiers = [b["tier"] for b in boosts]
        assert tiers == ["botd", "boosted", "golden"][:len(boosts)]

    def test_legs_same_event_pre(self, boosts):
        for b in boosts:
            assert len(b["legs"]) == 3
            assert {l["event_id"] for l in b["legs"]} == {b["event_id"]}
            assert len({l["market"] for l in b["legs"]}) == 3
            assert b["id"] == f"{b['tier']}:{b['event_id']}"

    def test_pricing_formula(self, boosts):
        for b in boosts:
            prod = 1.0
            for l in b["legs"]:
                prod *= l["odds"]
            base = 1 + (prod - 1) * 0.8 ** 2
            boosted = 1 + (base - 1) * (1 + PCT[b["tier"]])
            assert abs(b["base_odds"] - round(base, 2)) < 0.011, b
            assert abs(b["boosted_odds"] - round(boosted, 2)) < 0.011, b
            assert b["pct"] == PCT[b["tier"]]
            assert b["boosted_odds"] > b["base_odds"]


# --- POST /api/bets with boost ---
class TestBoostBet:
    def test_place_boost_bet(self, s, boosts, auth):
        b = boosts[0]
        before = bal(s, auth).get("USDT")
        r = s.post(f"{API}/bets", headers=auth, timeout=60, json={
            "selections": [strip(l) for l in b["legs"]], "stake": 1, "coin": "USDT",
            "bet_type": "parlay", "accept_better": True, "boost_id": b["id"]})
        assert r.status_code == 200, r.text
        bet = r.json()["bet"]
        assert bet["boost"]["id"] == b["id"] and bet["boost"]["pct"] == b["pct"]
        assert bet["bet_type"] == "parlay"
        assert abs(bet["total_odds"] - b["boosted_odds"]) < 0.02
        assert abs(bet["potential_payout"] - bet["total_odds"]) < 1e-6
        after = r.json()["balances"]["USDT"]
        if before is not None:
            assert abs(before - 1 - after) < 1e-6
        # persisted
        lst = s.get(f"{API}/bets", headers=auth, timeout=20)
        assert lst.status_code == 200
        data = lst.json()
        arr = data if isinstance(data, list) else data.get("bets", [])
        mine = [x for x in arr if x["id"] == bet["id"]]
        assert mine and mine[0]["boost"]["id"] == b["id"]
        assert "_id" not in mine[0]

    def test_fake_boost_id(self, s, boosts, auth):
        b = boosts[0]
        r = s.post(f"{API}/bets", headers=auth, timeout=30, json={
            "selections": [strip(l) for l in b["legs"]], "stake": 1, "coin": "USDT",
            "bet_type": "parlay", "boost_id": "golden:FAKE123"})
        assert r.status_code == 409
        assert r.json()["detail"]["boost_gone"] is True

    def test_mismatched_legs(self, s, boosts, auth):
        b = boosts[0]
        r = s.post(f"{API}/bets", headers=auth, timeout=30, json={
            "selections": [strip(l) for l in b["legs"][:2]], "stake": 1, "coin": "USDT",
            "bet_type": "parlay", "boost_id": b["id"]})
        assert r.status_code == 409
        assert r.json()["detail"]["boost_gone"] is True

    def test_boost_legs_of_other_boost(self, s, boosts, auth):
        if len(boosts) < 2:
            pytest.skip("need 2 boosts")
        r = s.post(f"{API}/bets", headers=auth, timeout=30, json={
            "selections": [strip(l) for l in boosts[1]["legs"]], "stake": 1, "coin": "USDT",
            "bet_type": "parlay", "boost_id": boosts[0]["id"]})
        assert r.status_code == 409 and r.json()["detail"]["boost_gone"] is True

    def test_boost_requires_auth(self, boosts):
        b = boosts[0]
        r = requests.post(f"{API}/bets", timeout=30, json={
            "selections": [strip(l) for l in b["legs"]], "stake": 1, "coin": "USDT", "boost_id": b["id"]})
        assert r.status_code == 401


# --- Regression: normal single + parlay ---
class TestRegression:
    def test_single_and_parlay(self, s, boosts, auth):
        legs = boosts[0]["legs"]
        r = s.post(f"{API}/bets", headers=auth, timeout=30, json={
            "selections": [strip(legs[0])], "stake": 1, "coin": "USDT", "bet_type": "single"})
        assert r.status_code == 200, r.text
        assert r.json()["bet"]["boost"] is None and r.json()["bet"]["bet_type"] == "single"
        r = s.post(f"{API}/bets", headers=auth, timeout=30, json={
            "selections": [strip(l) for l in legs], "stake": 1, "coin": "USDT", "bet_type": "parlay"})
        assert r.status_code == 200, r.text
        bet = r.json()["bet"]
        assert bet["boost"] is None
        assert abs(bet["total_odds"] - boosts[0]["base_odds"]) < 0.02
