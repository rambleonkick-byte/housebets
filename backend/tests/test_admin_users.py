# Admin users panel: list/search, adjust balances, block/unblock, action log
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN = {"email": "admin@apexodds.io", "password": "admin123"}
TESTER = {"email": "player@apexodds.io", "password": "player123"}


def login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds)
    return s, r


@pytest.fixture(scope="module")
def admin():
    s, r = login(ADMIN)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def target(admin):
    """Fresh TEST_ user for mutation tests"""
    email = f"test_admin_{uuid.uuid4().hex[:8]}@example.com"
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/register", json={"name": "TEST_AdminTarget", "email": email, "password": "pass1234"})
    assert r.status_code == 200, r.text
    uid = r.json()["id"]
    yield {"id": uid, "email": email, "session": s}
    admin.post(f"{BASE_URL}/api/admin/users/{uid}/block", json={"blocked": False})


def find_user(admin, email):
    r = admin.get(f"{BASE_URL}/api/admin/users", params={"q": email})
    assert r.status_code == 200
    return next((u for u in r.json()["users"] if u["email"] == email), None)


# --- Access control
def test_unauth_401():
    assert requests.get(f"{BASE_URL}/api/admin/users").status_code == 401


def test_non_admin_403():
    s, r = login(TESTER)
    if r.status_code != 200:
        pytest.skip(f"tester login failed {r.status_code} {r.text}")
    r = s.get(f"{BASE_URL}/api/admin/users")
    assert r.status_code == 403
    assert s.post(f"{BASE_URL}/api/admin/users/x/adjust", json={"coin": "USDT", "amount": 1, "reason": "xx"}).status_code == 403


# --- List / search / pagination
def test_list_structure(admin):
    r = admin.get(f"{BASE_URL}/api/admin/users")
    d = r.json()
    assert r.status_code == 200
    for k in ("users", "total", "signups_today", "blocked"):
        assert k in d
    assert isinstance(d["total"], int) and d["total"] >= len(d["users"])
    u = d["users"][0]
    for k in ("id", "name", "email", "role", "created_at", "blocked", "balances", "deposits", "withdrawals", "wagered", "referred_by"):
        assert k in u
    assert "_id" not in u and "password_hash" not in u


def test_search_and_pagination(admin, target):
    u = find_user(admin, target["email"])
    assert u and u["name"] == "TEST_AdminTarget"
    r = admin.get(f"{BASE_URL}/api/admin/users", params={"q": "TEST_AdminTarget".lower()})
    assert any(x["id"] == target["id"] for x in r.json()["users"])
    r = admin.get(f"{BASE_URL}/api/admin/users", params={"q": "zzz_nomatch_" + uuid.uuid4().hex})
    assert r.json()["total"] == 0 and r.json()["users"] == []
    r = admin.get(f"{BASE_URL}/api/admin/users", params={"q": ".*"})  # regex escaped
    assert r.status_code == 200
    r1 = admin.get(f"{BASE_URL}/api/admin/users", params={"limit": 2, "skip": 0}).json()
    r2 = admin.get(f"{BASE_URL}/api/admin/users", params={"limit": 2, "skip": 2}).json()
    if r1["total"] > 2:
        assert {x["id"] for x in r1["users"]}.isdisjoint({x["id"] for x in r2["users"]})


def test_signups_today_includes_new(admin, target):
    assert admin.get(f"{BASE_URL}/api/admin/users").json()["signups_today"] >= 1


# --- Adjust
def test_adjust_add_remove(admin, target):
    uid = target["id"]
    r = admin.post(f"{BASE_URL}/api/admin/users/{uid}/adjust", json={"coin": "USDT", "amount": 100, "reason": "TEST credit"})
    assert r.status_code == 200, r.text
    assert r.json()["balances"]["USDT"] == pytest.approx(100)
    r = admin.post(f"{BASE_URL}/api/admin/users/{uid}/adjust", json={"coin": "USDT", "amount": -40, "reason": "TEST debit"})
    assert r.status_code == 200 and r.json()["balances"]["USDT"] == pytest.approx(60)
    assert find_user(admin, target["email"])["balances"]["USDT"] == pytest.approx(60)
    # user wallet reflects + transactions with adjustment type
    w = target["session"].get(f"{BASE_URL}/api/wallet").json()
    adj = [t for t in w.get("transactions", []) if t["type"] == "adjustment"]
    assert len(adj) == 2 and sorted(t["amount"] for t in adj) == [-40, 100]


