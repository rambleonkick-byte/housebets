# API-Sports feed integration: /api/odds shape, filtering, betting (single/parlay/tamper), cash-out quotes, cache quota safety
import os
import time
import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv('/app/backend/.env')
load_dotenv('/app/frontend/.env')
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
db = MongoClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
STAKE = 0.5
COIN = "USDT"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "player@apexodds.io", "password": "player123"})
    if r.status_code != 200:
        pytest.skip("login failed")
    tok = r.json().get("token") or r.json().get("access_token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    return s


@pytest.fixture(scope="module")
def odds():
    r = requests.get(f"{BASE_URL}/api/odds", timeout=60)
    assert r.status_code == 200
    return r.json()["events"]


def _pre(events):
    return [e for e in events if e["state"] == "pre" and e["event_id"].startswith("as-soccer-")]


def _sel(ev, market="moneyline", side="home", odds=None):
    m = next(x for x in ev["markets"] if x["market"] == market)
    s = next(x for x in m["selections"] if x["side"] == side)
    return {"event_id": ev["event_id"], "league": ev["league"], "market": market, "side": side,
            "pick": s["pick"], "odds": odds if odds is not None else s["odds"], "line": s["line"],
            "league_label": ev["league_label"], "home": ev["home"]["name"], "away": ev["away"]["name"]}


class TestOddsFeed:
    def test_soccer_events_shape(self, odds):
        soc = [e for e in odds if e["event_id"].startswith("as-soccer-")]
        assert len(soc) > 0
        for e in soc:
            assert e["book"] == "API-Sports"
            assert e["league"] == "soccer"
            assert e["markets"], "events without markets must be hidden"
            assert "media.api-sports.io" in (e["home"]["logo"] or "")
            assert "media.api-sports.io" in (e["away"]["logo"] or "")
            ml = next(m for m in e["markets"] if m["market"] == "moneyline")
            assert {s["side"] for s in ml["selections"]} == {"home", "draw", "away"}
            tot = next((m for m in e["markets"] if m["market"] == "total"), None)
            if tot:
                assert {s["side"] for s in tot["selections"]} == {"over", "under"}
            assert "hidden" not in e or e["hidden"] is False

    def test_total_is_2_5(self, odds):
        lines = [s["line"] for e in odds if e["league"] == "soccer" for m in e["markets"] if m["market"] == "total" for s in m["selections"]]
        assert lines and all(l == 2.5 for l in lines), set(lines)

    def test_league_filter(self, odds):
        r = requests.get(f"{BASE_URL}/api/odds", params={"league": "soccer"}, timeout=60)
        assert r.status_code == 200
        evs = r.json()["events"]
        assert evs and all(e["league"] == "soccer" for e in evs)
        assert len(evs) == len([e for e in odds if e["league"] == "soccer"])

    def test_cache_no_refetch(self):
        before = {d["key"]: d["ts"] for d in db.feed_cache.find({"key": {"$regex": "^aps:"}})}
        for k in ["aps:soccer", "aps:basketball", "aps:hockey", "aps:baseball", "aps:football"]:
            assert k in before, k
        for _ in range(3):
            assert requests.get(f"{BASE_URL}/api/odds", timeout=60).status_code == 200
        after = {d["key"]: d["ts"] for d in db.feed_cache.find({"key": {"$regex": "^aps:"}})}
        assert before == after, "feed_cache ts changed -> upstream refetch within TTL"


class TestBetting:
    def test_single_bet_and_cashout_quote(self, client, odds):
        pre = _pre(odds)
        if not pre:
            pytest.skip("no pre-match soccer events")
        sel = _sel(pre[0], "moneyline", "home")
        r = client.post(f"{BASE_URL}/api/bets", json={"selections": [sel], "stake": STAKE, "coin": COIN, "bet_type": "single"})
        assert r.status_code == 200, r.text
        bet = r.json()["bet"]
        assert bet["status"] == "open" and bet["total_odds"] == round(sel["odds"], 2)
        lst = client.get(f"{BASE_URL}/api/bets").json()
        lst = lst.get("bets", lst) if isinstance(lst, dict) else lst
        assert any(b["id"] == bet["id"] for b in lst)
        q = client.get(f"{BASE_URL}/api/bets/cashout-quotes").json()["quotes"]
        assert bet["id"] in q and isinstance(q[bet["id"]], float) and 0 < q[bet["id"]] < STAKE * bet["total_odds"]
        TestBetting.single_id = bet["id"]

    def test_tampered_odds_409(self, client, odds):
        pre = _pre(odds)
        if not pre:
            pytest.skip("no pre events")
        sel = _sel(pre[0], "moneyline", "away")
        sel["odds"] = round(sel["odds"] + 5, 2)
        r = client.post(f"{BASE_URL}/api/bets", json={"selections": [sel], "stake": STAKE, "coin": COIN, "bet_type": "single"})
        assert r.status_code == 409, r.text
        assert r.json()["detail"]["changed"]

    def test_unknown_event_409(self, client):
        sel = {"event_id": "as-soccer-999999999", "league": "soccer", "market": "moneyline", "side": "home",
               "pick": "X ML", "odds": 2.0, "line": None, "league_label": "X", "home": "A", "away": "B"}
        r = client.post(f"{BASE_URL}/api/bets", json={"selections": [sel], "stake": STAKE, "coin": COIN, "bet_type": "single"})
        assert r.status_code == 409
        assert r.json()["detail"]["unavailable"]

    def test_parlay(self, client, odds):
        pre = _pre(odds)
        if len(pre) < 2:
            pytest.skip("need 2 events")
        sels = [_sel(pre[0], "total", "over"), _sel(pre[1], "moneyline", "draw")]
        r = client.post(f"{BASE_URL}/api/bets", json={"selections": sels, "stake": STAKE, "coin": COIN, "bet_type": "parlay"})
        assert r.status_code == 200, r.text
        bet = r.json()["bet"]
        assert bet["bet_type"] == "parlay"
        assert abs(bet["total_odds"] - round(sels[0]["odds"] * sels[1]["odds"], 2)) < 0.02
        q = client.get(f"{BASE_URL}/api/bets/cashout-quotes").json()["quotes"]
        assert q.get(bet["id"]) and q[bet["id"]] > 0

    def test_finished_event_rejected(self, client, odds):
        post = [e for e in odds if e["state"] == "post" and e["markets"]]
        if not post:
            pytest.skip("no finished events")
        sel = _sel(post[0], "moneyline", "home")
        r = client.post(f"{BASE_URL}/api/bets", json={"selections": [sel], "stake": STAKE, "coin": COIN, "bet_type": "single"})
        assert r.status_code == 409
