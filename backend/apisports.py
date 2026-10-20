"""API-Sports feed: fixtures/games + odds for soccer, NBA, NHL, MLB, NFL, normalised to the app's event shape."""
import os
import re
import logging
from datetime import datetime, timezone, timedelta
import httpx

logger = logging.getLogger("apexodds.apisports")
KEY = os.environ.get("APISPORTS_KEY", "")

SPORTS = [
    {"group": "soccer", "base": "https://v3.football.api-sports.io", "games": "fixtures", "league": None, "label": None, "ttl": 3600, "draw": True},
    {"group": "basketball", "base": "https://v1.basketball.api-sports.io", "games": "games", "league": 12, "label": "NBA", "ttl": 2700, "draw": False},
    {"group": "hockey", "base": "https://v1.hockey.api-sports.io", "games": "games", "league": 57, "label": "NHL", "ttl": 2700, "draw": False},
    {"group": "baseball", "base": "https://v1.baseball.api-sports.io", "games": "games", "league": 1, "label": "MLB", "ttl": 2700, "draw": False},
    {"group": "football", "base": "https://v1.american-football.api-sports.io", "games": "games", "league": 1, "label": "NFL", "ttl": 2700, "draw": False},
]
PRE = {"NS", "TBD"}
POST = {"FT", "AET", "PEN", "AOT", "AP", "AW", "POST_FT"}
DEAD = {"PST", "CANC", "ABD", "AWD", "WO", "SUSP", "INTR", "POST", "CAN"}


async def _get(hc, sport, path, params):
    r = await hc.get(f"{sport['base']}/{path}", params=params, headers={"x-apisports-key": KEY})
    data = r.json()
    if data.get("errors"):
        logger.warning(f"API-Sports {sport['group']} {path} errors: {data['errors']}")
    return data.get("response") or []


def _abbr(name):
    words = [w for w in re.split(r"\s+", name or "") if w]
    if len(words) >= 2 and len(words[-1]) >= 3:
        return words[-1][:3].upper()
    return (name or "???")[:3].upper()


def _score(v):
    if isinstance(v, dict):
        v = v.get("total")
    return v if isinstance(v, (int, float)) else None


def _even(pairs):
    """Pick the line whose two prices are closest to each other (the main line)."""
    return min(pairs, key=lambda p: abs(p[1] - p[2])) if pairs else None


def _markets(bets, ha, aa, draw):
    out = []
    by = {b.get("name", ""): b.get("values", []) for b in bets}
    ml = by.get("Match Winner") or by.get("3Way Result") if draw else by.get("Home/Away") or by.get("Match Winner")
    if ml:
        sel = []
        for v in ml:
            side = {"Home": "home", "Away": "away", "Draw": "draw"}.get(v.get("value"))
            if side and (draw or side != "draw"):
                sel.append({"side": side, "pick": "Draw" if side == "draw" else f"{ha if side == 'home' else aa} ML",
                            "odds": float(v["odd"]), "line": None})
        if len(sel) >= 2:
            out.append({"market": "moneyline", "label": "Moneyline", "selections": sel})
    hcap = by.get("Asian Handicap") or by.get("Handicap Result")
    if hcap and not draw:
        lines = {}
        for v in hcap:
            m = re.match(r"(Home|Away)\s*([+-]?\d+(?:\.\d+)?)", v.get("value", ""))
            if m:
                lines.setdefault(abs(float(m.group(2))), {})[m.group(1)] = (float(m.group(2)), float(v["odd"]))
        pairs = [(k, d["Home"][1], d["Away"][1], d) for k, d in lines.items() if "Home" in d and "Away" in d and d["Home"][0] == -d["Away"][0]]
        best = _even(pairs)
        if best:
            d = best[3]
            hl, al = d["Home"][0], d["Away"][0]
            out.append({"market": "spread", "label": "Spread", "selections": [
                {"side": "home", "pick": f"{ha} {hl:+g}", "odds": d["Home"][1], "line": hl},
                {"side": "away", "pick": f"{aa} {al:+g}", "odds": d["Away"][1], "line": al}]})
    ou = by.get("Goals Over/Under") or by.get("Over/Under")
    if ou:
        lines = {}
        for v in ou:
            m = re.match(r"(Over|Under)\s*(\d+(?:\.\d+)?)$", v.get("value", ""))
            if m:
                lines.setdefault(float(m.group(2)), {})[m.group(1)] = float(v["odd"])
        pairs = [(k, d["Over"], d["Under"]) for k, d in lines.items() if "Over" in d and "Under" in d]
        best = (lines.get(2.5) and (2.5, lines[2.5].get("Over"), lines[2.5].get("Under"))) if draw else None
        best = best if best and best[1] and best[2] else _even(pairs)
        if best:
            line, oo, uo = best[0], best[1], best[2]
            out.append({"market": "total", "label": "Total", "selections": [
                {"side": "over", "pick": f"Over {line:g}", "odds": oo, "line": line},
                {"side": "under", "pick": f"Under {line:g}", "odds": uo, "line": line}]})
    return out


