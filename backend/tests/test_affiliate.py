# Affiliate program tests: register ref_code, panel, NGR commission w/ carry-forward, claim, custom code
import os
import uuid
import pytest
import requests
from pymongo import MongoClient
from bson import ObjectId
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def new_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def register(ref_code=None, name="TEST_Aff"):
    s = new_session()
    email = f"test_aff_{uuid.uuid4().hex[:8]}@example.com"
    body = {"name": name, "email": email, "password": "pass1234"}
    if ref_code is not None:
        body["ref_code"] = ref_code
    r = s.post(f"{BASE_URL}/api/auth/register", json=body)
    return s, r, email


def add_game(uid, coin, stake, payout):
    db.casino_games.insert_one({"id": "TEST_" + uuid.uuid4().hex, "user_id": uid, "game": "dice", "coin": coin,
                                "stake": stake, "multiplier": 0, "payout": payout, "won": payout > stake,
                                "detail": {}, "created_at": "2026-01-01T00:00:00+00:00"})


@pytest.fixture(scope="module")
def affiliate():
    s, r, email = register(name="TEST_Affiliator")
    assert r.status_code == 200, r.text
    p = s.get(f"{BASE_URL}/api/affiliate")
    assert p.status_code == 200
    yield {"s": s, "uid": r.json()["id"], "code": p.json()["code"], "email": email}


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    ids = [str(u["_id"]) for u in db.users.find({"email": {"$regex": "^test_aff_"}})]
    db.casino_games.delete_many({"user_id": {"$in": ids}})
    db.bets.delete_many({"user_id": {"$in": ids}})
    db.affiliates.delete_many({"user_id": {"$in": ids}})
    db.affiliate_ledger.delete_many({"affiliate_id": {"$in": ids}})
    db.transactions.delete_many({"user_id": {"$in": ids}})
    db.wallets.delete_many({"user_id": {"$in": ids}})
    db.users.delete_many({"email": {"$regex": "^test_aff_"}})


class TestRegister:
    def test_register_no_code(self):
        s, r, _ = register()
        assert r.status_code == 200
        u = db.users.find_one({"_id": ObjectId(r.json()["id"])})
        assert "referred_by" not in u

    def test_register_empty_code(self):
        s, r, _ = register(ref_code="   ")
        assert r.status_code == 200

    def test_register_invalid_code(self):
        s, r, email = register(ref_code="NOPE_XYZ_999")
        assert r.status_code == 400
        assert r.json()["detail"] == "Invalid referral code"
        assert db.users.find_one({"email": email}) is None

    def test_register_valid_code_lowercase(self, affiliate):
        s, r, _ = register(ref_code=affiliate["code"].lower())
        assert r.status_code == 200
        u = db.users.find_one({"_id": ObjectId(r.json()["id"])})
        assert u["referred_by"] == affiliate["uid"]

    def test_login_regression(self):
        s, r, email = register()
        s2 = new_session()
        lr = s2.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": "pass1234"})
        assert lr.status_code == 200 and lr.json()["email"] == email
        assert s2.get(f"{BASE_URL}/api/auth/me").status_code == 200


class TestPanel:
    def test_unauth(self):
        assert requests.get(f"{BASE_URL}/api/affiliate").status_code == 401
        assert requests.post(f"{BASE_URL}/api/affiliate/claim").status_code == 401

    def test_panel_shape(self, affiliate):
        d = affiliate["s"].get(f"{BASE_URL}/api/affiliate").json()
        assert d["rate"] == 0.1
        assert isinstance(d["code"], str) and len(d["code"]) >= 4
        for k in ("referrals", "players", "available", "claimed", "lifetime"):
            assert k in d

    def test_code_stable(self, affiliate):
        d = affiliate["s"].get(f"{BASE_URL}/api/affiliate").json()
        assert d["code"] == affiliate["code"]

    def test_check_code(self, affiliate):
        assert requests.get(f"{BASE_URL}/api/affiliate/check/{affiliate['code']}").json() == {"valid": True}
        assert requests.get(f"{BASE_URL}/api/affiliate/check/zzzzNOPE1").json() == {"valid": False}


