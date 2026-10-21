# VIP ranks, promo codes (cash / free bet / deposit match), player profile, admin promo + VIP bonus APIs
import os
import uuid
from datetime import datetime, timezone, timedelta
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN = {"email": "admin@apexodds.io", "password": "admin123"}
TAG = uuid.uuid4().hex[:6].upper()


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
    email = f"test_vip_{uuid.uuid4().hex[:8]}@example.com"
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/register", json={"name": "TEST Vip", "email": email, "password": "Passw0rd!"})
    assert r.status_code in (200, 201), r.text
    return s, r.json()["id"], email


CODES = []


def _promo(adm, **kw):
    code = f"T{TAG}{kw.pop('suffix')}"
    body = {"code": code, **kw}
    r = adm.post(f"{BASE_URL}/api/admin/promos", json=body)
    assert r.status_code == 200, r.text
    CODES.append(code)
    return code


@pytest.fixture(scope="module")
def ctx():
    adm = _login(**ADMIN)
    p, uid, email = _register()
    p2, uid2, email2 = _register()
    orig = adm.get(f"{BASE_URL}/api/admin/vip-bonuses").json()["amounts"]
    yield {"admin": adm, "p": p, "uid": uid, "p2": p2, "uid2": uid2, "orig": orig}
    adm.put(f"{BASE_URL}/api/admin/vip-bonuses", json={"amounts": orig})
    db = _mongo()
    from bson import ObjectId
    for u in (uid, uid2):
        for col in ("wallets", "bets", "casino_games", "transactions", "rewards", "free_bets", "promo_redemptions",
                    "withdrawals", "notifications", "fair_seeds", "admin_log"):
            db[col].delete_many({"user_id": u})
        db.users.delete_one({"_id": ObjectId(u)})
    db.promo_codes.delete_many({"code": {"$in": CODES}})


def _bal(s):
    return s.get(f"{BASE_URL}/api/auth/me").json()["balances"]["USD"]


def _fund(ctx, uid, amt):
    r = ctx["admin"].post(f"{BASE_URL}/api/admin/users/{uid}/adjust", json={"coin": "USD", "amount": amt, "reason": "TEST fund"})
    assert r.status_code == 200, r.text


def _selection():
    r = requests.get(f"{BASE_URL}/api/odds", timeout=60)
    for ev in r.json()["events"]:
        if ev["state"] != "pre":
            continue
        for m in ev["markets"]:
            if m["market"] == "moneyline":
                s = m["selections"][0]
                return {"event_id": ev["event_id"], "league": ev["league"], "league_label": ev["league_label"],
                        "home": ev["home"]["abbr"], "away": ev["away"]["abbr"], "market": "moneyline",
                        "pick": s["pick"], "side": s["side"], "line": s["line"], "odds": s["odds"]}
    pytest.skip("No pre-game moneyline available")


# --- RBAC ---
def test_non_admin_forbidden(ctx):
    p = ctx["p"]
    assert p.get(f"{BASE_URL}/api/admin/promos").status_code == 403
    assert p.post(f"{BASE_URL}/api/admin/promos", json={"code": "XXXX", "type": "cash", "amount": 5}).status_code == 403
    assert p.post(f"{BASE_URL}/api/admin/promos/XXXX/active", json={"active": False}).status_code == 403
    assert p.get(f"{BASE_URL}/api/admin/vip-bonuses").status_code == 403
    assert p.put(f"{BASE_URL}/api/admin/vip-bonuses", json={"amounts": {}}).status_code == 403


# --- Profile shape ---
def test_new_profile_bronze(ctx):
    d = ctx["p"].get(f"{BASE_URL}/api/profile").json()
    for k in ("deposits", "withdrawals", "sports", "casino", "pnl", "vip", "wagering", "free_bets", "pending_match"):
        assert k in d
    assert d["vip"]["tier"] == "Bronze" and d["vip"]["next_tier"] == "Silver"
    assert len(d["vip"]["tiers"]) == 15 and d["vip"]["tiers"][1]["points"] == 10000
    assert d["vip"]["tiers"][-1]["name"] == "Black III" and d["vip"]["tiers"][-1]["points"] == 500_000_000
    for k in ("staked", "returned", "pnl", "win_rate", "biggest_win"):
        assert k in d["sports"]
    assert d["wagering"] == {"target": 0, "remaining": 0}


# --- Admin promo validation ---
def test_admin_promo_validation(ctx):
    adm = ctx["admin"]
    u = f"{BASE_URL}/api/admin/promos"
    assert adm.post(u, json={"code": f"T{TAG}BAD", "type": "weird", "amount": 5}).status_code == 400
    assert adm.post(u, json={"code": f"T{TAG}BAD", "type": "cash", "amount": 0}).status_code == 400
    assert adm.post(u, json={"code": f"T{TAG}BAD", "type": "deposit_match", "pct": 100}).status_code == 400
    assert adm.post(u, json={"code": "a b", "type": "cash", "amount": 5}).status_code == 422
    code = _promo(adm, suffix="DUP", type="cash", amount=1)
    assert adm.post(u, json={"code": code.lower(), "type": "cash", "amount": 1}).status_code == 400
    lst = adm.get(u).json()["promos"]
    row = next(x for x in lst if x["code"] == code)
    assert row["uses"] == 0 and row["active"] is True and "desc" in row


