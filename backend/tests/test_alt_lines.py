"""Alternate spread/total markets: feed shape, gzip, bet placement/verification, settlement."""
import os
import sys
import uuid
import pytest
import requests
from pymongo import MongoClient
from bson import ObjectId
from dotenv import dotenv_values

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"]
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"
benv = dotenv_values("/app/backend/.env")
mdb = MongoClient(benv["MONGO_URL"])[benv["DB_NAME"]]

_cache = {}


def odds(league):
    if league not in _cache:
        r = requests.get(f"{API}/odds", params={"league_key": league}, timeout=60)
        assert r.status_code == 200
        _cache[league] = (r, r.json()["events"])
    return _cache[league]


def mk(ev, name):
    return next((m for m in ev["markets"] if m["market"] == name), None)


# ---- Feed shape ----
@pytest.mark.parametrize("league", ["NFL", "NBA", "EPL"])
class TestAltFeed:
    def test_gzip(self, league):
        r, _ = odds(league)
        assert r.headers.get("Content-Encoding") == "gzip"

    def test_alt_markets_present_and_valid(self, league):
        _, evs = odds(league)
        assert evs
        withalt = [e for e in evs if mk(e, "alt_spread") and mk(e, "alt_total")]
        assert withalt, "no event has alt markets"
        for e in withalt:
            sp, tot = mk(e, "alt_spread"), mk(e, "alt_total")
            for s in sp["selections"] + tot["selections"]:
                assert s["line"] * 2 == int(s["line"] * 2), f"quarter line {s}"
                assert s["odds"] > 1
            assert {s["side"] for s in sp["selections"]} <= {"home", "away"}
            assert {s["side"] for s in tot["selections"]} <= {"over", "under"}
            homes = {s["line"] for s in sp["selections"] if s["side"] == "home"}
            aways = {-s["line"] for s in sp["selections"] if s["side"] == "away"}
            # mirror: union of keys exists; check at least overlap
            assert homes & aways, "home/away alt lines never mirror"
            # unique (side,line)
            keys = [(s["side"], s["line"]) for s in sp["selections"] + tot["selections"]]
            assert len(keys) == len(set(keys))


# ---- Settlement ----
class TestSettle:
    @pytest.fixture(scope="class")
    def settle(self):
        sys.path.insert(0, "/app/backend")
        from server import settle_selection
        return settle_selection

    def ev(self, h, a):
        return {"home": {"score": h}, "away": {"score": a}}

    def test_alt_spread(self, settle):
        assert settle({"market": "alt_spread", "side": "home", "line": -6.5}, self.ev(30, 20)) is True
        assert settle({"market": "alt_spread", "side": "away", "line": 6.5}, self.ev(30, 20)) is False
        assert settle({"market": "alt_spread", "side": "home", "line": -10.0}, self.ev(30, 20)) == "push"
        assert settle({"market": "alt_spread", "side": "away", "line": 10.0}, self.ev(30, 20)) == "push"
        assert settle({"market": "alt_spread", "side": "away", "line": 12.5}, self.ev(30, 20)) is True

    def test_alt_total(self, settle):
        assert settle({"market": "alt_total", "side": "over", "line": 49.5}, self.ev(30, 20)) is True
        assert settle({"market": "alt_total", "side": "under", "line": 49.5}, self.ev(30, 20)) is False
        assert settle({"market": "alt_total", "side": "over", "line": 50.0}, self.ev(30, 20)) == "push"
        assert settle({"market": "alt_total", "side": "under", "line": 50.0}, self.ev(30, 20)) == "push"

    def test_main_spread_push(self, settle):
        assert settle({"market": "spread", "side": "home", "line": -3.0}, self.ev(23, 20)) == "push"