def test_adjust_over_remove(admin, target):
    r = admin.post(f"{BASE_URL}/api/admin/users/{target['id']}/adjust", json={"coin": "USDT", "amount": -1000, "reason": "TEST over"})
    assert r.status_code == 400 and "below zero" in r.json()["detail"]
    assert find_user(admin, target["email"])["balances"]["USDT"] == pytest.approx(60)


@pytest.mark.parametrize("body,code", [
    ({"coin": "USDT", "amount": 1, "reason": ""}, 422),
    ({"coin": "USDT", "amount": 1}, 422),
    ({"coin": "DOGE", "amount": 1, "reason": "TEST"}, 400),
    ({"coin": "USDT", "amount": 0, "reason": "TEST"}, 400),
])
def test_adjust_validation(admin, target, body, code):
    assert admin.post(f"{BASE_URL}/api/admin/users/{target['id']}/adjust", json=body).status_code == code


def test_adjust_unknown_user(admin):
    assert admin.post(f"{BASE_URL}/api/admin/users/bad/adjust", json={"coin": "USDT", "amount": 1, "reason": "TEST"}).status_code == 404
    assert admin.post(f"{BASE_URL}/api/admin/users/000000000000000000000000/adjust", json={"coin": "USDT", "amount": 1, "reason": "TEST"}).status_code == 404


# --- Block
def test_block_flow(admin, target):
    uid = target["id"]
    r = admin.post(f"{BASE_URL}/api/admin/users/{uid}/block", json={"blocked": True, "reason": "TEST lock"})
    assert r.status_code == 200 and r.json()["blocked"] is True
    me = target["session"].get(f"{BASE_URL}/api/auth/me")
    assert me.status_code == 403 and me.json()["detail"] == "Account locked. Contact support."
    assert target["session"].get(f"{BASE_URL}/api/wallet").status_code == 403
    _, lr = login({"email": target["email"], "password": "pass1234"})
    assert lr.status_code == 403 and "locked" in lr.json()["detail"].lower()
    _, bad = login({"email": target["email"], "password": "wrongpw"})
    assert bad.status_code == 401  # no info leak with wrong pw
    d = admin.get(f"{BASE_URL}/api/admin/users").json()
    assert d["blocked"] >= 1
    assert find_user(admin, target["email"])["blocked"] is True
    r = admin.post(f"{BASE_URL}/api/admin/users/{uid}/block", json={"blocked": False})
    assert r.status_code == 200
    _, lr = login({"email": target["email"], "password": "pass1234"})
    assert lr.status_code == 200
    assert target["session"].get(f"{BASE_URL}/api/auth/me").status_code == 200


def test_admin_cannot_be_locked(admin):
    me = admin.get(f"{BASE_URL}/api/auth/me").json()
    r = admin.post(f"{BASE_URL}/api/admin/users/{me['id']}/block", json={"blocked": True})
    assert r.status_code == 400
    assert admin.get(f"{BASE_URL}/api/auth/me").status_code == 200


def test_log(admin, target):
    r = admin.get(f"{BASE_URL}/api/admin/users/{target['id']}/log")
    assert r.status_code == 200
    acts = r.json()["actions"]
    kinds = [a["action"] for a in acts]
    assert kinds.count("adjust") == 2 and "block" in kinds and "unblock" in kinds
    assert all(a["admin"] == ADMIN["email"] and "_id" not in a for a in acts)
    assert acts[0]["action"] == "unblock"  # newest first


def test_tester_not_locked(admin):
    u = find_user(admin, TESTER["email"])
    if u:
        assert u["blocked"] is False
