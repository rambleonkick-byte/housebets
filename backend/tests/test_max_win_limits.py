# Iteration 24: global max-win limit (admin), per-player max-win override, /limits/me, casino caps, bulk delete.
import os
import time
import uuid
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN = {"email": "admin@apexodds.io", "password": "admin123"}
CACHE_WAIT = 16


def _register(tag):
    s = requests.Session()
    email = f"test_mw_{tag}_{uuid.uuid4().hex[:6]}@example.com"
    r = s.post(f"{API}/auth/register", json={"name": f"TEST MW {tag}", "email": email, "password": "test1234"}, timeout=20)
    assert r.status_code == 200, r.text
    uid = s.get(f"{API}/auth/me", timeout=15).json()["id"]
    return {"s": s, "id": uid, "email": email}


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200
    s.admin_id = s.get(f"{API}/auth/me", timeout=15).json()["id"]
    return s


@pytest.fixture(scope="module")
def users(admin):
    us = [_register(t) for t in ("a", "b")]
    for u in us:
        r = admin.post(f"{API}/admin/users/{u['id']}/adjust", json={"coin": "USD", "amount": 3000, "reason": "TEST fund"}, timeout=20)
        assert r.status_code == 200, r.text
    yield us
    admin.put(f"{API}/admin/limits", json={"enabled": True, "amount": 750}, timeout=15)
    admin.post(f"{API}/admin/users/bulk-delete", json={"ids": [u["id"] for u in us]}, timeout=30)