# --- Cash promo + wagering gate ---
def test_cash_promo_and_wagering_gate(ctx):
    adm, p = ctx["admin"], ctx["p"]
    code = _promo(adm, suffix="CASH", type="cash", amount=50, wager_mult=1)
    b0 = _bal(p)
    r = p.post(f"{BASE_URL}/api/promo/redeem", json={"code": code.lower()})
    assert r.status_code == 200, r.text
    assert round(r.json()["balances"]["USD"] - b0, 2) == 50
    r2 = p.post(f"{BASE_URL}/api/promo/redeem", json={"code": code})
    assert r2.status_code == 400 and "already" in r2.json()["detail"].lower()
    prof = p.get(f"{BASE_URL}/api/profile").json()
    assert prof["wagering"]["target"] == 50 and prof["wagering"]["remaining"] == 50
    assert prof["bonuses"] == 50
    w = p.post(f"{BASE_URL}/api/wallet/withdraw", json={"coin": "USDT", "amount": 5, "address": "0x" + "a" * 40})
    assert w.status_code == 400 and "Wager $50.00 more" in w.json()["detail"], w.text
    # partially wager
    d = p.post(f"{BASE_URL}/api/casino/dice", json={"coin": "USD", "stake": 20, "target": 50, "direction": "over"})
    assert d.status_code == 200, d.text
    w = p.post(f"{BASE_URL}/api/wallet/withdraw", json={"coin": "USDT", "amount": 5, "address": "0x" + "a" * 40})
    assert w.status_code == 400 and "Wager $30.00 more" in w.json()["detail"], w.text
    _fund(ctx, ctx["uid"], 100)
    d = p.post(f"{BASE_URL}/api/casino/dice", json={"coin": "USD", "stake": 30, "target": 50, "direction": "over"})
    assert d.status_code == 200, d.text
    w = p.post(f"{BASE_URL}/api/wallet/withdraw", json={"coin": "USDT", "amount": 99999, "address": "0x" + "a" * 40})
    assert "Wager" not in w.text, w.text
    assert p.get(f"{BASE_URL}/api/profile").json()["wagering"]["remaining"] == 0


