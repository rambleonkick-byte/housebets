"""Backend tests for ApexOdds casino house games."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://wager-ledger-4.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@apexodds.io", "password": "admin123"}


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def bal(client):
    return lambda: client.get(f"{API}/wallet", timeout=15).json()["balances"]


# ---------- Auth gating ----------
def test_casino_requires_auth():
    s = requests.Session()
    r = s.post(f"{API}/casino/limbo", json={"coin": "USDT", "stake": 1, "target": 2})
    assert r.status_code == 401


# ---------- LIMBO ----------
def test_limbo_mechanics(client, bal):
    before = bal()["USDT"]
    r = client.post(f"{API}/casino/limbo", json={"coin": "USDT", "stake": 10, "target": 2.0})
    assert r.status_code == 200, r.text
    d = r.json()
    assert "result" in d and "won" in d and "payout" in d and "balances" in d
    after = d["balances"]["USDT"]
    if d["won"]:
        # stake deducted, then stake*target credited
        assert round(after - (before - 10 + 10 * 2.0), 4) == 0, (before, after, d)
        assert d["result"] >= 2.0
    else:
        assert round(after - (before - 10), 4) == 0, (before, after, d)
        assert d["result"] < 2.0


def test_limbo_insufficient(client):
    r = client.post(f"{API}/casino/limbo", json={"coin": "USDT", "stake": 10**12, "target": 2.0})
    assert r.status_code == 400


def test_limbo_bad_target(client):
    r = client.post(f"{API}/casino/limbo", json={"coin": "USDT", "stake": 1, "target": 1.0})
    assert r.status_code == 400


# ---------- PLINKO ----------
def test_plinko_mechanics(client, bal):
    before = bal()["USDT"]
    r = client.post(f"{API}/casino/plinko",
                    json={"coin": "USDT", "stake": 5, "risk": "medium", "rows": 16})
    assert r.status_code == 200, r.text
    d = r.json()
    assert len(d["path"]) == 16
    assert 0 <= d["bucket"] <= 16
    assert d["multiplier"] >= 0
    expected_after = round(before - 5 + 5 * d["multiplier"], 6)
    assert abs(d["balances"]["USDT"] - expected_after) < 1e-4


def test_plinko_bad_rows(client):
    r = client.post(f"{API}/casino/plinko",
                    json={"coin": "USDT", "stake": 1, "risk": "medium", "rows": 10})
    assert r.status_code == 400


# ---------- KENO ----------
def test_keno_mechanics(client, bal):
    before = bal()["USDT"]
    picks = [1, 2, 3, 4, 5, 6, 7, 8]
    r = client.post(f"{API}/casino/keno",
                    json={"coin": "USDT", "stake": 2, "picks": picks})
    assert r.status_code == 200, r.text
    d = r.json()
    assert len(d["drawn"]) == 10
    assert 0 <= d["hits"] <= 8
    expected = round(before - 2 + d["payout"], 6)
    assert abs(d["balances"]["USDT"] - expected) < 1e-4


def test_keno_invalid_picks(client):
    r = client.post(f"{API}/casino/keno",
                    json={"coin": "USDT", "stake": 1, "picks": list(range(1, 15))})
    assert r.status_code == 400


# ---------- MINES ----------
def test_mines_start_reveal_cashout(client, bal):
    before = bal()["USDT"]
    r = client.post(f"{API}/casino/mines/start",
                    json={"coin": "USDT", "stake": 4, "mines": 3})
    assert r.status_code == 200, r.text
    start = r.json()
    gid = start["game_id"]
    assert abs(start["balances"]["USDT"] - (before - 4)) < 1e-6

    # Try reveals until we get a safe one, up to a few attempts (new games on bomb)
    safe_tile = None
    for attempt in range(10):
        tile = attempt  # pick increasing tiles
        rv = client.post(f"{API}/casino/mines/reveal",
                         json={"game_id": gid, "tile": tile}).json()
        if rv.get("hit"):
            # restart
            r = client.post(f"{API}/casino/mines/start",
                            json={"coin": "USDT", "stake": 4, "mines": 3}).json()
            gid = r["game_id"]
            continue
        safe_tile = tile
        mult_after_one = rv["multiplier"]
        break
    assert safe_tile is not None, "Could not find safe reveal in 10 attempts"
    assert mult_after_one > 1.0

    # Cashout
    co = client.post(f"{API}/casino/mines/cashout", json={"game_id": gid}).json()
    assert "payout" in co and co["payout"] > 0
    assert "balances" in co
    # Payout = stake * multiplier (approx)
    assert abs(co["payout"] - round(4 * co["multiplier"], 6)) < 1e-4


def test_mines_cashout_without_reveal_fails(client):
    r = client.post(f"{API}/casino/mines/start",
                    json={"coin": "USDT", "stake": 1, "mines": 3}).json()
    gid = r["game_id"]
    co = client.post(f"{API}/casino/mines/cashout", json={"game_id": gid})
    assert co.status_code == 400


def test_mines_insufficient(client):
    r = client.post(f"{API}/casino/mines/start",
                    json={"coin": "USDT", "stake": 10**12, "mines": 3})
    assert r.status_code == 400


# ---------- Sports regression ----------
def test_sports_odds_still_works():
    r = requests.get(f"{API}/odds", timeout=30)
    assert r.status_code == 200
    assert "events" in r.json()