# ---- Bet placement ----
@pytest.fixture(scope="module")
def user():
    s = requests.Session()
    email = f"test_alt_{uuid.uuid4().hex[:8]}@apexodds.io"
    r = s.post(f"{API}/auth/register", json={"name": "TEST Alt", "email": email, "password": "pass1234"})
    assert r.status_code in (200, 201), r.text
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    u = mdb.users.find_one({"email": email})
    uid = str(u["_id"]) if "id" not in u else u["id"]
    s.get(f"{API}/wallet")
    mdb.wallets.update_one({"user_id": uid}, {"$set": {"balances.USDT": 1000}}, upsert=True)
    yield s, uid
    for c in ("wallets", "bets", "transactions", "casino_games", "slips"):
        mdb[c].delete_many({"user_id": uid})
    mdb.users.delete_one({"email": email})


def leg(ev, market, sel):
    return {"event_id": ev["event_id"], "league": ev["league"], "league_label": ev.get("league_label", ""),
            "home": ev["home"]["abbr"], "away": ev["away"]["abbr"], "market": market,
            "pick": sel["pick"], "side": sel["side"], "line": sel["line"], "odds": sel["odds"]}


def pre_events(league):
    _, evs = odds(league)
    return [e for e in evs if e["state"] == "pre" and mk(e, "alt_spread") and mk(e, "alt_total")]


class TestAltBets:
    def test_single_alt_spread(self, user):
        s, _ = user
        ev = pre_events("NBA")[0]
        sel = [x for x in mk(ev, "alt_spread")["selections"] if 1.3 < x["odds"] < 5][0]
        r = s.post(f"{API}/bets", json={"selections": [leg(ev, "alt_spread", sel)], "stake": 5, "coin": "USDT"})
        assert r.status_code == 200, r.text
        b = r.json()["bet"]
        assert b["selections"][0]["market"] == "alt_spread"
        assert b["selections"][0]["line"] == sel["line"]

    def test_parlay_with_alt_total(self, user):
        s, _ = user
        evs = pre_events("NBA")
        e1, e2 = evs[1], evs[2]
        a = [x for x in mk(e1, "alt_total")["selections"] if 1.3 < x["odds"] < 5][0]
        b = mk(e2, "moneyline")["selections"][0]
        r = s.post(f"{API}/bets", json={"selections": [leg(e1, "alt_total", a), leg(e2, "moneyline", b)],
                                        "stake": 5, "coin": "USDT", "bet_type": "parlay"})
        assert r.status_code == 200, r.text
        assert r.json()["bet"]["bet_type"] == "parlay"

    def test_tampered_alt_odds_409(self, user):
        s, _ = user
        ev = pre_events("NFL")[0]
        sel = dict([x for x in mk(ev, "alt_total")["selections"] if 1.3 < x["odds"] < 5][0])
        sel["odds"] = round(sel["odds"] + 3, 2)
        r = s.post(f"{API}/bets", json={"selections": [leg(ev, "alt_total", sel)], "stake": 5, "coin": "USDT"})
        assert r.status_code == 409, r.text
        d = r.json()["detail"]
        assert d["changed"] and d["changed"][0]["market"] == "alt_total"

    def test_nonexistent_alt_line_409(self, user):
        s, _ = user
        ev = pre_events("NFL")[0]
        sel = dict(mk(ev, "alt_spread")["selections"][0])
        sel["line"] = 999.5
        r = s.post(f"{API}/bets", json={"selections": [leg(ev, "alt_spread", sel)], "stake": 5, "coin": "USDT"})
        assert r.status_code == 409
        assert r.json()["detail"]["unavailable"]

    def test_two_alt_lines_same_market_rejected(self, user):
        s, _ = user
        ev = pre_events("NFL")[0]
        sels = [x for x in mk(ev, "alt_spread")["selections"] if x["side"] == "home" and 1.3 < x["odds"] < 5][:2]
        r = s.post(f"{API}/bets", json={"selections": [leg(ev, "alt_spread", x) for x in sels],
                                        "stake": 5, "coin": "USDT", "bet_type": "parlay"})
        assert r.status_code == 400

    def test_bets_history_has_alt(self, user):
        s, _ = user
        r = s.get(f"{API}/bets")
        assert r.status_code == 200
        data = r.json()
        bets = data if isinstance(data, list) else data.get("bets", [])
        mkts = {x["market"] for b in bets for x in b["selections"]}
        assert {"alt_spread", "alt_total"} <= mkts
