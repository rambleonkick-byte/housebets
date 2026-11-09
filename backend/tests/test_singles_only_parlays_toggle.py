# Iteration 25: singles-only bet slip (parlays admin toggle, default OFF)
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN = {"email": "admin@apexodds.io", "password": "admin123"}


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=ADMIN)
    if r.status_code != 200:
        pytest.skip("admin login failed")
    yield s
    # always leave parlays OFF
    s.put(f"{BASE_URL}/api/admin/parlays", json={"enabled": False})


def _sel(ev):
    m = next(m for m in ev["markets"] if m["market"] == "moneyline")
    x = m["selections"][0]
    return {"event_id": ev["event_id"], "league": ev["league"], "league_label": ev["league_label"],
            "home": ev["home"]["abbr"], "away": ev["away"]["abbr"], "market": "moneyline",
            "pick": x["pick"], "side": x["side"], "line": x.get("line"), "odds": x["odds"]}


@pytest.fixture(scope="module")
def two_sels():
    evs = requests.get(f"{BASE_URL}/api/odds", timeout=60).json()["events"]
    pre = [e for e in evs if e["state"] == "pre" and any(m["market"] == "moneyline" and len(m["selections"]) >= 1 for m in e.get("markets", []))]
    if len(pre) < 2:
        pytest.skip("not enough pre-game events")
    return [_sel(pre[0]), _sel(pre[1])]


def _usd(s):
    return s.get(f"{BASE_URL}/api/wallet").json()["balances"]["USD"]


# Config (public)
def test_config_default_off():
    r = requests.get(f"{BASE_URL}/api/config")
    assert r.status_code == 200
    assert r.json() == {"parlays": False}


# Admin settings for cashout/auto-settle untouched
def test_cashout_off_and_manual_grading(admin):
    c = admin.get(f"{BASE_URL}/api/admin/cashout").json()
    a = admin.get(f"{BASE_URL}/api/admin/auto-settle").json()
    print("cashout", c, "auto-settle", a)
    assert c.get("enabled") is False
    assert a.get("enabled") is False


def test_admin_parlays_get(admin):
    r = admin.get(f"{BASE_URL}/api/admin/parlays")
    assert r.status_code == 200 and r.json()["enabled"] is False


def test_admin_parlays_requires_admin():
    assert requests.get(f"{BASE_URL}/api/admin/parlays").status_code == 401
    assert requests.put(f"{BASE_URL}/api/admin/parlays", json={"enabled": True}).status_code == 401


# Bets
def test_parlay_rejected(admin, two_sels):
    r = admin.post(f"{BASE_URL}/api/bets", json={"selections": two_sels, "stake": 1, "coin": "USD", "bet_type": "parlay"})
    print(r.status_code, r.text[:300])
    assert r.status_code == 400
    assert r.json()["detail"] == "Parlays are currently unavailable — single bets only"


def test_single_with_two_selections_rejected(admin, two_sels):
    r = admin.post(f"{BASE_URL}/api/bets", json={"selections": two_sels, "stake": 1, "coin": "USD", "bet_type": "single"})
    assert r.status_code == 400


def test_single_bet_works_then_void(admin, two_sels):
    before = _usd(admin)
    if before < 1:
        pytest.skip("admin USD balance < 1")
    r = admin.post(f"{BASE_URL}/api/bets", json={"selections": [two_sels[0]], "stake": 1, "coin": "USD", "bet_type": "single"})
    print(r.status_code, r.text[:300])
    assert r.status_code == 200
    bet = r.json()["bet"]
    assert bet["bet_type"] == "single" and bet["stake"] == 1
    assert abs(_usd(admin) - (before - 1)) < 1e-6
    g = admin.post(f"{BASE_URL}/api/admin/bets/{bet['id']}/grade", json={"result": "void"})
    assert g.status_code == 200, g.text
    assert abs(_usd(admin) - before) < 1e-6


def test_boosts_single_leg_only():
    r = requests.get(f"{BASE_URL}/api/boosts", timeout=60)
    assert r.status_code == 200
    for b in r.json()["boosts"]:
        assert len(b["legs"]) == 1 and b.get("fixed_odds")


# Toggle ON -> config true, parlay allowed path not blocked by guard; then OFF
def test_toggle_on_then_off(admin, two_sels):
    r = admin.put(f"{BASE_URL}/api/admin/parlays", json={"enabled": True})
    assert r.status_code == 200 and r.json()["enabled"] is True
    assert requests.get(f"{BASE_URL}/api/config").json()["parlays"] is True
    # with stake 0 validation fails (422) — avoid actually placing; just check guard not hit via invalid coin
    r = admin.post(f"{BASE_URL}/api/bets", json={"selections": two_sels, "stake": 1, "coin": "XXX", "bet_type": "parlay"})
    assert r.status_code == 400 and "Invalid coin" in r.text
    r = admin.put(f"{BASE_URL}/api/admin/parlays", json={"enabled": False})
    assert r.json()["enabled"] is False
    assert requests.get(f"{BASE_URL}/api/config").json()["parlays"] is False
