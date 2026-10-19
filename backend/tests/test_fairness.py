"""Backend tests for Dice game, provably-fair seed engine, casino history, and verification."""
import hashlib
import hmac
import math
import os

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN = {"email": "admin@apexodds.io", "password": "admin123"}
EDGE = 0.99


# ---- helpers that mirror backend RNG ----
def rfloat(server_seed: str, client_seed: str, nonce: int, cursor: int = 0) -> float:
    msg = f"{client_seed}:{nonce}:{cursor}".encode()
    h = hmac.new(server_seed.encode(), msg, hashlib.sha256).hexdigest()
    return int(h[:8], 16) / 0x100000000


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    # Use a dedicated test user to avoid races with other modules running in parallel
    # (xdist loadscope: different modules run on different workers but share the admin acct).
    email = "TEST_fairness_user@apexodds.io"
    s.post(f"{API}/auth/register",
           json={"name": "TestFairness", "email": email, "password": "pw12345"}, timeout=15)
    r = s.post(f"{API}/auth/login", json={"email": email, "password": "pw12345"}, timeout=15)
    assert r.status_code == 200, r.text
    return s


# ---------- Dice ----------
def test_dice_mechanics_over(client):
    bal_before = client.get(f"{API}/wallet").json()["balances"]["USDT"]
    r = client.post(f"{API}/casino/dice",
                    json={"coin": "USDT", "stake": 5, "target": 50, "direction": "over"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert 0 <= d["roll"] <= 99.99
    # multiplier at target=50, over: chance=50 -> 0.99*100/50 = 1.98
    assert abs(d["multiplier"] - 1.98) < 1e-3 or d["multiplier"] == 0
    # Fair metadata present
    assert "fair" in d and "server_seed_hash" in d["fair"] and "client_seed" in d["fair"]
    after = d["balances"]["USDT"]
    if d["won"]:
        assert d["roll"] > 50
        assert abs(after - (bal_before - 5 + d["payout"])) < 1e-4
        assert abs(d["payout"] - round(5 * 1.98, 6)) < 1e-4
    else:
        assert d["roll"] <= 50
        assert abs(after - (bal_before - 5)) < 1e-4


def test_dice_mechanics_under(client):
    r = client.post(f"{API}/casino/dice",
                    json={"coin": "USDT", "stake": 2, "target": 25, "direction": "under"})
    assert r.status_code == 200, r.text
    d = r.json()
    # multiplier at target=25, under: chance=25 -> 0.99*100/25 = 3.96
    assert abs(d["multiplier"] - 3.96) < 1e-3 or d["multiplier"] == 0


def test_dice_bad_target(client):
    r = client.post(f"{API}/casino/dice",
                    json={"coin": "USDT", "stake": 1, "target": 100, "direction": "over"})
    assert r.status_code == 400


def test_dice_bad_direction(client):
    r = client.post(f"{API}/casino/dice",
                    json={"coin": "USDT", "stake": 1, "target": 50, "direction": "sideways"})
    assert r.status_code == 400


def test_dice_insufficient(client):
    r = client.post(f"{API}/casino/dice",
                    json={"coin": "USDT", "stake": 10**12, "target": 50, "direction": "over"})
    assert r.status_code == 400


def test_dice_requires_auth():
    r = requests.post(f"{API}/casino/dice",
                      json={"coin": "USDT", "stake": 1, "target": 50, "direction": "over"})
    assert r.status_code == 401


# ---------- Seed engine ----------
def test_seed_get_returns_commitment(client):
    r = client.get(f"{API}/casino/seed")
    assert r.status_code == 200
    d = r.json()
    assert len(d["server_seed_hash"]) == 64
    assert isinstance(d["client_seed"], str) and len(d["client_seed"]) > 0
    assert isinstance(d["nonce"], int)
    assert isinstance(d["revealed"], list)


def test_set_client_seed_persists(client):
    custom = "TEST_my_client_seed_abc"
    r = client.post(f"{API}/casino/seed/client", json={"client_seed": custom})
    assert r.status_code == 200
    assert r.json()["client_seed"] == custom
    # GET verifies persistence
    g = client.get(f"{API}/casino/seed").json()
    assert g["client_seed"] == custom


def test_rotate_reveals_matching_hash_and_bumps_nonce(client):
    seed_before = client.get(f"{API}/casino/seed").json()
    old_hash = seed_before["server_seed_hash"]
    r = client.post(f"{API}/casino/seed/rotate")
    assert r.status_code == 200, r.text
    d = r.json()
    # Revealed seed must hash to the previously-committed hash
    assert sha256_hex(d["revealed_server_seed"]) == old_hash
    assert d["revealed_server_seed_hash"] == old_hash
    assert d["new_server_seed_hash"] != old_hash
    # After rotate: new active seed, nonce reset, revealed list contains the old hash
    seed_after = client.get(f"{API}/casino/seed").json()
    assert seed_after["server_seed_hash"] == d["new_server_seed_hash"]
    assert seed_after["nonce"] == 0
    assert any(x["server_seed_hash"] == old_hash for x in seed_after["revealed"])


# ---------- History ----------
def test_casino_history_includes_fair_fields(client):
    # Play one dice to guarantee at least one row
    client.post(f"{API}/casino/dice",
                json={"coin": "USDT", "stake": 1, "target": 50, "direction": "over"})
    r = client.get(f"{API}/casino/history")
    assert r.status_code == 200
    games = r.json()["games"]
    assert len(games) >= 1
    g = games[0]
    for k in ("game", "coin", "stake", "multiplier", "payout",
              "nonce", "server_seed_hash", "client_seed", "detail"):
        assert k in g, f"missing {k} in history row: {g}"
    assert "_id" not in g


# ---------- End-to-end provably-fair verification ----------
def test_dice_result_matches_recompute_after_reveal(client):
    # Set a known client seed, play a dice, rotate to reveal, recompute & verify.
    client.post(f"{API}/casino/seed/client", json={"client_seed": "TEST_verify_seed"})
    before_seed = client.get(f"{API}/casino/seed").json()
    committed_hash = before_seed["server_seed_hash"]
    nonce_before = before_seed["nonce"]

    r = client.post(f"{API}/casino/dice",
                    json={"coin": "USDT", "stake": 1, "target": 50, "direction": "over"}).json()
    roll = r["roll"]
    assert r["fair"]["server_seed_hash"] == committed_hash
    nonce_used = r["fair"]["nonce"]
    assert nonce_used == nonce_before

    # Rotate to reveal
    rot = client.post(f"{API}/casino/seed/rotate").json()
    revealed = rot["revealed_server_seed"]
    assert sha256_hex(revealed) == committed_hash

    # Recompute using the exact same algorithm
    u = rfloat(revealed, "TEST_verify_seed", nonce_used, 0)
    expected_roll = math.floor(u * 10000) / 100
    assert abs(expected_roll - roll) < 1e-6, (expected_roll, roll)


def test_limbo_result_matches_recompute_after_reveal(client):
    client.post(f"{API}/casino/seed/client", json={"client_seed": "TEST_limbo_seed"})
    before = client.get(f"{API}/casino/seed").json()
    committed = before["server_seed_hash"]
    r = client.post(f"{API}/casino/limbo",
                    json={"coin": "USDT", "stake": 1, "target": 2.0}).json()
    nonce_used = r["fair"]["nonce"]
    stored_result = r["result"]

    rot = client.post(f"{API}/casino/seed/rotate").json()
    revealed = rot["revealed_server_seed"]
    assert sha256_hex(revealed) == committed

    u = rfloat(revealed, "TEST_limbo_seed", nonce_used, 0)
    expected = 1000000.0 if u <= 0 else max(1.0, math.floor(EDGE / u * 100) / 100)
    assert abs(expected - stored_result) < 1e-6