def _set_global(admin, enabled, amount):
    r = admin.put(f"{API}/admin/limits", json={"enabled": enabled, "amount": amount}, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["enabled"] is enabled and d["amount"] == amount
    time.sleep(CACHE_WAIT)


def _leg():
    boosts = requests.get(f"{API}/boosts", timeout=90).json().get("boosts") or []
    keys = ["event_id", "league", "league_label", "home", "away", "market", "pick", "side", "line", "odds"]
    for b in boosts:
        for l in b["legs"]:
            if l.get("odds", 0) > 1.3:
                return {k: l.get(k) for k in keys}
    return None


# --- admin limits endpoints ---
def test_admin_limits_get_and_auth(admin, users):
    r = admin.get(f"{API}/admin/limits", timeout=15)
    assert r.status_code == 200
    assert set(r.json().keys()) >= {"enabled", "amount"}
    assert users[0]["s"].get(f"{API}/admin/limits", timeout=15).status_code == 403
    assert users[0]["s"].put(f"{API}/admin/limits", json={"enabled": False, "amount": 1}, timeout=15).status_code == 403


def test_admin_limits_validation(admin):
    assert admin.put(f"{API}/admin/limits", json={"enabled": True, "amount": 0}, timeout=15).status_code == 422
    assert admin.put(f"{API}/admin/limits", json={"enabled": True, "amount": -5}, timeout=15).status_code == 422


def test_limits_me_default(admin, users):
    _set_global(admin, True, 750)
    r = users[0]["s"].get(f"{API}/limits/me", timeout=15)
    assert r.status_code == 200 and r.json()["max_win"] == 750


# --- sports bet global limit ---
def test_sports_bet_global_limit_100_then_off(admin, users):
    leg = _leg()
    if not leg:
        pytest.skip("no odds")
    _set_global(admin, True, 100)
    s = users[0]["s"]
    assert s.get(f"{API}/limits/me", timeout=15).json()["max_win"] == 100
    stake = round(100 / (leg["odds"] - 1) + 5, 2)
    r = s.post(f"{API}/bets", json={"selections": [leg], "stake": stake, "coin": "USD", "bet_type": "single"}, timeout=30)
    assert r.status_code == 400, r.text
    assert "Max win per bet is $100" in r.json()["detail"]
    # under limit ok
    small = round(90 / (leg["odds"] - 1), 2)
    r = s.post(f"{API}/bets", json={"selections": [leg], "stake": small, "coin": "USD", "bet_type": "single"}, timeout=30)
    if r.status_code == 409:
        pytest.skip("selection changed")
    assert r.status_code == 200, r.text
    # switch OFF -> big bet accepted
    _set_global(admin, False, 100)
    assert s.get(f"{API}/limits/me", timeout=15).json()["max_win"] is None
    big = round(1000 / (leg["odds"] - 1) + 1, 2)
    r = s.post(f"{API}/bets", json={"selections": [leg], "stake": min(big, 2500), "coin": "USD", "bet_type": "single"}, timeout=30)
    assert r.status_code == 200, r.text
    _set_global(admin, True, 750)


# --- per-player override ---
def test_player_override_limbo(admin, users):
    a, b = users
    r = admin.put(f"{API}/admin/users/{a['id']}/max-win", json={"max_win": -1}, timeout=15)
    assert r.status_code == 400
    r = admin.put(f"{API}/admin/users/{a['id']}/max-win", json={"max_win": 5000}, timeout=15)
    assert r.status_code == 200 and r.json()["effective"] == 5000
    assert a["s"].get(f"{API}/limits/me", timeout=15).json()["max_win"] == 5000
    ra = a["s"].post(f"{API}/casino/limbo", json={"stake": 100, "coin": "USD", "target": 10}, timeout=20)
    assert ra.status_code == 200, ra.text
    rb = b["s"].post(f"{API}/casino/limbo", json={"stake": 100, "coin": "USD", "target": 10}, timeout=20)
    assert rb.status_code == 400 and "Max win is $750" in rb.json()["detail"], rb.text
    # dice blocked for b too (chance ~9.9% -> ~10x)
    rd = b["s"].post(f"{API}/casino/dice", json={"stake": 100, "coin": "USD", "target": 90, "direction": "over"}, timeout=20)
    assert rd.status_code == 400, rd.text


def test_player_unlimited_and_reset(admin, users):
    a = users[0]
    r = admin.put(f"{API}/admin/users/{a['id']}/max-win", json={"max_win": 0}, timeout=15)
    assert r.status_code == 200 and r.json()["effective"] is None
    assert a["s"].get(f"{API}/limits/me", timeout=15).json()["max_win"] is None
    r = admin.put(f"{API}/admin/users/{a['id']}/max-win", json={"max_win": None}, timeout=15)
    assert r.status_code == 200 and r.json()["effective"] == 750
    assert a["s"].get(f"{API}/limits/me", timeout=15).json()["max_win"] == 750
    assert users[1]["s"].put(f"{API}/admin/users/{a['id']}/max-win", json={"max_win": 1}, timeout=15).status_code == 403


def test_player_override_beats_global_off(admin, users):
    # global off, player has 50 -> player still limited
    a = users[0]
    admin.put(f"{API}/admin/users/{a['id']}/max-win", json={"max_win": 50}, timeout=15)
    _set_global(admin, False, 750)
    assert a["s"].get(f"{API}/limits/me", timeout=15).json()["max_win"] == 50
    assert users[1]["s"].get(f"{API}/limits/me", timeout=15).json()["max_win"] is None
    _set_global(admin, True, 750)


def test_plinko_keno_payout_capped(admin, users):
    a = users[0]
    admin.put(f"{API}/admin/users/{a['id']}/max-win", json={"max_win": 0.5}, timeout=15)
    stake = 5
    for _ in range(12):
        r = a["s"].post(f"{API}/casino/plinko", json={"stake": stake, "coin": "USD", "risk": "high", "rows": 16}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["payout"] <= stake + 0.5 + 1e-6, r.json()
        r = a["s"].post(f"{API}/casino/keno", json={"stake": stake, "coin": "USD", "picks": [1, 2, 3]}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["payout"] <= stake + 0.5 + 1e-6, r.json()
    admin.put(f"{API}/admin/users/{a['id']}/max-win", json={"max_win": None}, timeout=15)


def test_admin_actions_logged(admin, users):
    r = admin.get(f"{API}/admin/users/{users[0]['id']}/log", timeout=20)
    assert r.status_code == 200
    assert any(a["action"] == "max_win" and "Max win set to" in a["reason"] for a in r.json()["actions"]), r.text[:500]


# --- bulk delete ---
def test_bulk_delete(admin, users):
    extra = [_register(t) for t in ("c", "d")]
    ids = [u["id"] for u in extra]
    assert extra[0]["s"].post(f"{API}/admin/users/bulk-delete", json={"ids": ids}, timeout=20).status_code == 403
    assert admin.post(f"{API}/admin/users/bulk-delete", json={"ids": []}, timeout=20).status_code == 422
    r = admin.post(f"{API}/admin/users/bulk-delete", json={"ids": ids + [admin.admin_id, "bogus"]}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json() == {"deleted": 2, "skipped": 2}
    for u in extra:
        assert admin.get(f"{API}/admin/users/{u['id']}/history", timeout=15).status_code == 404
        assert requests.post(f"{API}/auth/login", json={"email": u["email"], "password": "test1234"}, timeout=15).status_code in (400, 401)
    assert admin.get(f"{API}/auth/me", timeout=15).status_code == 200


def test_single_delete_regression(admin):
    u = _register("e")
    r = admin.delete(f"{API}/admin/users/{u['id']}", timeout=20)
    assert r.status_code == 200 and r.json()["deleted"] is True
    assert admin.delete(f"{API}/admin/users/{admin.admin_id}", timeout=20).status_code == 400