class TestCommission:
    def test_ngr_carry_forward_and_claim(self):
        a, ar, _ = register(name="TEST_AffB")
        aid = ar.json()["id"]
        code = a.get(f"{BASE_URL}/api/affiliate").json()["code"]
        p, pr, _ = register(ref_code=code, name="TEST_Bob")
        pid = pr.json()["id"]

        # nothing yet
        d = a.get(f"{BASE_URL}/api/affiliate").json()
        assert d["referrals"] == 1 and d["available"] == {}
        assert d["players"][0]["name"] == "TE•••"
        c = a.post(f"{BASE_URL}/api/affiliate/claim")
        assert c.status_code == 400 and c.json()["detail"] == "Nothing to claim yet"

        # player loses 100 -> NGR 100 -> 10 commission
        add_game(pid, "USDT", 100, 0)
        d = a.get(f"{BASE_URL}/api/affiliate").json()
        assert abs(d["available"]["USDT"] - 10) < 1e-6
        assert abs(d["players"][0]["ngr"]["USDT"] - 100) < 1e-6
        assert abs(d["lifetime"]["USDT"] - 10) < 1e-6

        # player wins 60 net -> NGR 40, no clawback
        add_game(pid, "USDT", 10, 70)
        d = a.get(f"{BASE_URL}/api/affiliate").json()
        assert abs(d["available"]["USDT"] - 10) < 1e-6
        assert abs(d["players"][0]["ngr"]["USDT"] - 40) < 1e-6

        # loses 50 -> NGR 90 (< peak 100) -> still 10
        add_game(pid, "USDT", 50, 0)
        d = a.get(f"{BASE_URL}/api/affiliate").json()
        assert abs(d["available"]["USDT"] - 10) < 1e-6

        # sports bet lost 30 -> NGR 120 -> commission 12
        db.bets.insert_one({"id": "TEST_" + uuid.uuid4().hex, "user_id": pid, "coin": "USDT", "stake": 30,
                            "status": "lost", "payout": 0, "potential_payout": 60, "selections": []})
        # cashed out bet stake 20, cashout 5 -> NGR 135; open bet ignored
        db.bets.insert_one({"id": "TEST_" + uuid.uuid4().hex, "user_id": pid, "coin": "USDT", "stake": 20,
                            "status": "cashed_out", "cashout_amount": 5, "potential_payout": 40, "selections": []})
        db.bets.insert_one({"id": "TEST_" + uuid.uuid4().hex, "user_id": pid, "coin": "USDT", "stake": 999,
                            "status": "open", "potential_payout": 2000, "selections": []})
        d = a.get(f"{BASE_URL}/api/affiliate").json()
        assert abs(d["players"][0]["ngr"]["USDT"] - 135) < 1e-6
        assert abs(d["available"]["USDT"] - 13.5) < 1e-6

        # second coin
        add_game(pid, "BTC", 0.01, 0)
        bal_before = a.get(f"{BASE_URL}/api/auth/me").json()["balances"]
        c = a.post(f"{BASE_URL}/api/affiliate/claim")
        assert c.status_code == 200, c.text
        cl = c.json()["claimed"]
        assert abs(cl["USDT"] - 13.5) < 1e-6 and abs(cl["BTC"] - 0.001) < 1e-9
        bal = c.json()["balances"]
        assert abs(bal["USDT"] - bal_before.get("USDT", 0) - 13.5) < 1e-6
        tx = list(db.transactions.find({"user_id": aid, "type": "affiliate"}))
        assert len(tx) == 2
        c2 = a.post(f"{BASE_URL}/api/affiliate/claim")
        assert c2.status_code == 400 and c2.json()["detail"] == "Nothing to claim yet"
        d = a.get(f"{BASE_URL}/api/affiliate").json()
        assert d["available"] == {}
        assert abs(d["claimed"]["USDT"] - 13.5) < 1e-6
        assert abs(d["lifetime"]["USDT"] - 13.5) < 1e-6

    def test_real_dice_accrual(self):
        a, ar, _ = register(name="TEST_AffC")
        code = a.get(f"{BASE_URL}/api/affiliate").json()["code"]
        p, pr, _ = register(ref_code=code, name="TEST_Dice")
        pid = pr.json()["id"]
        db.wallets.update_one({"user_id": pid}, {"$set": {"balances.USDT": 100}})
        for _ in range(5):
            r = p.post(f"{BASE_URL}/api/casino/dice", json={"coin": "USDT", "stake": 5, "target": 90, "direction": "over"})
            assert r.status_code == 200, r.text
        games = list(db.casino_games.find({"user_id": pid}))
        ngr = sum(g["stake"] - g["payout"] for g in games)
        d = a.get(f"{BASE_URL}/api/affiliate").json()
        got = d["available"].get("USDT", 0)
        assert abs(got - max(0, ngr * 0.1)) < 1e-5


class TestCustomCode:
    def test_set_code_and_taken(self, affiliate):
        new = "T" + uuid.uuid4().hex[:8].upper()
        r = affiliate["s"].put(f"{BASE_URL}/api/affiliate/code", json={"code": new.lower()})
        assert r.status_code == 200 and r.json()["code"] == new
        assert affiliate["s"].get(f"{BASE_URL}/api/affiliate").json()["code"] == new
        assert requests.get(f"{BASE_URL}/api/affiliate/check/{new}").json()["valid"] is True
        # other user tries taken code
        s, _, _ = register()
        t = s.put(f"{BASE_URL}/api/affiliate/code", json={"code": new})
        assert t.status_code == 400 and t.json()["detail"] == "That code is taken"
        t2 = s.put(f"{BASE_URL}/api/affiliate/code", json={"code": "APEXVIP"})
        assert t2.status_code == 400

    @pytest.mark.parametrize("bad", ["abc", "A" * 17, "bad code", "a!b@c"])
    def test_invalid_codes(self, affiliate, bad):
        r = affiliate["s"].put(f"{BASE_URL}/api/affiliate/code", json={"code": bad})
        assert r.status_code == 422

    def test_admin_panel(self):
        s = new_session()
        r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@apexodds.io", "password": "admin123"})
        assert r.status_code == 200
        d = s.get(f"{BASE_URL}/api/affiliate").json()
        assert d["code"] == "APEXVIP"
        assert d["referrals"] >= 1
