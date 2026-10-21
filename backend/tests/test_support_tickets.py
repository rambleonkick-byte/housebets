# Support tickets (player <-> admin) API tests
import os
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN = {"email": "admin@apexodds.io", "password": "admin123"}


def _mongo():
    env = dict(l.strip().split("=", 1) for l in open("/app/backend/.env") if "=" in l)
    c = MongoClient(env["MONGO_URL"].strip('"'))
    return c[env["DB_NAME"].strip('"')]


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return s


def _register():
    email = f"test_tkt_{uuid.uuid4().hex[:8]}@example.com"
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/register", json={"name": "TEST Ticket", "email": email, "password": "Passw0rd!"})
    assert r.status_code in (200, 201), r.text
    return s, email


@pytest.fixture(scope="module")
def ctx():
    a, ea = _register()
    b, eb = _register()
    adm = _login(**ADMIN)
    yield {"a": a, "b": b, "admin": adm}
    db = _mongo()
    for e in (ea, eb):
        u = db.users.find_one({"email": e})
        if u:
            uid = str(u["_id"])
            for col in ("tickets", "wallets", "transactions", "bets", "casino_games"):
                db[col].delete_many({"user_id": uid})
            db.users.delete_one({"email": e})


class TestTickets:
    tid = None

    def test_unauth(self):
        assert requests.get(f"{BASE_URL}/api/tickets").status_code == 401

    def test_invalid_topic(self, ctx):
        r = ctx["a"].post(f"{BASE_URL}/api/tickets", json={"topic": "Spam", "message": "hi"})
        assert r.status_code == 400

    def test_empty_message(self, ctx):
        assert ctx["a"].post(f"{BASE_URL}/api/tickets", json={"topic": "Deposit", "message": ""}).status_code == 422
        assert ctx["a"].post(f"{BASE_URL}/api/tickets", json={"topic": "Deposit", "message": "   "}).status_code == 400

    def test_create(self, ctx):
        r = ctx["a"].post(f"{BASE_URL}/api/tickets", json={"topic": "Deposit", "message": "TEST my deposit"})
        assert r.status_code == 200
        d = r.json()
        assert d["topic"] == "Deposit" and d["status"] == "open" and d["admin_unread"] is True
        assert d["messages"][0]["text"] == "TEST my deposit" and "_id" not in d
        TestTickets.tid = d["id"]
        lst = ctx["a"].get(f"{BASE_URL}/api/tickets").json()
        assert any(t["id"] == d["id"] for t in lst["tickets"]) and lst["unread"] == 0

    def test_other_player_cannot_read(self, ctx):
        tid = TestTickets.tid
        assert ctx["b"].get(f"{BASE_URL}/api/tickets/{tid}").status_code == 404
        assert ctx["b"].post(f"{BASE_URL}/api/tickets/{tid}/messages", json={"text": "x"}).status_code == 404
        assert all(t["id"] != tid for t in ctx["b"].get(f"{BASE_URL}/api/tickets").json()["tickets"])

    def test_non_admin_forbidden(self, ctx):
        tid = TestTickets.tid
        assert ctx["a"].get(f"{BASE_URL}/api/admin/tickets").status_code == 403
        assert ctx["a"].get(f"{BASE_URL}/api/admin/tickets/{tid}").status_code == 403
        assert ctx["a"].post(f"{BASE_URL}/api/admin/tickets/{tid}/messages", json={"text": "x"}).status_code == 403
        assert ctx["a"].post(f"{BASE_URL}/api/admin/tickets/{tid}/status", json={"status": "closed"}).status_code == 403

    def test_admin_list_and_open(self, ctx):
        tid = TestTickets.tid
        d = ctx["admin"].get(f"{BASE_URL}/api/admin/tickets", params={"status": "open"}).json()
        t = next(t for t in d["tickets"] if t["id"] == tid)
        assert t["admin_unread"] is True and d["unread"] >= 1
        full = ctx["admin"].get(f"{BASE_URL}/api/admin/tickets/{tid}").json()
        assert full["admin_unread"] is False
        d2 = ctx["admin"].get(f"{BASE_URL}/api/admin/tickets").json()
        assert next(t for t in d2["tickets"] if t["id"] == tid)["admin_unread"] is False

    def test_admin_reply_sets_user_unread(self, ctx):
        tid = TestTickets.tid
        r = ctx["admin"].post(f"{BASE_URL}/api/admin/tickets/{tid}/messages", json={"text": "TEST admin reply"})
        assert r.status_code == 200 and r.json()["messages"][-1]["from"] == "admin"
        assert ctx["admin"].post(f"{BASE_URL}/api/admin/tickets/{tid}/messages", json={"text": "  "}).status_code == 400
        lst = ctx["a"].get(f"{BASE_URL}/api/tickets").json()
        assert lst["unread"] == 1
        ctx["a"].get(f"{BASE_URL}/api/tickets/{tid}")
        assert ctx["a"].get(f"{BASE_URL}/api/tickets").json()["unread"] == 0

    def test_close_filters_and_reopen_by_player(self, ctx):
        tid = TestTickets.tid
        assert ctx["admin"].post(f"{BASE_URL}/api/admin/tickets/{tid}/status", json={"status": "bogus"}).status_code == 400
        r = ctx["admin"].post(f"{BASE_URL}/api/admin/tickets/{tid}/status", json={"status": "closed"})
        assert r.json()["status"] == "closed"
        closed = ctx["admin"].get(f"{BASE_URL}/api/admin/tickets", params={"status": "closed"}).json()["tickets"]
        opened = ctx["admin"].get(f"{BASE_URL}/api/admin/tickets", params={"status": "open"}).json()["tickets"]
        assert any(t["id"] == tid for t in closed) and all(t["id"] != tid for t in opened)
        r = ctx["a"].post(f"{BASE_URL}/api/tickets/{tid}/messages", json={"text": "TEST player follow-up"})
        assert r.status_code == 200 and r.json()["status"] == "open" and r.json()["admin_unread"] is True
        assert len(r.json()["messages"]) == 3

    def test_admin_404(self, ctx):
        assert ctx["admin"].get(f"{BASE_URL}/api/admin/tickets/nope").status_code == 404