def _event(sport, g, bets):
    core = g.get("fixture") or g.get("game") or g
    st = core.get("status", {}) or {}
    short = st.get("short", "NS")
    if short in DEAD:
        return None
    state = "pre" if short in PRE else "post" if short in POST else "in"
    teams = g["teams"]
    ha, aa = _abbr(teams["home"]["name"]), _abbr(teams["away"]["name"])
    gid = core["id"]
    start = core.get("date")
    if isinstance(start, dict):
        start = datetime.fromtimestamp(start["timestamp"], timezone.utc).isoformat() if start.get("timestamp") else None
    sc_home = g["goals"]["home"] if "goals" in g else _score((g.get("scores") or {}).get("home"))
    sc_away = g["goals"]["away"] if "goals" in g else _score((g.get("scores") or {}).get("away"))
    detail = st.get("long") or short
    if state == "in" and st.get("elapsed"):
        detail = f"{short} {st['elapsed']}'"
    return {
        "event_id": f"as-{sport['group']}-{gid}", "league": sport["group"], "league_key": str(g["league"]["id"]),
        "league_label": sport["label"] or g["league"]["name"], "name": f"{aa} @ {ha}", "start": start, "state": state,
        "status_detail": "Upcoming" if state == "pre" else detail,
        "home": {"name": teams["home"]["name"], "abbr": ha, "logo": teams["home"].get("logo"), "score": sc_home},
        "away": {"name": teams["away"]["name"], "abbr": aa, "logo": teams["away"].get("logo"), "score": sc_away},
        "markets": _markets(bets, ha, aa, sport["draw"]) if bets else [], "source": "api-sports",
        "book": "API-Sports", "props": [], "player_results": {},
    }


async def fetch_sport(sport):
    """One refresh for a sport: today's + yesterday's games, plus odds."""
    now = datetime.now(timezone.utc)
    days = [(now - timedelta(days=1)).strftime("%Y-%m-%d"), now.strftime("%Y-%m-%d")]
    events = []
    async with httpx.AsyncClient(timeout=20) as hc:
        games = []
        for d in days:
            games += await _get(hc, sport, sport["games"], {"date": d})
        if sport["league"]:
            games = [g for g in games if g["league"]["id"] == sport["league"]]
        odds_by = {}
        if sport["group"] == "soccer":
            for page in (1, 2):
                for o in await _get(hc, sport, "odds", {"date": days[1], "bookmaker": 8, "page": page}):
                    bk = o.get("bookmakers") or []
                    if bk:
                        odds_by[o["fixture"]["id"]] = bk[0]["bets"]
        elif sport.get("odds") and any(((g.get("status") or {}).get("short") in PRE) for g in games):
            season = games[0]["league"]["season"]
            for o in await _get(hc, sport, "odds", {"league": sport["league"], "season": season}):
                bk = o.get("bookmakers") or []
                if bk:
                    odds_by[o["game"]["id"]] = bk[0]["bets"]
    for g in games:
        gid = (g.get("fixture") or g.get("game") or g)["id"]
        ev = _event(sport, g, odds_by.get(gid))
        if not ev:
            continue
        ev["hidden"] = not ev["markets"]
        events.append(ev)
    return events