# --- Invalid / disabled / exhausted / expired codes ---
def test_code_error_states(ctx):
    adm, p, p2 = ctx["admin"], ctx["p"], ctx["p2"]
    assert p.post(f"{BASE_URL}/api/promo/redeem", json={"code": "NOPE" + TAG}).status_code == 404
    dis = _promo(adm, suffix="DIS", type="cash", amount=1)
    assert adm.post(f"{BASE_URL}/api/admin/promos/{dis}/active", json={"active": False}).json()["active"] is False
    assert p.post(f"{BASE_URL}/api/promo/redeem", json={"code": dis}).status_code == 404
    assert adm.post(f"{BASE_URL}/api/admin/promos/NOPE{TAG}/active", json={"active": False}).status_code == 404
    one = _promo(adm, suffix="ONE", type="cash", amount=1, max_uses=1)
    assert p.post(f"{BASE_URL}/api/promo/redeem", json={"code": one}).status_code == 200
    r = p2.post(f"{BASE_URL}/api/promo/redeem", json={"code": one})
    assert r.status_code == 400 and "run out" in r.json()["detail"]
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    exp = _promo(adm, suffix="EXP", type="cash", amount=1, expires_at=past)
    r = p2.post(f"{BASE_URL}/api/promo/redeem", json={"code": exp})
    assert r.status_code == 400 and "expired" in r.json()["detail"]
    # date-only expiry (as a date picker might send) for yesterday
    exp2 = _promo(adm, suffix="EXPD", type="cash", amount=1, expires_at=(datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat())
    assert p2.post(f"{BASE_URL}/api/promo/redeem", json={"code": exp2}).status_code == 400


# --- Free bet ---
def test_free_bet_flow(ctx):
    adm, p = ctx["admin"], ctx["p"]
    code = _promo(adm, suffix="FB", type="free_bet", amount=10)
    assert p.post(f"{BASE_URL}/api/promo/redeem", json={"code": code}).status_code == 200
    fbs = p.get(f"{BASE_URL}/api/free-bets").json()["free_bets"]
    assert len(fbs) == 1 and fbs[0]["amount"] == 10
    assert len(p.get(f"{BASE_URL}/api/profile").json()["free_bets"]) == 1
    fid = fbs[0]["id"]
    sel = _selection()
    wag0 = p.get(f"{BASE_URL}/api/profile").json()["wagered"]
    bad = p.post(f"{BASE_URL}/api/bets", json={"selections": [sel], "stake": 5, "coin": "USD", "free_bet_id": fid})
    assert bad.status_code == 400 and "must be" in bad.text
    b0 = _bal(p)
    r = p.post(f"{BASE_URL}/api/bets", json={"selections": [sel], "stake": 10, "coin": "USD", "free_bet_id": fid})
    assert r.status_code == 200, r.text
    assert r.json()["bet"]["free_bet"] is True
    assert r.json()["balances"]["USD"] == b0
    again = p.post(f"{BASE_URL}/api/bets", json={"selections": [sel], "stake": 10, "coin": "USD", "free_bet_id": fid})
    assert again.status_code == 400
    bid = r.json()["bet"]["id"]
    q = p.get(f"{BASE_URL}/api/bets/cashout-quotes").json()["quotes"]
    assert q.get(bid) is None
    assert p.post(f"{BASE_URL}/api/bets/{bid}/cashout").status_code >= 400
    prof = p.get(f"{BASE_URL}/api/profile").json()
    assert prof["free_bets"] == [] and prof["wagered"] == wag0
    ctx["sel"] = sel


# --- Regression: normal bet deducts ---
def test_normal_bet_deducts(ctx):
    p = ctx["p"]
    sel = ctx.get("sel") or _selection()
    _fund(ctx, ctx["uid"], 5)
    b0 = _bal(p)
    r = p.post(f"{BASE_URL}/api/bets", json={"selections": [sel], "stake": 2, "coin": "USD"})
    assert r.status_code == 200, r.text
    assert round(b0 - r.json()["balances"]["USD"], 2) == 2 and r.json()["bet"]["free_bet"] is False


# --- Deposit match ---
def test_deposit_match_pending(ctx):
    adm, p2 = ctx["admin"], ctx["p2"]
    c1 = _promo(adm, suffix="DM1", type="deposit_match", pct=100, max_bonus=50, wager_mult=2)
    c2 = _promo(adm, suffix="DM2", type="deposit_match", pct=50, max_bonus=20)
    assert p2.post(f"{BASE_URL}/api/promo/redeem", json={"code": c1}).status_code == 200
    pm = p2.get(f"{BASE_URL}/api/profile").json()["pending_match"]
    assert pm["code"] == c1 and pm["pct"] == 100 and pm["max_bonus"] == 50
    r = p2.post(f"{BASE_URL}/api/promo/redeem", json={"code": c2})
    assert r.status_code == 400 and "deposit match" in r.json()["detail"]
    # c2 use counter must not be consumed by the rejected attempt
    row = next(x for x in adm.get(f"{BASE_URL}/api/admin/promos").json()["promos"] if x["code"] == c2)
    assert row["uses"] == 0


# --- VIP bonus editor + level-up ---
def test_vip_bonus_editor(ctx):
    adm = ctx["admin"]
    amounts = dict(ctx["orig"]); amounts["Silver"] = 33
    r = adm.put(f"{BASE_URL}/api/admin/vip-bonuses", json={"amounts": amounts})
    assert r.status_code == 200 and r.json()["amounts"]["Silver"] == 33
    assert adm.get(f"{BASE_URL}/api/admin/vip-bonuses").json()["amounts"]["Silver"] == 33
    bad = dict(amounts); bad["Gold"] = -5
    assert adm.put(f"{BASE_URL}/api/admin/vip-bonuses", json={"amounts": bad}).status_code == 400
    bad["Gold"] = "abc"
    assert adm.put(f"{BASE_URL}/api/admin/vip-bonuses", json={"amounts": bad}).status_code == 400
    assert adm.get(f"{BASE_URL}/api/admin/vip-bonuses").json()["amounts"]["Gold"] == ctx["orig"]["Gold"]


def test_level_up_silver_once(ctx):
    p2, uid2 = ctx["p2"], ctx["uid2"]
    p2.get(f"{BASE_URL}/api/profile")  # ensure rewards doc exists at Bronze
    db = _mongo()
    db.casino_games.insert_one({"id": str(uuid.uuid4()), "user_id": uid2, "game": "dice", "coin": "USD", "stake": 10000.0,
                                "multiplier": 0, "payout": 0, "won": False, "detail": {}, "created_at": datetime.now(timezone.utc).isoformat()})
    b0 = _bal(p2)
    prof = p2.get(f"{BASE_URL}/api/profile").json()
    assert prof["vip"]["tier"] == "Silver" and prof["vip"]["next_tier"] == "Gold"
    assert round(_bal(p2) - b0, 2) == 33
    assert prof["wagering"]["target"] == 10033 and prof["wagering"]["remaining"] == 33
    p2.get(f"{BASE_URL}/api/profile")
    txs = list(db.transactions.find({"user_id": uid2, "type": "bonus", "bonus_kind": "vip"}))
    assert len(txs) == 1 and txs[0]["amount"] == 33
    assert round(_bal(p2) - b0, 2) == 33
