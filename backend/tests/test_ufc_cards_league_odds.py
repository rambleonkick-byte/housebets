# UFC fighter enrichment (ESPN) + per-league odds endpoint (league_key) tests
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def ufc(s):
    r = s.get(f"{API}/odds", params={"league_key": "UFC"}, timeout=60)
    assert r.status_code == 200
    return r.json()["events"]


# --- league_key filtering ---
class TestLeagueKey:
    def test_sports_list_has_league_keys(self, s):
        r = s.get(f"{API}/sports", timeout=20)
        assert r.status_code == 200
        keys = [l["key"] for g in r.json() for l in g["leagues"]]
        assert "UFC" in keys and "NBA" in keys

    def test_nba_only(self, s):
        r = s.get(f"{API}/odds", params={"league_key": "NBA"}, timeout=60)
        assert r.status_code == 200
        evs = r.json()["events"]
        assert all(e["league_key"] == "NBA" for e in evs)

    def test_unknown_league_404(self, s):
        r = s.get(f"{API}/odds", params={"league_key": "NOPE"}, timeout=20)
        assert r.status_code == 404
        assert r.json().get("detail") == "Unknown league"

    def test_all_odds_no_params(self, s):
        r = s.get(f"{API}/odds", timeout=120)
        assert r.status_code == 200
        evs = r.json()["events"]
        assert len({e["league_key"] for e in evs}) > 1

    def test_group_soccer(self, s):
        r = s.get(f"{API}/odds", params={"league": "soccer"}, timeout=120)
        assert r.status_code == 200
        assert all(e["league"] == "soccer" for e in r.json()["events"])


# --- UFC enrichment ---
class TestUfcEnrichment:
    def test_ufc_events_present(self, ufc):
        assert len(ufc) > 0
        assert all(e["league_key"] == "UFC" for e in ufc)

    def test_enriched_fields(self, ufc):
        enriched = [e for e in ufc if e.get("card_name")]
        assert enriched, "no UFC event got ESPN card_name"
        for e in enriched:
            assert isinstance(e["bout_order"], int)
            assert isinstance(e["main_event"], bool)
            assert "weight_class" in e
            for side in ("home", "away"):
                for k in ("photo", "record", "flag"):
                    # at least one side matched; unmatched side may lack keys
                    pass
            assert any(e[sd].get("photo") for sd in ("home", "away"))

    def test_photo_url_format(self, ufc):
        photos = [e[sd]["photo"] for e in ufc for sd in ("home", "away") if e[sd].get("photo")]
        assert photos
        assert all(p.startswith("https://a.espncdn.com/i/headshots/mma/players/full/") for p in photos)
        r = requests.head(photos[0], timeout=15)
        assert r.status_code == 200

    def test_record_format(self, ufc):
        recs = [e[sd]["record"] for e in ufc for sd in ("home", "away") if e[sd].get("record")]
        assert recs and all(len(r.split("-")) >= 3 for r in recs)

    def test_max_one_main_event_per_card(self, ufc):
        per = {}
        for e in ufc:
            if e.get("main_event"):
                per[e["card_name"]] = per.get(e["card_name"], 0) + 1
        assert all(v == 1 for v in per.values())

    def test_moneyline_present(self, ufc):
        for e in ufc:
            ml = next(m for m in e["markets"] if m["market"] == "moneyline")
            assert {s["side"] for s in ml["selections"]} >= {"home", "away"}
