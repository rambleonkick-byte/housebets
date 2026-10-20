from dotenv import load_dotenv
from pathlib import Path
import os

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, Request, Response, HTTPException, Depends
from fastapi.responses import PlainTextResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from bson import ObjectId
from pymongo import ReturnDocument
import logging
import uuid
import asyncio
import random
import math
import hmac
import hashlib
import secrets
import jwt
import bcrypt
import httpx
import re
import ipaddress
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse
from types import SimpleNamespace

# ----------------------------------------------------------------------------
# DB
# ----------------------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_ALGORITHM = "HS256"


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email,
               "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "access"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

# ----------------------------------------------------------------------------
# App
# ----------------------------------------------------------------------------
app = FastAPI()
api_router = APIRouter(prefix="/api")
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("apexodds")

STARTING_BALANCES = {"BTC": 0.0, "ETH": 0.0, "USDT": 0.0, "SOL": 0.0}
COIN_USD = {"BTC": 64000.0, "ETH": 3400.0, "USDT": 1.0, "SOL": 150.0}
COIN_NETWORK = {"BTC": "BTC", "ETH": "ERC20", "USDT": "ERC20", "SOL": "SOL"}

# ----------------------------------------------------------------------------
# Models
# ----------------------------------------------------------------------------
class RegisterInput(BaseModel):
    name: str
    email: EmailStr
    password: str = Field(min_length=6)
    ref_code: Optional[str] = Field(default=None, max_length=24)


class AffCodeInput(BaseModel):
    code: str = Field(min_length=4, max_length=16, pattern=r"^[A-Za-z0-9_-]+$")


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class WalletTxInput(BaseModel):
    coin: str
    amount: float


class WithdrawInput(BaseModel):
    coin: str
    amount: float
    address: str
    memo: Optional[str] = None


class PaymentConfigInput(BaseModel):
    provider: str
    api_base: str = ""
    api_key: str = ""
    mode: str = "mock"   # mock | live


class Selection(BaseModel):
    event_id: str
    league: str
    league_label: str
    home: str
    away: str
    market: str
    pick: str
    side: str
    line: Optional[float] = None
    odds: float


class PlaceBetInput(BaseModel):
    selections: List[Selection] = Field(min_length=1, max_length=20)
    stake: float = Field(gt=0, allow_inf_nan=False)
    coin: str
    bet_type: str = "single"
    accept_better: bool = True
    boost_id: Optional[str] = None


# ----------------------------------------------------------------------------
# Auth helpers
# ----------------------------------------------------------------------------
async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        if user.get("blocked"):
            raise HTTPException(status_code=403, detail="Account locked. Contact support.")
        user["id"] = str(user.pop("_id"))
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def set_auth_cookie(response: Response, token: str):
    response.set_cookie(key="access_token", value=token, httponly=True,
                        secure=True, samesite="none", max_age=604800, path="/")


async def ensure_wallet(user_id: str):
    existing = await db.wallets.find_one({"user_id": user_id})
    if not existing:
        await db.wallets.insert_one({"user_id": user_id, "balances": dict(STARTING_BALANCES)})


async def user_public(user: dict) -> dict:
    wallet = await db.wallets.find_one({"user_id": user["id"]}, {"_id": 0})
    return {"id": user["id"], "name": user.get("name"), "email": user["email"],
            "role": user.get("role", "user"), "balances": wallet["balances"] if wallet else {}}


async def get_admin_user(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ----------------------------------------------------------------------------
# Auth routes
# ----------------------------------------------------------------------------
@api_router.post("/auth/register")
async def register(body: RegisterInput, response: Response):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    referrer = None
    if body.ref_code and body.ref_code.strip():
        referrer = await db.affiliates.find_one({"code": body.ref_code.strip().upper()})
        if not referrer:
            raise HTTPException(status_code=400, detail="Invalid referral code")
    doc = {"name": body.name, "email": email, "password_hash": hash_password(body.password),
           "role": "user", "created_at": now_iso()}
    if referrer:
        doc["referred_by"] = referrer["user_id"]
    res = await db.users.insert_one(doc)
    uid = str(res.inserted_id)
    await ensure_wallet(uid)
    set_auth_cookie(response, create_access_token(uid, email))
    user = {"id": uid, "name": body.name, "email": email, "role": "user"}
    return await user_public(user)


@api_router.post("/auth/login")
async def login(body: LoginInput, response: Response):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.get("blocked"):
        raise HTTPException(status_code=403, detail="Account locked. Contact support.")
    uid = str(user["_id"])
    await ensure_wallet(uid)
    set_auth_cookie(response, create_access_token(uid, email))
    return await user_public({"id": uid, "name": user.get("name"), "email": email,
                              "role": user.get("role", "user")})


@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    await ensure_wallet(user["id"])
    return await user_public(user)


# ----------------------------------------------------------------------------
# Sports odds (SportsGameOdds API)
# ----------------------------------------------------------------------------
SGO_KEY = os.environ.get("SPORTSGAMEODDS_API_KEY")
SGO_API = "https://api.sportsgameodds.com/v2"

SGO_LEAGUES = [
    {"id": "NFL", "group": "football", "label": "NFL", "draw": False},
    {"id": "NCAAF", "group": "football", "label": "NCAA Football", "draw": False},
    {"id": "NBA", "group": "basketball", "label": "NBA", "draw": False},
    {"id": "NCAAB", "group": "basketball", "label": "NCAA Basketball", "draw": False},
    {"id": "MLB", "group": "baseball", "label": "MLB", "draw": False},
    {"id": "NHL", "group": "hockey", "label": "NHL", "draw": False},
    {"id": "EPL", "group": "soccer", "label": "Premier League", "draw": True},
    {"id": "LA_LIGA", "group": "soccer", "label": "La Liga", "draw": True},
    {"id": "UEFA_CHAMPIONS_LEAGUE", "group": "soccer", "label": "Champions League", "draw": True},
    {"id": "BUNDESLIGA", "group": "soccer", "label": "Bundesliga", "draw": True},
    {"id": "IT_SERIE_A", "group": "soccer", "label": "Serie A", "draw": True},
    {"id": "FR_LIGUE_1", "group": "soccer", "label": "Ligue 1", "draw": True},
    {"id": "MLS", "group": "soccer", "label": "MLS", "draw": True},
    {"id": "UFC", "group": "mma", "label": "UFC", "draw": False},
]
GROUPS = [
    {"key": "soccer", "label": "Soccer", "icon": "goal"},
    {"key": "basketball", "label": "Basketball", "icon": "dribbble"},
    {"key": "football", "label": "Am. Football", "icon": "shield"},
    {"key": "baseball", "label": "Baseball", "icon": "circle-dot"},
    {"key": "hockey", "label": "Ice Hockey", "icon": "snowflake"},
    {"key": "mma", "label": "MMA", "icon": "swords"},
]
_SGO_CACHE = {}


def american_to_decimal(ml):
    try:
        v = float(str(ml).strip())
    except (TypeError, ValueError):
        return None
    if v == 0:
        return None
    return round(1 + (v / 100.0 if v > 0 else 100.0 / abs(v)), 2)


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _sgo_score(ev, side):
    res = ev.get("results") or {}
    for container in (res.get("game"), res):
        if isinstance(container, dict):
            node = container.get(side)
            if isinstance(node, dict):
                v = node.get("points", node.get("score"))
                try:
                    return int(float(v))
                except (TypeError, ValueError):
                    pass
    return None


def _sgo_abbr(team):
    n = team.get("names", {}) or {}
    if str(team.get("teamID", "")).endswith("_UFC") and n.get("lastName"):
        return n["lastName"]
    return n.get("short") or n.get("medium") or n.get("long") or team.get("teamID", "TBD")


def _sgo_long(team):
    n = team.get("names", {}) or {}
    return n.get("long") or n.get("medium") or _sgo_abbr(team)


ESPN_LOGO_SPORT = {"NFL": "nfl", "NBA": "nba", "MLB": "mlb", "NHL": "nhl"}


def _team_logo(league_id, abbr):
    slug = ESPN_LOGO_SPORT.get(league_id)
    if not slug or not abbr:
        return ""
    return f"https://a.espncdn.com/i/teamlogos/{slug}/500/{abbr.lower()}.png"


STAT_LABELS = {
    "points": "Points", "assists": "Assists", "rebounds": "Rebounds", "steals": "Steals",
    "blocks": "Blocks", "threePointersMade": "3PT Made", "receptions": "Receptions",
    "passing_yards": "Pass Yds", "rushing_yards": "Rush Yds", "receiving_yards": "Rec Yds",
    "passing_touchdowns": "Pass TDs", "touchdowns": "TDs", "goals": "Goals",
    "shots": "Shots", "shots_on_goal": "Shots on Goal", "saves": "Saves",
    "hits": "Hits", "strikeouts": "Strikeouts",
}


def _sgo_props(ev):
    odds = ev.get("odds", {}) or {}
    players = ev.get("players", {}) or {}
    groups = {}
    for o in odds.values():
        if not isinstance(o, dict):
            continue
        if o.get("betTypeID") != "ou" or o.get("periodID") != "game":
            continue
        ent = o.get("statEntityID")
        if ent in ("home", "away", "all") or not ent:
            continue
        side = o.get("sideID")
        if side not in ("over", "under"):
            continue
        dec = american_to_decimal(o.get("bookOdds"))
        line = _num(o.get("bookOverUnder"))
        if dec is None or line is None:
            continue
        g = groups.setdefault((ent, o.get("statID")), {"player_id": ent, "stat": o.get("statID")})
        g[side] = dec
        g["line"] = line
    out = []
    for (ent, statID), g in groups.items():
        if "over" not in g and "under" not in g:
            continue
        p = players.get(ent, {})
        name = p.get("name") or p.get("nickname") or ent.replace("_", " ").title()
        out.append({"player": name, "player_id": ent, "stat": statID,
                    "label": STAT_LABELS.get(statID, re.sub(r"(?<=[a-z])(?=[A-Z])", " ", (statID or "").replace("_", " ")).title()),
                    "line": g.get("line"), "over": g.get("over"), "under": g.get("under")})
    out.sort(key=lambda x: (x["player"], x["label"]))
    return out[:24]


def _sgo_markets(ev, draw):
    odds = ev.get("odds", {})
    ha = _sgo_abbr(ev["teams"]["home"])
    aa = _sgo_abbr(ev["teams"]["away"])
    markets = []
    if draw:
        pairs = [("home", f"{ha} ML", odds.get("points-home-reg-ml3way-home")),
                 ("draw", "Draw", odds.get("points-all-reg-ml3way-draw")),
                 ("away", f"{aa} ML", odds.get("points-away-reg-ml3way-away"))]
    else:
        pairs = [("home", f"{ha} ML", odds.get("points-home-game-ml-home")),
                 ("away", f"{aa} ML", odds.get("points-away-game-ml-away"))]
    ml = []
    for side, pick, o in pairs:
        dec = american_to_decimal(o.get("bookOdds")) if o else None
        if dec:
            ml.append({"side": side, "pick": pick, "odds": dec, "line": None})
    if len(ml) >= 2:
        markets.append({"market": "moneyline", "label": "Moneyline", "selections": ml})

    hs, as_ = odds.get("points-home-game-sp-home"), odds.get("points-away-game-sp-away")
    if hs and as_:
        hl, al = _num(hs.get("bookSpread")), _num(as_.get("bookSpread"))
        ho, ao = american_to_decimal(hs.get("bookOdds")), american_to_decimal(as_.get("bookOdds"))
        if None not in (hl, al, ho, ao):
            markets.append({"market": "spread", "label": "Spread", "selections": [
                {"side": "home", "pick": f"{ha} {hl:+g}", "odds": ho, "line": hl},
                {"side": "away", "pick": f"{aa} {al:+g}", "odds": ao, "line": al}]})

    ov, un = odds.get("points-all-game-ou-over"), odds.get("points-all-game-ou-under")
    if ov and un:
        line = _num(ov.get("bookOverUnder"))
        oo, uo = american_to_decimal(ov.get("bookOdds")), american_to_decimal(un.get("bookOdds"))
        if None not in (line, oo, uo):
            markets.append({"market": "total", "label": "Total", "selections": [
                {"side": "over", "pick": f"Over {line}", "odds": oo, "line": line},
                {"side": "under", "pick": f"Under {line}", "odds": uo, "line": line}]})
    ro, ru = odds.get("roundsCompleted-all-game-ou-over"), odds.get("roundsCompleted-all-game-ou-under")
    if ro and ru:
        line = _num(ro.get("bookOverUnder"))
        oo, uo = american_to_decimal(ro.get("bookOdds")), american_to_decimal(ru.get("bookOdds"))
        if None not in (line, oo, uo):
            markets.append({"market": "rounds", "label": "Total Rounds", "selections": [
                {"side": "over", "pick": f"Over {line} rounds", "label": f"O {line}", "odds": oo, "line": line},
                {"side": "under", "pick": f"Under {line} rounds", "label": f"U {line}", "odds": uo, "line": line}]})
    dy, dn = odds.get("wonBy_decision-all-game-yn-yes"), odds.get("wonBy_decision-all-game-yn-no")
    if dy and dn:
        yo, no = american_to_decimal(dy.get("bookOdds")), american_to_decimal(dn.get("bookOdds"))
        if None not in (yo, no):
            markets.append({"market": "distance", "label": "Goes the Distance", "selections": [
                {"side": "yes", "pick": "Fight goes the distance", "label": "Yes", "odds": yo, "line": None},
                {"side": "no", "pick": "Fight doesn't go the distance", "label": "No", "odds": no, "line": None}]})
    return markets


def _sgo_player_results(ev):
    """Final per-player stat values for settling props, keyed 'player_id:stat'.
    SGO attaches a `score` to each market once finished; results.game also holds
    entity stats. Best-effort — missing values leave a leg unsettled."""
    out = {}
    for o in (ev.get("odds", {}) or {}).values():
        if not isinstance(o, dict) or o.get("periodID") != "game":
            continue
        ent = o.get("statEntityID")
        if ent in ("home", "away", "all") or not ent:
            continue
        val = _num(o.get("score"))
        if val is not None:
            out[f"{ent}:{o.get('statID')}"] = val
    game = (ev.get("results") or {}).get("game") or {}
    if isinstance(game, dict):
        for ent, stats in game.items():
            if isinstance(stats, dict):
                for stat, v in stats.items():
                    val = _num(v)
                    if val is not None:
                        out.setdefault(f"{ent}:{stat}", val)
    return out


_ESPN_UFC_CACHE = {}
ESPN_UFC_SB = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard"


def _norm_name(s):
    return re.sub(r"[^a-z]", "", (s or "").lower())


async def _espn_ufc_card(date_str):
    cached = _ESPN_UFC_CACHE.get(date_str)
    if cached and datetime.now(timezone.utc).timestamp() - cached["ts"] < 3600:
        return cached["data"]
    fighters = {}
    try:
        async with httpx.AsyncClient(timeout=10) as hc:
            r = await hc.get(ESPN_UFC_SB, params={"dates": date_str})
        for e in (r.json().get("events") or []):
            comps = e.get("competitions") or []
            for idx, c in enumerate(comps):
                for p in c.get("competitors") or []:
                    a = p.get("athlete") or {}
                    rec = next((x.get("summary") for x in p.get("records") or [] if x.get("type") == "total"), None)
                    fighters[_norm_name(a.get("displayName") or a.get("fullName"))] = {
                        "photo": f"https://a.espncdn.com/i/headshots/mma/players/full/{p.get('id')}.png" if p.get("id") else "",
                        "name": a.get("displayName"), "record": rec, "flag": (a.get("flag") or {}).get("href", ""),
                        "country": (a.get("flag") or {}).get("alt", ""),
                        "card_name": e.get("name"), "weight_class": (c.get("type") or {}).get("abbreviation"),
                        "bout_order": idx, "main_event": idx == len(comps) - 1,
                    }
    except Exception as ex:
        logger.warning(f"ESPN UFC fetch failed {date_str}: {ex}")
        _ESPN_UFC_CACHE[date_str] = {"ts": datetime.now(timezone.utc).timestamp() - 3300, "data": {}}
        return {}
    _ESPN_UFC_CACHE[date_str] = {"ts": datetime.now(timezone.utc).timestamp(), "data": fighters}
    return fighters


async def _enrich_ufc(events):
    dates = set()
    for ev in events:
        try:
            d = datetime.fromisoformat(ev["start"].replace("Z", "+00:00"))
        except Exception:
            continue
        for off in (-1, 0, 1):
            dates.add((d + timedelta(days=off)).strftime("%Y%m%d"))
    cards = await asyncio.gather(*[_espn_ufc_card(d) for d in sorted(dates)])
    lookup = {}
    for c in cards:
        lookup.update(c)
    for ev in events:
        info = {}
        for side in ("home", "away"):
            f = lookup.get(_norm_name(ev[side]["name"]))
            if f:
                ev[side].update({k: f[k] for k in ("photo", "record", "flag", "country")})
                if f.get("name"):
                    ev[side]["name"] = f["name"]
                info = f
        if info:
            ev.update({"card_name": info["card_name"], "weight_class": info["weight_class"],
                       "bout_order": info["bout_order"], "main_event": info["main_event"]})


_SGO_REFRESHING = set()


async def fetch_sgo_league(meta, max_age=None):
    """Stale-while-revalidate: return last odds instantly, refresh in the background once expired."""
    if not SGO_KEY:
        return []
    key = meta["id"]
    cached = _SGO_CACHE.get(key)
    if not cached:
        doc = await db.odds_cache.find_one({"_id": key})
        if doc:
            cached = _SGO_CACHE[key] = {"ts": doc["ts"], "ttl": doc["ttl"], "data": doc["data"]}
    if not cached:
        return await _refresh_sgo_league(meta)
    age = datetime.now(timezone.utc).timestamp() - cached["ts"]
    if age < cached["ttl"]:
        return cached["data"]
    if max_age is not None and age > max_age:
        return await _refresh_sgo_league(meta)
    if key not in _SGO_REFRESHING:
        _SGO_REFRESHING.add(key)
        asyncio.create_task(_refresh_sgo_league(meta))
    return cached["data"]


async def _refresh_sgo_league(meta):
    key = meta["id"]
    try:
        return await _do_refresh_sgo_league(meta)
    finally:
        _SGO_REFRESHING.discard(key)


async def _do_refresh_sgo_league(meta):
    key = meta["id"]
    prev = (_SGO_CACHE.get(key) or {}).get("data") or []
    params = {"apiKey": SGO_KEY, "leagueID": key, "oddsAvailable": "true", "limit": 15}
    events = []
    ttl = 300
    try:
        async with httpx.AsyncClient(timeout=15) as hc:
            r = await hc.get(f"{SGO_API}/events", params=params)
        if r.status_code != 200:
            logger.warning(f"SGO {key} -> {r.status_code}")
            _SGO_CACHE[key] = {"ts": datetime.now(timezone.utc).timestamp(), "ttl": 30, "data": prev}
            return prev
        for ev in (r.json().get("data") or [])[:15]:
            teams = ev.get("teams") or {}
            home, away = teams.get("home"), teams.get("away")
            if not home or not away:
                continue
            try:
                markets = _sgo_markets(ev, meta["draw"])
            except Exception:
                continue
            if not markets:
                continue
            st = ev.get("status", {})
            state = "in" if st.get("live") else "post" if (st.get("completed") or st.get("ended")) else "pre"
            ha, aa = _sgo_abbr(home), _sgo_abbr(away)
            events.append({
                "event_id": ev["eventID"], "league": meta["group"], "league_key": key,
                "league_label": meta["label"], "name": f"{aa} @ {ha}",
                "start": st.get("startsAt"), "state": state,
                "status_detail": st.get("displayLong") or ("Live" if state == "in" else "Upcoming"),
                "home": {"name": _sgo_long(home), "abbr": ha, "logo": _team_logo(meta["id"], ha), "score": _sgo_score(ev, "home")},
                "away": {"name": _sgo_long(away), "abbr": aa, "logo": _team_logo(meta["id"], aa), "score": _sgo_score(ev, "away")},
                "markets": markets, "source": "sportsgameodds", "book": "Top books",
                "props": _sgo_props(ev),
                "player_results": _sgo_player_results(ev) if state in ("in", "post") else {},
                "rounds": sum(1 for k in (ev.get("results") or {}) if re.fullmatch(r"\d+r", k)) or None,
            })
    except Exception as e:
        logger.warning(f"SGO fetch failed for {key}: {e}")
        _SGO_CACHE[key] = {"ts": datetime.now(timezone.utc).timestamp(), "ttl": 30, "data": prev}
        return prev
    if key == "UFC" and events:
        await _enrich_ufc(events)
        if not any(e.get("card_name") for e in events):
            ttl = 60
    entry = {"ts": datetime.now(timezone.utc).timestamp(), "ttl": ttl, "data": events}
    _SGO_CACHE[key] = entry
    try:
        await db.odds_cache.replace_one({"_id": key}, dict(entry), upsert=True)
    except Exception as e:
        logger.warning(f"odds cache persist failed {key}: {e}")
    return events


async def _fetch_sgo_sequential(metas):
    out = []
    for m in metas:
        out.extend(await fetch_sgo_league(m))
    return out


@api_router.get("/sports")
async def list_sports():
    return [{**g, "leagues": [{"key": m["id"], "label": m["label"]} for m in SGO_LEAGUES if m["group"] == g["key"]]}
            for g in GROUPS]


@api_router.get("/odds")
async def get_odds(league: Optional[str] = None, league_key: Optional[str] = None):
    if league_key:
        metas = [m for m in SGO_LEAGUES if m["id"] == league_key]
        if not metas:
            raise HTTPException(404, "Unknown league")
    else:
        metas = [m for m in SGO_LEAGUES if m["group"] == league] if league else SGO_LEAGUES
    out = await _fetch_sgo_sequential(metas)
    _kick_auto_cashouts()
    out.sort(key=lambda e: (0 if e["state"] == "in" else 1 if e["state"] == "pre" else 2, e.get("start") or ""))
    return {"events": out}


# ----------------------------------------------------------------------------
# Wallet
# ----------------------------------------------------------------------------
@api_router.get("/payment/config")
async def get_payment_config():
    cfg = await db.payment_config.find_one({"_id": "default"}, {"_id": 0})
    if not cfg:
        cfg = {"provider": "Simulated Gateway", "api_base": "", "api_key": "", "mode": "mock"}
    if cfg.get("api_key"):
        cfg["api_key"] = "••••" + cfg["api_key"][-4:]
    return cfg


@api_router.put("/payment/config")
async def set_payment_config(body: PaymentConfigInput, user: dict = Depends(get_current_user)):
    await db.payment_config.update_one({"_id": "default"},
                                       {"$set": body.model_dump()}, upsert=True)
    return {"ok": True}


@api_router.get("/wallet")
async def get_wallet(user: dict = Depends(get_current_user)):
    await ensure_wallet(user["id"])
    wallet = await db.wallets.find_one({"user_id": user["id"]}, {"_id": 0})
    txs = await db.transactions.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    wds = await db.withdrawals.find({"user_id": user["id"]}, {"_id": 0}).to_list(300)
    wmap = {w["id"]: w for w in wds}
    for t in txs:
        h = t.get("hash", "")
        if h.startswith("withdraw:"):
            w = wmap.get(h.split(":", 1)[1])
            if w:
                t["payout"] = {"track_id": w.get("track_id"), "status": w.get("status"),
                               "tx_hash": w.get("tx_hash"), "refunded": w.get("refunded", False),
                               "network": w.get("network"), "address": w.get("address")}
    return {"balances": wallet["balances"], "usd_rates": await get_live_rates(), "transactions": txs}


_PRICE_CACHE = {"ts": 0.0, "rates": dict(COIN_USD), "live": False}
_CG_IDS = {"bitcoin": "BTC", "ethereum": "ETH", "tether": "USDT", "solana": "SOL"}


async def get_live_rates() -> dict:
    now = datetime.now(timezone.utc).timestamp()
    if now - _PRICE_CACHE["ts"] < 60:
        return _PRICE_CACHE["rates"]
    _PRICE_CACHE["ts"] = now
    try:
        async with httpx.AsyncClient(timeout=8) as hc:
            r = await hc.get("https://api.coingecko.com/api/v3/simple/price",
                             params={"ids": ",".join(_CG_IDS), "vs_currencies": "usd"})
        r.raise_for_status()
        data = r.json()
        rates = {coin: float(data[cid]["usd"]) for cid, coin in _CG_IDS.items() if cid in data}
        if len(rates) == len(_CG_IDS):
            _PRICE_CACHE.update(rates=rates, live=True)
    except Exception as e:
        logger.warning(f"price fetch failed: {e}")
    return _PRICE_CACHE["rates"]


@api_router.get("/prices")
async def get_prices():
    rates = await get_live_rates()
    return {"rates": rates, "live": _PRICE_CACHE["live"],
            "updated_at": datetime.fromtimestamp(_PRICE_CACHE["ts"], timezone.utc).isoformat()}


# ----------------------------------------------------------------------------
# Email alerts (Emergent managed, via Resend)
# ----------------------------------------------------------------------------
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "ApexOdds")
ADMIN_ALERT_EMAIL = os.environ.get("ADMIN_ALERT_EMAIL")

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan(); scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} != real link host {real!r} (G3)")


async def send_email(*, to: str, subject: str, html: str) -> Optional[str]:
    _assert_safe_email(subject, html)
    if not EMAIL_KEY:
        logger.warning("Email not configured — skipping send")
        return None
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    async with httpx.AsyncClient(timeout=30) as hc:
        resp = await hc.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                             headers={"X-Email-Key": EMAIL_KEY}, json=payload)
    resp.raise_for_status()
    return resp.json().get("id")


async def send_withdrawal_alert(wid: str):
    """Fire-and-forget email to the admin when a withdrawal is awaiting approval."""
    try:
        if not ADMIN_ALERT_EMAIL:
            return
        w = await db.withdrawals.find_one({"id": wid}, {"_id": 0})
        if not w:
            return
        origin = os.environ.get("FRONTEND_URL", "").rstrip("/")
        btn = ""
        if origin.startswith("https://"):
            btn = (f'<tr><td style="padding:8px 0 4px"><a href="{escape(origin)}" '
                   f'style="display:inline-block;background:#10b981;color:#000;font-weight:bold;'
                   f'text-decoration:none;padding:10px 20px;border-radius:8px">Review in the Admin panel</a></td></tr>')
        subject = f"New withdrawal awaiting approval — {w['amount']} {w['coin']}"
        html = (
            f'<table role="presentation" width="100%" style="max-width:520px;margin:0 auto;'
            f'font-family:Arial,sans-serif;color:#111"><tr><td style="padding:24px">'
            f'<p style="font-size:12px;letter-spacing:2px;color:#10b981;margin:0 0 4px">APEXODDS · ADMIN</p>'
            f'<h2 style="margin:0 0 16px">A withdrawal needs your approval</h2>'
            f'<table role="presentation" width="100%" style="border:1px solid #e5e7eb;border-radius:10px">'
            f'<tr><td style="padding:14px 16px">'
            f'<p style="margin:0 0 6px"><strong>Player:</strong> {escape(w.get("user_email", ""))}</p>'
            f'<p style="margin:0 0 6px;font-size:20px;font-weight:bold;color:#059669">'
            f'{escape(str(w["amount"]))} {escape(w["coin"])} '
            f'<span style="font-size:12px;color:#6b7280;font-weight:normal">· {escape(str(w.get("network", "")))}</span></p>'
            f'<p style="margin:0;font-family:monospace;font-size:12px;color:#374151;word-break:break-all">'
            f'{escape(w.get("address", ""))}</p>'
            f'</td></tr></table>'
            f'<table role="presentation" style="margin-top:16px">{btn}</table>'
            f'<p style="font-size:12px;color:#888;margin-top:20px">The amount is already held from the player\'s balance '
            f'and nothing is sent until you approve it. Sent by {escape(EMAIL_FROM_NAME)}. '
            f'We never ask for your password or card details by email.</p>'
            f'</td></tr></table>')
        await send_email(to=ADMIN_ALERT_EMAIL, subject=subject, html=html)
        logger.info(f"Withdrawal alert emailed for {wid}")
    except Exception as e:
        logger.warning(f"Withdrawal alert email failed: {e}")


@api_router.post("/wallet/withdraw")
async def withdraw(body: WithdrawInput, user: dict = Depends(get_current_user)):
    await ensure_wallet(user["id"])
    wallet = await db.wallets.find_one({"user_id": user["id"]})
    if body.coin not in STARTING_BALANCES or body.amount <= 0:
        raise HTTPException(status_code=400, detail="Invalid withdrawal")
    address = (body.address or "").strip()
    if len(address) < 10:
        raise HTTPException(status_code=400, detail="Enter a valid wallet address")
    if wallet["balances"].get(body.coin, 0) < body.amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")

    # Reserve funds and queue for admin approval — no crypto is sent until approved.
    await db.wallets.update_one({"user_id": user["id"]},
                                {"$inc": {f"balances.{body.coin}": -body.amount}})
    wid = str(uuid.uuid4())
    await db.withdrawals.insert_one({
        "id": wid, "user_id": user["id"], "user_email": user["email"], "user_name": user.get("name"),
        "coin": body.coin, "amount": body.amount, "address": address, "memo": body.memo or "",
        "network": COIN_NETWORK.get(body.coin), "status": "pending_approval", "track_id": None,
        "tx_hash": None, "refunded": False, "created_at": now_iso()})
    await db.transactions.insert_one({
        "id": str(uuid.uuid4()), "user_id": user["id"], "type": "withdraw",
        "coin": body.coin, "amount": body.amount, "created_at": now_iso(),
        "hash": "withdraw:" + wid})
    asyncio.create_task(send_withdrawal_alert(wid))
    wallet = await db.wallets.find_one({"user_id": user["id"]}, {"_id": 0})
    return {"balances": wallet["balances"], "withdrawal_id": wid, "status": "pending_approval"}


# ----------------------------------------------------------------------------
# OxaPay — real crypto deposits
# ----------------------------------------------------------------------------
OXAPAY_KEY = os.environ.get("OXAPAY_MERCHANT_API_KEY")
OXAPAY_PAYOUT_KEY = os.environ.get("OXAPAY_PAYOUT_API_KEY")
OXAPAY_API = "https://api.oxapay.com/v1"


async def _credit_oxa_invoice(track_id, status):
    """Idempotently credit a paid OxaPay invoice. Returns True if credited now."""
    if str(status).lower() != "paid":
        await db.oxa_invoices.update_one({"track_id": track_id}, {"$set": {"status": status}})
        return False
    inv = await db.oxa_invoices.find_one_and_update(
        {"track_id": track_id, "credited": {"$ne": True}},
        {"$set": {"credited": True, "status": "paid", "credited_at": now_iso()}})
    if not inv:
        return False
    await _adjust(inv["user_id"], inv["coin"], inv["amount"])
    await db.transactions.insert_one({
        "id": str(uuid.uuid4()), "user_id": inv["user_id"], "type": "deposit",
        "coin": inv["coin"], "amount": inv["amount"], "created_at": now_iso(),
        "hash": "oxapay:" + str(track_id)})
    return True


@api_router.post("/wallet/oxapay/invoice")
async def oxapay_invoice(body: WalletTxInput, user: dict = Depends(get_current_user)):
    if not OXAPAY_KEY:
        raise HTTPException(status_code=503, detail="Payment gateway not configured")
    if body.coin not in STARTING_BALANCES or body.amount <= 0:
        raise HTTPException(status_code=400, detail="Invalid amount")
    await ensure_wallet(user["id"])
    order_id = f"{user['id']}:{uuid.uuid4().hex[:12]}"
    base = os.environ.get("FRONTEND_URL", "")
    payload = {
        "amount": body.amount, "currency": "USD", "pay_currency": body.coin,
        "network": COIN_NETWORK.get(body.coin), "lifetime": 120, "fee_paid_by_payer": 0,
        "under_paid_coverage": 2.5,
        "callback_url": f"{base}/api/oxapay/webhook",
        "order_id": order_id, "description": f"ApexOdds deposit (${body.amount} in {body.coin})",
    }
    try:
        async with httpx.AsyncClient(timeout=20) as hc:
            r = await hc.post(f"{OXAPAY_API}/payment/white-label", json=payload,
                              headers={"merchant_api_key": OXAPAY_KEY, "Content-Type": "application/json"})
        result = r.json()
    except Exception as e:
        logger.warning(f"OxaPay white-label error: {e}")
        raise HTTPException(status_code=502, detail="Payment gateway unreachable")
    if r.status_code >= 400 or result.get("status") != 200:
        logger.warning(f"OxaPay white-label rejected: {r.status_code} {result}")
        raise HTTPException(status_code=502, detail=(result.get("message") or "Gateway error creating deposit"))
    data = result["data"]
    pay_amount = float(data.get("pay_amount") or body.amount)
    await db.oxa_invoices.insert_one({
        "order_id": order_id, "user_id": user["id"], "coin": body.coin, "amount": pay_amount,
        "status": "waiting", "credited": False, "track_id": str(data["track_id"]),
        "address": data.get("address"), "network": data.get("network"),
        "memo": data.get("memo") or "", "qr_code": data.get("qr_code"),
        "pay_amount": pay_amount, "pay_currency": (data.get("pay_currency") or body.coin).upper(),
        "expired_at": data.get("expired_at"), "created_at": now_iso()})
    return {"order_id": order_id, "track_id": str(data["track_id"]),
            "address": data.get("address"), "network": data.get("network"),
            "memo": data.get("memo") or "", "qr_code": data.get("qr_code"),
            "pay_amount": pay_amount, "pay_currency": (data.get("pay_currency") or body.coin).upper(),
            "expired_at": data.get("expired_at")}


@api_router.get("/wallet/oxapay/status/{track_id}")
async def oxapay_status(track_id: str, user: dict = Depends(get_current_user)):
    inv = await db.oxa_invoices.find_one({"track_id": track_id, "user_id": user["id"]})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    status = inv.get("status", "pending")
    if not inv.get("credited") and OXAPAY_KEY:
        try:
            async with httpx.AsyncClient(timeout=15) as hc:
                r = await hc.get(f"{OXAPAY_API}/payment/{track_id}",
                                 headers={"merchant_api_key": OXAPAY_KEY})
            data = r.json().get("data", {})
            status = data.get("status", status)
            await _credit_oxa_invoice(track_id, status)
        except Exception as e:
            logger.warning(f"OxaPay status poll error: {e}")
    inv = await db.oxa_invoices.find_one({"track_id": track_id}, {"_id": 0})
    wallet = await db.wallets.find_one({"user_id": user["id"]}, {"_id": 0})
    return {"status": inv.get("status"), "credited": inv.get("credited", False),
            "balances": wallet["balances"] if wallet else {}}


@api_router.post("/oxapay/webhook", response_class=PlainTextResponse)
async def oxapay_webhook(request: Request):
    raw = await request.body()
    received = request.headers.get("HMAC", "")
    if OXAPAY_KEY:
        expected = hmac.new(OXAPAY_KEY.encode(), raw, hashlib.sha512).hexdigest()
        if not hmac.compare_digest(expected, received.strip()):
            raise HTTPException(status_code=401, detail="invalid signature")
    try:
        event = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid JSON")
    track_id = event.get("track_id")
    if track_id and str(event.get("type", "")).lower() == "static_address":
        sa = await db.static_addresses.find_one({"track_id": str(track_id)})
        if sa:
            await _credit_static_txs(sa, event.get("txs") or [])
    elif track_id:
        await _credit_oxa_invoice(str(track_id), event.get("status", ""))
    return "ok"


async def _credit_static_txs(sa, txs) -> float:
    """Credit each confirmed on-chain tx to a static address exactly once. Returns total credited."""
    from pymongo.errors import DuplicateKeyError
    total = 0.0
    for tx in txs:
        h = tx.get("tx_hash")
        amt = float(tx.get("sent_amount") or tx.get("received_amount") or 0)
        if not h or amt <= 0 or str(tx.get("status", "")).lower() != "confirmed":
            continue
        try:
            await db.static_deposits.insert_one({"tx_hash": h, "user_id": sa["user_id"], "coin": sa["coin"],
                                                 "net": sa.get("net"), "amount": amt, "track_id": sa["track_id"],
                                                 "notified": False, "created_at": now_iso()})
        except DuplicateKeyError:
            continue
        await _adjust(sa["user_id"], sa["coin"], amt)
        await db.transactions.insert_one({
            "id": str(uuid.uuid4()), "user_id": sa["user_id"], "type": "deposit",
            "coin": sa["coin"], "amount": amt, "created_at": now_iso(), "hash": "oxapay-static:" + h})
        total += amt
    return total


def _static_public(sa):
    return {k: sa.get(k) for k in ("coin", "address", "network", "memo", "qr_code", "track_id")}


@api_router.get("/wallet/deposit-address/{coin}")
async def get_deposit_address(coin: str, user: dict = Depends(get_current_user)):
    coin = coin.upper()
    if coin not in STARTING_BALANCES:
        raise HTTPException(status_code=400, detail="Unsupported coin")
    net = COIN_NETWORK.get(coin)
    sel = {"user_id": user["id"], "coin": coin, "net": net}
    sa = await db.static_addresses.find_one(sel)
    if sa:
        return _static_public(sa)
    if not OXAPAY_KEY:
        raise HTTPException(status_code=503, detail="Payment gateway not configured")
    await ensure_wallet(user["id"])
    base = os.environ.get("FRONTEND_URL", "")
    payload = {"network": COIN_NETWORK.get(coin), "auto_withdrawal": 0,
               "callback_url": f"{base}/api/oxapay/webhook", "email": user.get("email"),
               "order_id": f"static:{user['id']}:{coin}", "description": f"ApexOdds {coin} deposit address"}
    try:
        async with httpx.AsyncClient(timeout=20) as hc:
            r = await hc.post(f"{OXAPAY_API}/payment/static-address", json=payload,
                              headers={"merchant_api_key": OXAPAY_KEY, "Content-Type": "application/json"})
        result = r.json()
    except Exception as e:
        logger.warning(f"OxaPay static-address error: {e}")
        raise HTTPException(status_code=502, detail="Payment gateway unreachable")
    if r.status_code >= 400 or result.get("status") != 200:
        logger.warning(f"OxaPay static-address rejected: {r.status_code} {result}")
        raise HTTPException(status_code=502, detail=(result.get("message") or "Gateway error creating address"))
    d = result["data"]
    sa = {"user_id": user["id"], "coin": coin, "net": net, "address": d.get("address"), "network": d.get("network"),
          "memo": d.get("memo") or "", "qr_code": d.get("qr_code"), "track_id": str(d.get("track_id")),
          "created_at": now_iso()}
    await db.static_addresses.update_one(sel, {"$setOnInsert": sa}, upsert=True)
    sa = await db.static_addresses.find_one(sel)
    return _static_public(sa)


class SharedLeg(BaseModel):
    event_id: str
    league: Optional[str] = None
    league_label: Optional[str] = None
    home: Optional[str] = None
    away: Optional[str] = None
    home_name: Optional[str] = None
    away_name: Optional[str] = None
    status_detail: Optional[str] = None
    market: str
    side: str
    pick: str
    line: Optional[float] = None
    odds: float


class SharedSlipInput(BaseModel):
    selections: List[SharedLeg] = Field(min_length=1, max_length=20)
    mode: str = "single"


@api_router.post("/slips")
async def create_shared_slip(body: SharedSlipInput, user: dict = Depends(get_current_user)):
    code = secrets.token_urlsafe(6).replace("-", "x").replace("_", "y")
    await db.shared_slips.insert_one({
        "code": code, "user_id": user["id"], "by": (user.get("name") or "A player")[:40],
        "mode": "parlay" if body.mode == "parlay" and len(body.selections) > 1 else "single",
        "selections": [l.model_dump() for l in body.selections], "created_at": now_iso()})
    return {"code": code}


@api_router.get("/slips/{code}")
async def get_shared_slip(code: str):
    slip = await db.shared_slips.find_one({"code": code}, {"_id": 0, "user_id": 0})
    if not slip:
        raise HTTPException(status_code=404, detail="Slip not found")
    return slip


_ALERT_SYNC = {}


async def _save_notification(user_id, kind, a, stage=None, key_id=None, created_at=None):
    from pymongo.errors import DuplicateKeyError
    key = (f"wd:{key_id}:{stage}" if kind == "withdrawal" else f"co:{key_id}" if kind == "cashout"
           else f"lb:{key_id}" if kind == "lossback" else f"dep:{a.get('tx_hash')}")
    try:
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()), "key": key, "user_id": user_id, "kind": kind, "stage": stage,
            "coin": a.get("coin"), "amount": a.get("amount"), "net": a.get("net") or a.get("network"),
            "tx_hash": a.get("tx_hash"), "read": False, "created_at": created_at or now_iso()})
    except DuplicateKeyError:
        pass


@api_router.get("/notifications")
async def list_notifications(user: dict = Depends(get_current_user)):
    items = await db.notifications.find({"user_id": user["id"]}, {"_id": 0, "key": 0}).sort("created_at", -1).to_list(50)
    unread = await db.notifications.count_documents({"user_id": user["id"], "read": False})
    return {"items": items, "unread": unread}


@api_router.post("/notifications/read-all")
async def read_all_notifications(user: dict = Depends(get_current_user)):
    await db.notifications.update_many({"user_id": user["id"], "read": False}, {"$set": {"read": True}})
    return {"ok": True}


def _wd_stage(w):
    s = (w.get("status") or "").lower()
    if w.get("refunded") or s in PAYOUT_FAILED:
        return "refunded"
    if s == "confirmed":
        return "confirmed"
    if s in ("pending_approval", "approving", ""):
        return None
    return "sent"


async def _withdrawal_alerts(user_id, sync):
    if sync and OXAPAY_PAYOUT_KEY:
        inflight = await db.withdrawals.find({"user_id": user_id, "track_id": {"$ne": None}, "refunded": {"$ne": True},
                                              "status": {"$nin": list(PAYOUT_TERMINAL)}}).to_list(20)
        async with httpx.AsyncClient(timeout=10) as hc:
            for wd in inflight:
                try:
                    r = await hc.get(f"{OXAPAY_API}/payout/{wd['track_id']}", headers={"payout_api_key": OXAPAY_PAYOUT_KEY})
                    data = r.json().get("data", {})
                    await _settle_withdrawal(wd["track_id"], data.get("status", wd.get("status")), data.get("tx_hash"))
                except Exception as e:
                    logger.warning(f"withdrawal alert sync error: {e}")
    out = []
    for w in await db.withdrawals.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(50):
        stage = _wd_stage(w)
        if stage and stage != w.get("notified_stage"):
            await db.withdrawals.update_one({"id": w["id"]}, {"$set": {"notified_stage": stage}})
            out.append({"id": w["id"], "stage": stage, "coin": w["coin"], "amount": w["amount"],
                        "net": w.get("network"), "tx_hash": w.get("tx_hash"), "address": w.get("address")})
    return out


@api_router.get("/wallet/deposit-alerts")
async def deposit_alerts(user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc).timestamp()
    sync = now - _ALERT_SYNC.get(user["id"], 0) >= 30
    if sync:
        _ALERT_SYNC[user["id"]] = now
    withdrawals = await _withdrawal_alerts(user["id"], sync)
    _kick_auto_cashouts()
    if sync:
        await auto_settle(user["id"])
    pending = await db.notifications.find({"user_id": user["id"], "kind": {"$in": ["cashout", "lossback"]},
                                           "alerted": {"$ne": True}}, {"_id": 0, "key": 0}).to_list(20)
    if pending:
        await db.notifications.update_many({"id": {"$in": [n["id"] for n in pending]}}, {"$set": {"alerted": True}})
    cashouts = [n for n in pending if n["kind"] == "cashout"]
    lossbacks = [n for n in pending if n["kind"] == "lossback"]
    if OXAPAY_KEY and sync:
        addrs = await db.static_addresses.find({"user_id": user["id"]}).to_list(20)
        async with httpx.AsyncClient(timeout=10) as hc:
            for sa in addrs:
                try:
                    r = await hc.get(f"{OXAPAY_API}/payment/{sa['track_id']}", headers={"merchant_api_key": OXAPAY_KEY})
                    await _credit_static_txs(sa, (r.json().get("data") or {}).get("txs") or [])
                except Exception as e:
                    logger.warning(f"deposit alert sync error: {e}")
    alerts = await db.static_deposits.find({"user_id": user["id"], "notified": False}, {"_id": 0}).to_list(20)
    if alerts:
        await db.static_deposits.update_many({"tx_hash": {"$in": [a["tx_hash"] for a in alerts]}},
                                             {"$set": {"notified": True}})
    for a in alerts:
        await _save_notification(user["id"], "deposit", a)
    for w in withdrawals:
        await _save_notification(user["id"], "withdrawal", w, stage=w["stage"], key_id=w["id"])
    wallet = await db.wallets.find_one({"user_id": user["id"]}, {"_id": 0})
    return {"alerts": [{k: a.get(k) for k in ("tx_hash", "coin", "net", "amount", "created_at")} for a in alerts],
            "withdrawals": withdrawals, "cashouts": cashouts, "lossbacks": lossbacks, "balances": (wallet or {}).get("balances")}


@api_router.post("/wallet/deposit-address/{coin}/check")
async def check_deposit_address(coin: str, user: dict = Depends(get_current_user)):
    coin = coin.upper()
    sa = await db.static_addresses.find_one({"user_id": user["id"], "coin": coin, "net": COIN_NETWORK.get(coin)})
    if not sa:
        raise HTTPException(status_code=404, detail="No deposit address yet")
    credited = 0.0
    try:
        async with httpx.AsyncClient(timeout=15) as hc:
            r = await hc.get(f"{OXAPAY_API}/payment/{sa['track_id']}", headers={"merchant_api_key": OXAPAY_KEY})
        credited = await _credit_static_txs(sa, (r.json().get("data") or {}).get("txs") or [])
    except Exception as e:
        logger.warning(f"OxaPay static check error: {e}")
    wallet = await db.wallets.find_one({"user_id": user["id"]}, {"_id": 0})
    return {"credited": credited, "balances": wallet["balances"]}


# ----------------------------------------------------------------------------
# OxaPay — real crypto payouts (withdrawals)
# ----------------------------------------------------------------------------
PAYOUT_FAILED = {"failed", "rejected", "canceled", "cancelled"}
PAYOUT_TERMINAL = PAYOUT_FAILED | {"confirmed"}


async def _do_refund(wd):
    """Credit a reserved withdrawal amount back to the user's wallet + ledger."""
    await _adjust(wd["user_id"], wd["coin"], wd["amount"])
    await db.transactions.insert_one({
        "id": str(uuid.uuid4()), "user_id": wd["user_id"], "type": "refund",
        "coin": wd["coin"], "amount": wd["amount"], "created_at": now_iso(),
        "hash": "withdraw-refund:" + wd["id"]})


async def _submit_payout(wd):
    """Send an approved withdrawal to OxaPay. Returns (ok, dict|error_message)."""
    payload = {
        "address": wd["address"], "currency": wd["coin"], "amount": wd["amount"],
        "network": wd.get("network"),
        "callback_url": f"{os.environ.get('FRONTEND_URL', '')}/api/oxapay/payout/webhook",
        "description": f"ApexOdds withdrawal ({wd['coin']})",
    }
    if wd.get("memo"):
        payload["memo"] = wd["memo"]
    try:
        async with httpx.AsyncClient(timeout=20) as hc:
            r = await hc.post(f"{OXAPAY_API}/payout", json=payload,
                              headers={"payout_api_key": OXAPAY_PAYOUT_KEY, "Content-Type": "application/json"})
        result = r.json()
    except Exception as e:
        logger.warning(f"OxaPay payout error: {e}")
        return False, "Payout gateway unreachable"
    data = result.get("data") or {}
    if r.status_code >= 400 or result.get("status") != 200 or not data.get("track_id"):
        logger.warning(f"OxaPay payout rejected: {r.status_code} {result}")
        return False, ((result.get("error") or {}).get("message") or result.get("message") or "Payout rejected")
    return True, {"track_id": str(data["track_id"]), "status": str(data.get("status", "processing")).lower()}


async def _settle_withdrawal(track_id: str, status: str, tx_hash=None):
    """Idempotently apply an OxaPay payout status to a withdrawal; refund on failure."""
    status = str(status).lower()
    base = {"status": status}
    if tx_hash:
        base["tx_hash"] = tx_hash
    if status in PAYOUT_FAILED:
        wd = await db.withdrawals.find_one_and_update(
            {"track_id": track_id, "refunded": {"$ne": True}},
            {"$set": {**base, "refunded": True, "refunded_at": now_iso()}})
        if wd:
            await _do_refund(wd)
    else:
        await db.withdrawals.update_one({"track_id": track_id}, {"$set": base})


# --- Admin withdrawal approval queue ---
@api_router.get("/admin/withdrawals")
async def admin_list_withdrawals(status: Optional[str] = None, admin: dict = Depends(get_admin_user)):
    q = {"status": status} if status else {}
    items = await db.withdrawals.find(q, {"_id": 0}).sort("created_at", -1).to_list(300)
    counts = {}
    for s in ["pending_approval", "processing", "confirming", "confirmed", "rejected", "failed"]:
        counts[s] = await db.withdrawals.count_documents({"status": s})
    return {"withdrawals": items, "counts": counts}


@api_router.post("/admin/withdrawals/{wid}/approve")
async def admin_approve_withdrawal(wid: str, admin: dict = Depends(get_admin_user)):
    if not OXAPAY_PAYOUT_KEY:
        raise HTTPException(status_code=503, detail="Payouts not configured — add an OxaPay payout key")
    wd = await db.withdrawals.find_one_and_update(
        {"id": wid, "status": "pending_approval"},
        {"$set": {"status": "approving", "decided_by": admin["email"], "decided_at": now_iso()}})
    if not wd:
        raise HTTPException(status_code=404, detail="Withdrawal not found or already decided")
    ok, res = await _submit_payout(wd)
    if not ok:
        await db.withdrawals.find_one_and_update(
            {"id": wid, "refunded": {"$ne": True}},
            {"$set": {"status": "failed", "refunded": True, "refunded_at": now_iso()}})
        await _do_refund(wd)
        raise HTTPException(status_code=502, detail=f"{res} — amount refunded to the player")
    await db.withdrawals.update_one({"id": wid},
                                    {"$set": {"track_id": res["track_id"], "status": res["status"]}})
    out = await db.withdrawals.find_one({"id": wid}, {"_id": 0})
    return out


@api_router.post("/admin/withdrawals/{wid}/reject")
async def admin_reject_withdrawal(wid: str, admin: dict = Depends(get_admin_user)):
    wd = await db.withdrawals.find_one_and_update(
        {"id": wid, "status": "pending_approval"},
        {"$set": {"status": "rejected", "refunded": True, "decided_by": admin["email"], "decided_at": now_iso()}})
    if not wd:
        raise HTTPException(status_code=404, detail="Withdrawal not found or already decided")
    await _do_refund(wd)
    out = await db.withdrawals.find_one({"id": wid}, {"_id": 0})
    return out


@api_router.get("/wallet/payout/status/{track_id}")
async def payout_status(track_id: str, user: dict = Depends(get_current_user)):
    wd = await db.withdrawals.find_one({"track_id": track_id, "user_id": user["id"]})
    if not wd:
        raise HTTPException(status_code=404, detail="Payout not found")
    if not wd.get("refunded") and (wd.get("status") or "") not in PAYOUT_TERMINAL and OXAPAY_PAYOUT_KEY:
        try:
            async with httpx.AsyncClient(timeout=15) as hc:
                r = await hc.get(f"{OXAPAY_API}/payout/{track_id}",
                                 headers={"payout_api_key": OXAPAY_PAYOUT_KEY})
            data = r.json().get("data", {})
            await _settle_withdrawal(track_id, data.get("status", wd.get("status")), data.get("tx_hash"))
        except Exception as e:
            logger.warning(f"OxaPay payout poll error: {e}")
    wd = await db.withdrawals.find_one({"track_id": track_id}, {"_id": 0})
    wallet = await db.wallets.find_one({"user_id": user["id"]}, {"_id": 0})
    return {"status": wd.get("status"), "refunded": wd.get("refunded", False),
            "tx_hash": wd.get("tx_hash"), "balances": wallet["balances"] if wallet else {}}


@api_router.post("/oxapay/payout/webhook", response_class=PlainTextResponse)
async def oxapay_payout_webhook(request: Request):
    raw = await request.body()
    received = request.headers.get("HMAC", "")
    if OXAPAY_PAYOUT_KEY:
        expected = hmac.new(OXAPAY_PAYOUT_KEY.encode(), raw, hashlib.sha512).hexdigest()
        if not hmac.compare_digest(expected, received.strip()):
            raise HTTPException(status_code=401, detail="invalid signature")
    try:
        event = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid JSON")
    track_id = event.get("track_id")
    if track_id:
        await _settle_withdrawal(str(track_id), event.get("status", ""), event.get("tx_hash"))
    return "ok"


# ----------------------------------------------------------------------------
# Bets
# ----------------------------------------------------------------------------
# Same-game parlay correlation: picks from the same game are related, so the
# extra odds from stacking legs in one game are trimmed by this factor per
# additional leg. Legs across different games compound normally.
SGP_CORRELATION = 0.80


def compute_parlay_odds(selections) -> float:
    groups: dict = {}
    for s in selections:
        groups.setdefault(s.event_id, []).append(s.odds)
    total = 1.0
    for odds_list in groups.values():
        prod = 1.0
        for o in odds_list:
            prod *= o
        corr = SGP_CORRELATION ** (len(odds_list) - 1)
        total *= 1 + (prod - 1) * corr
    return total


def _market_key(sel) -> str:
    if sel.market == "prop":
        parts = str(sel.side).split(":")
        return f"{sel.event_id}:prop:{':'.join(parts[:2])}"
    return f"{sel.event_id}:{sel.market}"


async def _find_event(event_id, league):
    metas = [m for m in SGO_LEAGUES if m["group"] == league] or SGO_LEAGUES
    for m in metas:
        for ev in await fetch_sgo_league(m, max_age=600):
            if ev["event_id"] == event_id:
                return ev
    return None


def _live_price(sel, ev):
    """Current server-side odds for a selection, or None if the market/line is gone."""
    if sel.market == "prop":
        parts = str(sel.side).split(":")
        if len(parts) != 3 or parts[2] not in ("over", "under"):
            return None
        stat, pid, ou = parts
        for p in ev.get("props") or []:
            if p.get("stat") == stat and str(p.get("player_id")) == pid and p.get("line") == sel.line:
                return p.get(ou)
        return None
    m = next((x for x in ev.get("markets", []) if x.get("market") == sel.market), None)
    for s in (m or {}).get("selections", []):
        if s.get("side") == sel.side and s.get("line") == sel.line:
            return s.get("odds")
    return None


async def _verify_selections(selections, accept_better=True):
    seen, changed, gone = set(), [], []
    for sel in selections:
        k = _market_key(sel)
        if k in seen:
            raise HTTPException(status_code=400, detail="Conflicting or duplicate picks on the same market")
        seen.add(k)
        ev = await _find_event(sel.event_id, sel.league)
        price = _live_price(sel, ev) if ev and ev.get("state") != "post" else None
        if not price or price <= 1:
            gone.append({"event_id": sel.event_id, "market": sel.market, "side": sel.side, "pick": sel.pick})
            continue
        price = float(price)
        if round(price, 2) < round(sel.odds, 2) or (not accept_better and round(price, 2) != round(sel.odds, 2)):
            changed.append({"event_id": sel.event_id, "market": sel.market, "side": sel.side, "odds": price})
        sel.odds = price
    if gone or changed:
        raise HTTPException(status_code=409, detail={
            "msg": "Some picks are no longer available" if gone else "Odds changed — review your slip and place again",
            "changed": changed, "unavailable": gone})


BOOST_TIERS = [("botd", "Bet of the Day", 0.15), ("golden", "Golden Boost", 0.30), ("boosted", "Boosted Odds", 0.20)]
_BOOST_LOCK = {}


def _boost_leg(ev, market, side, pick, line, odds):
    return {"event_id": ev["event_id"], "league": ev["league"], "league_label": ev["league_label"],
            "home": ev["home"]["abbr"], "away": ev["away"]["abbr"], "home_name": ev["home"]["name"],
            "away_name": ev["away"]["name"], "status_detail": ev.get("status_detail"),
            "market": market, "side": side, "pick": pick, "line": line, "odds": odds}


def _boost_legs(ev):
    sigs = _BOOST_LOCK.get(("legs", ev["event_id"]))
    if sigs:
        legs = []
        for sig, base in sigs:
            price = _live_price(SimpleNamespace(**base), ev)
            if not price or price <= 1:
                break
            legs.append({**base, "odds": float(price), "status_detail": ev.get("status_detail")})
        if len(legs) == len(sigs):
            return legs
    legs = _fresh_boost_legs(ev)
    if legs:
        _BOOST_LOCK[("legs", ev["event_id"])] = [(_leg_sig(l), l) for l in legs]
    return legs


def _fresh_boost_legs(ev):
    mk = {m["market"]: m for m in ev.get("markets", [])}
    legs = []
    ml = [x for x in (mk.get("moneyline") or {}).get("selections", []) if x["side"] != "draw" and x.get("odds")]
    if ml:
        f = min(ml, key=lambda x: x["odds"])
        legs.append(_boost_leg(ev, "moneyline", f["side"], f["pick"], f.get("line"), f["odds"]))
    tot = [x for x in (mk.get("total") or {}).get("selections", []) if x.get("odds")]
    if tot:
        t = min(tot, key=lambda x: x["odds"])
        legs.append(_boost_leg(ev, "total", t["side"], t["pick"], t.get("line"), t["odds"]))
    props = [p for p in ev.get("props") or [] if p.get("over") and 1.5 <= p["over"] <= 3.0]
    if props:
        p = min(props, key=lambda x: abs(x["over"] - 2))
        legs.append(_boost_leg(ev, "prop", f"{p['stat']}:{p['player_id']}:over",
                               f"{p['player']} O{p['line']} {p['label']}", p["line"], p["over"]))
    else:
        sp = [x for x in (mk.get("spread") or {}).get("selections", []) if x.get("odds")]
        if sp:
            x = min(sp, key=lambda y: y["odds"])
            legs.append(_boost_leg(ev, "spread", x["side"], x["pick"], x.get("line"), x["odds"]))
    return legs if len(legs) == 3 else None


def _boost_price(legs, pct):
    base = compute_parlay_odds([SimpleNamespace(**l) for l in legs])
    return round(base, 2), round(1 + (base - 1) * (1 + pct), 2)


def build_boosts():
    soon = datetime.now(timezone.utc) + timedelta(minutes=5)
    cands = []
    for c in _SGO_CACHE.values():
        for ev in c["data"]:
            try:
                st = datetime.fromisoformat(ev["start"].replace("Z", "+00:00"))
            except Exception:
                continue
            if ev["state"] != "pre" or st < soon:
                continue
            legs = _boost_legs(ev)
            if legs:
                cands.append((legs[2]["market"] != "prop", ev["start"], ev, legs))
    cands.sort(key=lambda x: (x[0], x[1]))
    picked, leagues = [], set()
    by_id = {c[2]["event_id"]: c for c in cands}
    locked = {}
    for tier, *_ in BOOST_TIERS:
        c = by_id.get(_BOOST_LOCK.get(("tier", tier)))
        if c and c not in locked.values():
            locked[tier] = c
    for c in locked.values():
        leagues.add(c[2]["league_key"])
    free = [c for c in cands if c not in locked.values()]
    need = len(BOOST_TIERS) - len(locked)
    for pass_ in (0, 1):
        for c in free:
            if len(picked) == need:
                break
            if c in picked or (pass_ == 0 and c[2]["league_key"] in leagues):
                continue
            picked.append(c)
            leagues.add(c[2]["league_key"])
    assigned, it = [], iter(picked)
    for tier, label, pct in BOOST_TIERS:
        c = locked.get(tier) or next(it, None)
        if c:
            _BOOST_LOCK[("tier", tier)] = c[2]["event_id"]
            assigned.append(((tier, label, pct), c))
    out = []
    for (tier, label, pct), (_, _, ev, legs) in assigned:
        base, boosted = _boost_price(legs, pct)
        out.append({"id": f"{tier}:{ev['event_id']}", "tier": tier, "label": label, "pct": pct,
                    "event_id": ev["event_id"], "league_label": ev["league_label"], "starts_at": ev["start"],
                    "home": ev["home"]["name"], "away": ev["away"]["name"],
                    "legs": legs, "base_odds": base, "boosted_odds": boosted})
    return out


@api_router.get("/boosts")
async def get_boosts():
    if not any(c["data"] for c in _SGO_CACHE.values()):
        await _fetch_sgo_sequential(SGO_LEAGUES)
    return {"boosts": build_boosts()}


def _leg_sig(x):
    return (x["event_id"], x["market"], x["side"], x.get("line"))


@api_router.post("/bets")
async def place_bet(body: PlaceBetInput, user: dict = Depends(get_current_user)):
    if body.coin not in STARTING_BALANCES:
        raise HTTPException(status_code=400, detail="Invalid coin")
    await ensure_wallet(user["id"])
    boost = None
    if body.boost_id:
        boost = next((b for b in build_boosts() if b["id"] == body.boost_id), None)
        if not boost or {_leg_sig(l) for l in boost["legs"]} != {_leg_sig(s.model_dump()) for s in body.selections}:
            raise HTTPException(status_code=409, detail={"msg": "This boost is no longer available", "changed": [], "unavailable": [], "boost_gone": True})
    await _verify_selections(body.selections, body.accept_better)

    is_parlay = (body.bet_type == "parlay" and len(body.selections) > 1) or bool(boost)
    if not is_parlay and len(body.selections) != 1:
        raise HTTPException(status_code=400, detail="Single bets take exactly one selection")
    total_odds = round(compute_parlay_odds(body.selections), 2) if is_parlay else round(body.selections[0].odds, 2)
    if boost:
        total_odds = _boost_price([s.model_dump() for s in body.selections], boost["pct"])[1]
    potential = round(body.stake * total_odds, 6)

    res = await db.wallets.update_one({"user_id": user["id"], f"balances.{body.coin}": {"$gte": body.stake}},
                                      {"$inc": {f"balances.{body.coin}": -body.stake}})
    if res.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient balance")
    bet = {"id": str(uuid.uuid4()), "user_id": user["id"],
           "selections": [s.model_dump() for s in body.selections],
           "bet_type": "parlay" if is_parlay else "single",
           "stake": body.stake, "coin": body.coin, "total_odds": total_odds,
           "potential_payout": potential, "status": "open",
           "boost": {"id": boost["id"], "label": boost["label"], "pct": boost["pct"]} if boost else None,
           "created_at": now_iso()}
    await db.bets.insert_one(dict(bet))
    await db.transactions.insert_one({"id": str(uuid.uuid4()), "user_id": user["id"],
                                      "type": "bet", "coin": body.coin, "amount": body.stake,
                                      "created_at": now_iso(), "hash": "0x" + uuid.uuid4().hex[:24]})
    wallet = await db.wallets.find_one({"user_id": user["id"]}, {"_id": 0})
    return {"bet": bet, "balances": wallet["balances"]}


def settle_selection(sel, ev) -> Optional[bool]:
    m, side, line = sel["market"], sel["side"], sel.get("line")
    if m == "prop":
        if line is None:
            return None
        parts = str(side).split(":")  # stat:player_id:over|under
        if len(parts) != 3:
            return None
        stat, player_id, ou = parts
        val = (ev.get("player_results") or {}).get(f"{player_id}:{stat}")
        if val is None:
            return None
        if ou == "over":
            return val > line
        if ou == "under":
            return val < line
        return None
    if m in ("rounds", "distance"):
        n = ev.get("rounds")
        if not n:
            return None
        if m == "distance":
            # SGO doesn't report the finish method; only fights ending before round 3 are certain
            return (side == "no") if n < 3 else "push"
        if line is None:
            return None
        if n <= math.floor(line):
            return side == "under"
        if n >= math.floor(line) + 2:
            return side == "over"
        return "push"
    try:
        hs = int(ev["home"]["score"])
        as_ = int(ev["away"]["score"])
    except (TypeError, ValueError):
        return None
    if m == "moneyline":
        if side == "home":
            return hs > as_
        if side == "away":
            return as_ > hs
        if side == "draw":
            return hs == as_
    if m == "spread" and line is not None:
        if side == "home":
            return (hs + line) > as_
        if side == "away":
            return (as_ + line) > hs
    if m == "total" and line is not None:
        total = hs + as_
        if side == "over":
            return total > line
        if side == "under":
            return total < line
    return None


LOSSBACK_RATE = 0.10


async def auto_settle(user_id: str):
    open_bets = await db.bets.find({"user_id": user_id, "status": "open"}).to_list(200)
    if not open_bets:
        return
    results = await _fetch_sgo_sequential(SGO_LEAGUES)
    finished = {}
    for ev in results:
        if ev["state"] == "post":
            finished[ev["event_id"]] = ev
    for b in open_bets:
        legs = []
        for s in b["selections"]:
            ev = finished.get(s["event_id"])
            legs.append(settle_selection(s, ev) if ev else None)
        if any(x is None for x in legs):
            continue
        won = all(x is not False for x in legs)
        pushed = [s for s, x in zip(b["selections"], legs) if x == "push"]
        void = won and len(pushed) == len(legs)
        payout = b["stake"] if void else round(b["potential_payout"] / math.prod(float(s["odds"]) for s in pushed), 8) if won else 0
        res = await db.bets.update_one({"id": b["id"], "status": "open"},
                                       {"$set": {"status": "void" if void else "won" if won else "lost",
                                                 "settled_at": now_iso(), "payout": payout}})
        if res.modified_count and not won:
            lb = round(b["stake"] * LOSSBACK_RATE, 8)
            await db.bets.update_one({"id": b["id"]}, {"$set": {"lossback": lb}})
            await db.wallets.update_one({"user_id": user_id}, {"$inc": {f"balances.{b['coin']}": lb}})
            await db.transactions.insert_one({"id": str(uuid.uuid4()), "user_id": user_id, "type": "lossback",
                                              "coin": b["coin"], "amount": lb, "created_at": now_iso(),
                                              "hash": "lossback:" + b["id"]})
            await _save_notification(user_id, "lossback", {"coin": b["coin"], "amount": lb}, key_id=b["id"])
        if res.modified_count:
            await _accrue_player(user_id)
        if won and res.modified_count:
            await db.wallets.update_one({"user_id": user_id},
                                        {"$inc": {f"balances.{b['coin']}": payout}})
            await db.transactions.insert_one({"id": str(uuid.uuid4()), "user_id": user_id,
                                              "type": "refund" if void else "payout", "coin": b["coin"],
                                              "amount": payout, "created_at": now_iso(),
                                              "hash": "0x" + uuid.uuid4().hex[:24]})


CASHOUT_MARGIN = 0.95


def _cashout_value(b, events) -> Optional[float]:
    """Live cash-out offer for an open bet, or None when suspended/lost."""
    remaining = 1.0
    for s in b["selections"]:
        ev = events.get(s["event_id"])
        if not ev:
            return None
        if ev.get("state") == "post":
            r = settle_selection(s, ev)
            if r is None or r is False:
                return None
            if r == "push":
                remaining *= float(s["odds"])
            continue
        price = _live_price(Selection(**{k: s.get(k) for k in Selection.model_fields if k in s}), ev)
        if not price or price <= 1:
            return None
        remaining *= float(price)
    value = b["potential_payout"] / remaining * CASHOUT_MARGIN
    return round(max(0.0, min(value, b["potential_payout"] * CASHOUT_MARGIN)), 8)


async def _events_index():
    return {ev["event_id"]: ev for ev in await _fetch_sgo_sequential(SGO_LEAGUES)}


@api_router.get("/bets/cashout-quotes")
async def cashout_quotes(user: dict = Depends(get_current_user)):
    open_bets = await db.bets.find({"user_id": user["id"], "status": "open"}, {"_id": 0}).to_list(200)
    if not open_bets:
        return {"quotes": {}}
    events = await _events_index()
    return {"quotes": {b["id"]: _cashout_value(b, events) for b in open_bets}}


async def _do_cashout(b, value, auto=False) -> bool:
    res = await db.bets.update_one({"id": b["id"], "status": "open"},
                                   {"$set": {"status": "cashed_out", "cashout_amount": value, "settled_at": now_iso(),
                                             "auto_cashed": auto}})
    if not res.modified_count:
        return False
    await _accrue_player(b["user_id"])
    await db.wallets.update_one({"user_id": b["user_id"]}, {"$inc": {f"balances.{b['coin']}": value}})
    await db.transactions.insert_one({"id": str(uuid.uuid4()), "user_id": b["user_id"], "type": "cashout",
                                      "coin": b["coin"], "amount": value, "created_at": now_iso(),
                                      "hash": "0x" + uuid.uuid4().hex[:24]})
    if auto:
        await _save_notification(b["user_id"], "cashout", {"coin": b["coin"], "amount": value}, key_id=b["id"])
    return True


_AUTO_CO = {"ts": 0.0, "running": False}


async def _run_auto_cashouts():
    if _AUTO_CO["running"]:
        return
    _AUTO_CO["running"] = True
    try:
        bets = await db.bets.find({"status": "open", "auto_cashout": {"$gt": 0}}, {"_id": 0}).to_list(1000)
        if not bets:
            return
        events = await _events_index()
        for b in bets:
            value = _cashout_value(b, events)
            if value and value >= b["auto_cashout"] and await _do_cashout(b, value, auto=True):
                logger.info(f"auto cash-out bet {b['id']} at {value} {b['coin']}")
    except Exception as e:
        logger.warning(f"auto cash-out run failed: {e}")
    finally:
        _AUTO_CO["running"] = False


def _kick_auto_cashouts():
    now = datetime.now(timezone.utc).timestamp()
    if now - _AUTO_CO["ts"] >= 20:
        _AUTO_CO["ts"] = now
        asyncio.create_task(_run_auto_cashouts())


class AutoCashoutInput(BaseModel):
    target: Optional[float] = Field(default=None, gt=0, allow_inf_nan=False)


@api_router.post("/bets/{bet_id}/auto-cashout")
async def set_auto_cashout(bet_id: str, body: AutoCashoutInput, user: dict = Depends(get_current_user)):
    b = await db.bets.find_one({"id": bet_id, "user_id": user["id"], "status": "open"}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=400, detail="Only open bets can use auto cash out")
    if body.target is not None and body.target >= b["potential_payout"] * CASHOUT_MARGIN:
        raise HTTPException(status_code=400, detail="Target must be below the maximum cash out value")
    await db.bets.update_one({"id": bet_id}, {"$set": {"auto_cashout": body.target}})
    _kick_auto_cashouts()
    return {"auto_cashout": body.target}


@api_router.post("/cron/auto-cashout")
async def cron_auto_cashout(request: Request):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    auth = request.headers.get("authorization", "")
    expected = os.environ.get("WEBHOOK_CRON_SECRET", "")
    if not expected or not auth.startswith("Bearer ") or not hmac.compare_digest(auth[7:], expected):
        raise HTTPException(status_code=401, detail="unauthorized")
    asyncio.create_task(_run_auto_cashouts())
    return {"accepted": True, "run_id": request.headers.get("x-webhook-id")}


class CashoutInput(BaseModel):
    expected: float = Field(gt=0, allow_inf_nan=False)


@api_router.post("/bets/{bet_id}/cashout")
async def cashout_bet(bet_id: str, body: CashoutInput, user: dict = Depends(get_current_user)):
    b = await db.bets.find_one({"id": bet_id, "user_id": user["id"]}, {"_id": 0})
    if not b or b["status"] != "open":
        raise HTTPException(status_code=400, detail="This bet can no longer be cashed out")
    value = _cashout_value(b, await _events_index())
    if not value:
        raise HTTPException(status_code=409, detail={"msg": "Cash out is suspended for this bet right now", "value": None})
    if value < body.expected * 0.995:
        raise HTTPException(status_code=409, detail={"msg": "Cash out value changed", "value": value})
    if not await _do_cashout(b, value):
        raise HTTPException(status_code=400, detail="This bet can no longer be cashed out")
    wallet = await db.wallets.find_one({"user_id": user["id"]}, {"_id": 0})
    return {"amount": value, "balances": wallet["balances"]}


@api_router.get("/bets")
async def list_bets(user: dict = Depends(get_current_user)):
    await auto_settle(user["id"])
    bets = await db.bets.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    wallet = await db.wallets.find_one({"user_id": user["id"]}, {"_id": 0})
    return {"bets": bets, "balances": wallet["balances"] if wallet else {}}


# ----------------------------------------------------------------------------
# Startup
# ----------------------------------------------------------------------------
# ----------------------------------------------------------------------------
# Casino house games (provably-fair style, server-authoritative)
# ----------------------------------------------------------------------------
EDGE = 0.99  # 1% house edge

PLINKO_MULT = {
    8:  {"low": [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
         "medium": [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
         "high": [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29]},
    12: {"low": [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
         "medium": [24, 5, 3, 1.6, 1, 0.5, 0.3, 0.5, 1, 1.6, 3, 5, 24],
         "high": [58, 8, 3, 2, 0.5, 0.2, 0.2, 0.2, 0.5, 2, 3, 8, 58]},
    16: {"low": [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
         "medium": [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
         "high": [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000]},
}

KENO_TABLE = {
    1: [0, 1.9], 2: [0, 0, 4.5], 3: [0, 0, 1.4, 8], 4: [0, 0, 0, 2.2, 13],
    5: [0, 0, 0, 1.5, 4, 30], 6: [0, 0, 0, 1, 2, 8, 50],
    7: [0, 0, 0, 0.5, 1.5, 4, 15, 80], 8: [0, 0, 0, 0.5, 1, 2.5, 8, 30, 100],
    9: [0, 0, 0, 0, 1, 2, 5, 12, 45, 150], 10: [0, 0, 0, 0, 0.6, 1.5, 3, 8, 20, 60, 200],
}


class LimboInput(BaseModel):
    coin: str
    stake: float
    target: float


class PlinkoInput(BaseModel):
    coin: str
    stake: float
    risk: str = "medium"
    rows: int = 16


class KenoInput(BaseModel):
    coin: str
    stake: float
    picks: List[int]
    risk: str = "medium"


class MinesStartInput(BaseModel):
    coin: str
    stake: float
    mines: int = 3


class MinesActionInput(BaseModel):
    game_id: str
    tile: Optional[int] = None


async def _check_funds(user_id, coin, stake):
    if coin not in STARTING_BALANCES:
        raise HTTPException(status_code=400, detail="Invalid coin")
    if stake <= 0:
        raise HTTPException(status_code=400, detail="Invalid stake")
    await ensure_wallet(user_id)
    wallet = await db.wallets.find_one({"user_id": user_id})
    if wallet["balances"].get(coin, 0) < stake:
        raise HTTPException(status_code=400, detail="Insufficient balance")


async def _adjust(user_id, coin, delta):
    await db.wallets.update_one({"user_id": user_id}, {"$inc": {f"balances.{coin}": delta}})


async def _balances(user_id):
    w = await db.wallets.find_one({"user_id": user_id}, {"_id": 0})
    return w["balances"]


async def _record_game(user_id, game, coin, stake, multiplier, payout, won, detail, fair=None):
    doc = {
        "id": str(uuid.uuid4()), "user_id": user_id, "game": game, "coin": coin,
        "stake": stake, "multiplier": round(multiplier, 2), "payout": round(payout, 6),
        "won": won, "detail": detail, "created_at": now_iso(),
    }
    if fair:
        doc.update(fair)
    await db.casino_games.insert_one(doc)
    await _accrue_player(user_id)


# --- provably-fair seed engine ---
def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def rfloat(server_seed: str, client_seed: str, nonce: int, cursor: int = 0) -> float:
    msg = f"{client_seed}:{nonce}:{cursor}"
    h = hmac.new(server_seed.encode(), msg.encode(), hashlib.sha256).hexdigest()
    return int(h[:8], 16) / 0x100000000


def limbo_result(u: float) -> float:
    if u <= 0:
        return 1000000.0
    return max(1.0, math.floor(EDGE / u * 100) / 100)


def pick_distinct(values, k, ss, cs, nonce):
    pool = list(values)
    out = []
    for i in range(k):
        f = rfloat(ss, cs, nonce, i)
        idx = int(f * len(pool))
        if idx >= len(pool):
            idx = len(pool) - 1
        out.append(pool.pop(idx))
    return out


async def ensure_seed(user_id):
    doc = await db.fair_seeds.find_one({"user_id": user_id, "status": "active"})
    if not doc:
        ss = secrets.token_hex(32)
        doc = {"user_id": user_id, "status": "active", "server_seed": ss,
               "server_seed_hash": sha256_hex(ss), "client_seed": secrets.token_hex(8),
               "nonce": 0, "created_at": now_iso()}
        await db.fair_seeds.insert_one(dict(doc))
    return doc


async def next_fair(user_id):
    """Consume one nonce; returns (server_seed, client_seed, nonce_used)."""
    await ensure_seed(user_id)
    doc = await db.fair_seeds.find_one_and_update(
        {"user_id": user_id, "status": "active"},
        {"$inc": {"nonce": 1}}, return_document=ReturnDocument.BEFORE)
    return doc["server_seed"], doc["client_seed"], doc["nonce"]


def fair_meta(ss, cs, nonce):
    return {"nonce": nonce, "server_seed_hash": sha256_hex(ss), "client_seed": cs}


@api_router.post("/casino/limbo")
async def play_limbo(body: LimboInput, user: dict = Depends(get_current_user)):
    if body.target < 1.01 or body.target > 1000000:
        raise HTTPException(status_code=400, detail="Target must be between 1.01 and 1,000,000")
    await _check_funds(user["id"], body.coin, body.stake)
    await _adjust(user["id"], body.coin, -body.stake)
    ss, cs, nonce = await next_fair(user["id"])
    u = rfloat(ss, cs, nonce, 0)
    result = limbo_result(u)
    won = result >= body.target
    payout = round(body.stake * body.target, 6) if won else 0.0
    if won:
        await _adjust(user["id"], body.coin, payout)
    fair = fair_meta(ss, cs, nonce)
    await _record_game(user["id"], "limbo", body.coin, body.stake, body.target if won else 0,
                       payout, won, {"result": result, "target": body.target}, fair)
    return {"result": result, "won": won, "payout": payout, "fair": fair,
            "balances": await _balances(user["id"])}


@api_router.post("/casino/plinko")
async def play_plinko(body: PlinkoInput, user: dict = Depends(get_current_user)):
    if body.rows not in PLINKO_MULT or body.risk not in ("low", "medium", "high"):
        raise HTTPException(status_code=400, detail="Invalid config")
    await _check_funds(user["id"], body.coin, body.stake)
    await _adjust(user["id"], body.coin, -body.stake)
    ss, cs, nonce = await next_fair(user["id"])
    path = [rfloat(ss, cs, nonce, i) < 0.5 for i in range(body.rows)]  # True=right
    bucket = sum(1 for p in path if p)
    mult = PLINKO_MULT[body.rows][body.risk][bucket]
    payout = round(body.stake * mult, 6)
    await _adjust(user["id"], body.coin, payout)
    fair = fair_meta(ss, cs, nonce)
    await _record_game(user["id"], "plinko", body.coin, body.stake, mult, payout, mult >= 1,
                       {"bucket": bucket, "rows": body.rows, "risk": body.risk}, fair)
    return {"path": ["R" if p else "L" for p in path], "bucket": bucket, "multiplier": mult,
            "payout": payout, "fair": fair, "balances": await _balances(user["id"])}


@api_router.post("/casino/keno")
async def play_keno(body: KenoInput, user: dict = Depends(get_current_user)):
    picks = sorted(set(body.picks))
    if not (1 <= len(picks) <= 10) or any(n < 1 or n > 40 for n in picks):
        raise HTTPException(status_code=400, detail="Pick 1-10 numbers from 1-40")
    await _check_funds(user["id"], body.coin, body.stake)
    await _adjust(user["id"], body.coin, -body.stake)
    ss, cs, nonce = await next_fair(user["id"])
    drawn = pick_distinct(range(1, 41), 10, ss, cs, nonce)
    hits = len([n for n in picks if n in drawn])
    mult = KENO_TABLE[len(picks)][hits]
    payout = round(body.stake * mult, 6)
    if payout > 0:
        await _adjust(user["id"], body.coin, payout)
    fair = fair_meta(ss, cs, nonce)
    await _record_game(user["id"], "keno", body.coin, body.stake, mult, payout, mult >= 1,
                       {"picks": picks, "drawn": sorted(drawn), "hits": hits}, fair)
    return {"drawn": sorted(drawn), "hits": hits, "multiplier": mult, "payout": payout,
            "fair": fair, "balances": await _balances(user["id"])}


def mines_multiplier(mines: int, revealed: int) -> float:
    if revealed == 0:
        return 1.0
    m = EDGE
    for i in range(revealed):
        m *= (25 - i) / (25 - mines - i)
    return round(m, 4)


@api_router.post("/casino/mines/start")
async def mines_start(body: MinesStartInput, user: dict = Depends(get_current_user)):
    if not (1 <= body.mines <= 24):
        raise HTTPException(status_code=400, detail="Mines must be 1-24")
    await _check_funds(user["id"], body.coin, body.stake)
    # refund & close any prior active game (stake was taken on its start)
    async for prior in db.mine_games.find({"user_id": user["id"], "status": "active"}):
        await _adjust(user["id"], prior["coin"], prior["stake"])
    await db.mine_games.update_many({"user_id": user["id"], "status": "active"},
                                    {"$set": {"status": "abandoned"}})
    await _adjust(user["id"], body.coin, -body.stake)
    ss, cs, nonce = await next_fair(user["id"])
    positions = pick_distinct(range(25), body.mines, ss, cs, nonce)
    gid = str(uuid.uuid4())
    await db.mine_games.insert_one({
        "id": gid, "user_id": user["id"], "coin": body.coin, "stake": body.stake,
        "mines": positions, "mine_count": body.mines, "revealed": [], "status": "active",
        "nonce": nonce, "server_seed_hash": sha256_hex(ss), "client_seed": cs,
        "created_at": now_iso(),
    })
    return {"game_id": gid, "mine_count": body.mines, "fair": fair_meta(ss, cs, nonce),
            "balances": await _balances(user["id"])}


@api_router.post("/casino/mines/reveal")
async def mines_reveal(body: MinesActionInput, user: dict = Depends(get_current_user)):
    g = await db.mine_games.find_one({"id": body.game_id, "user_id": user["id"]})
    if not g or g["status"] != "active":
        raise HTTPException(status_code=400, detail="No active game")
    if body.tile is None or not (0 <= body.tile <= 24) or body.tile in g["revealed"]:
        raise HTTPException(status_code=400, detail="Invalid tile")
    if body.tile in g["mines"]:
        await db.mine_games.update_one({"id": g["id"]}, {"$set": {"status": "lost"}})
        await _record_game(user["id"], "mines", g["coin"], g["stake"], 0, 0.0, False,
                           {"mines": g["mine_count"], "revealed": len(g["revealed"]), "hit": True},
                           {"nonce": g.get("nonce"), "server_seed_hash": g.get("server_seed_hash"), "client_seed": g.get("client_seed")})
        return {"hit": True, "mines": g["mines"], "done": True, "balances": await _balances(user["id"])}
    revealed = g["revealed"] + [body.tile]
    await db.mine_games.update_one({"id": g["id"]}, {"$set": {"revealed": revealed}})
    mult = mines_multiplier(g["mine_count"], len(revealed))
    next_mult = mines_multiplier(g["mine_count"], len(revealed) + 1)
    return {"hit": False, "revealed": revealed, "multiplier": mult, "next_multiplier": next_mult,
            "cashout_value": round(g["stake"] * mult, 6), "done": False}


@api_router.post("/casino/mines/cashout")
async def mines_cashout(body: MinesActionInput, user: dict = Depends(get_current_user)):
    g = await db.mine_games.find_one({"id": body.game_id, "user_id": user["id"]})
    if not g or g["status"] != "active":
        raise HTTPException(status_code=400, detail="No active game")
    if not g["revealed"]:
        raise HTTPException(status_code=400, detail="Reveal at least one tile first")
    mult = mines_multiplier(g["mine_count"], len(g["revealed"]))
    payout = round(g["stake"] * mult, 6)
    await _adjust(user["id"], g["coin"], payout)
    await db.mine_games.update_one({"id": g["id"]}, {"$set": {"status": "won"}})
    await _record_game(user["id"], "mines", g["coin"], g["stake"], mult, payout, True,
                       {"mines": g["mine_count"], "revealed": len(g["revealed"]), "hit": False},
                       {"nonce": g.get("nonce"), "server_seed_hash": g.get("server_seed_hash"), "client_seed": g.get("client_seed")})
    return {"payout": payout, "multiplier": mult, "mines": g["mines"],
            "balances": await _balances(user["id"])}


# --- Blackjack (6-deck shoe, dealer stands on all 17, BJ 3:2, side bets) ---
BJ_RANKS = "A23456789TJQK"
BJ_SUITS = "SHDC"
PP_PAY = {"perfect": 25, "colored": 12, "mixed": 6}
T213_PAY = {"suited_trips": 100, "straight_flush": 40, "trips": 30, "straight": 10, "flush": 5}
BUST_PAY = {3: 1, 4: 2, 5: 9, 6: 50, 7: 100}


class BlackjackDealInput(BaseModel):
    coin: str
    stake: float = Field(gt=0, allow_inf_nan=False)
    side_pp: float = Field(default=0, ge=0, allow_inf_nan=False)
    side_213: float = Field(default=0, ge=0, allow_inf_nan=False)
    side_bust: float = Field(default=0, ge=0, allow_inf_nan=False)


class BlackjackActionInput(BaseModel):
    game_id: str
    action: str


def bj_shoe(ss, cs, nonce, decks=6):
    deck = [r + su for _ in range(decks) for su in BJ_SUITS for r in BJ_RANKS]
    for i in range(len(deck) - 1, 0, -1):
        j = int(rfloat(ss, cs, nonce, i) * (i + 1))
        deck[i], deck[j] = deck[j], deck[i]
    return deck


def bj_value(cards):
    total, aces = 0, 0
    for c in cards:
        r = c[0]
        total += 11 if r == "A" else 10 if r in "TJQK" else int(r)
        aces += r == "A"
    while total > 21 and aces:
        total -= 10
        aces -= 1
    return total, aces > 0


def bj_is_bj(cards):
    return len(cards) == 2 and bj_value(cards)[0] == 21


def _red(c):
    return c[1] in "HD"


def bj_pp(a, b):
    if a[0] != b[0]:
        return None
    if a[1] == b[1]:
        return "perfect"
    return "colored" if _red(a) == _red(b) else "mixed"


def bj_213(cards):
    ranks = sorted("A23456789TJQK".index(c[0]) for c in cards)
    suited = len({c[1] for c in cards}) == 1
    trips = len({c[0] for c in cards}) == 1
    straight = (ranks[2] - ranks[0] == 2 and len(set(ranks)) == 3) or ranks == [0, 11, 12]
    if trips and suited:
        return "suited_trips"
    if straight and suited:
        return "straight_flush"
    if trips:
        return "trips"
    if straight:
        return "straight"
    if suited:
        return "flush"
    return None


def _bj_draw(g):
    c = g["deck"][g["pos"]]
    g["pos"] += 1
    return c


def _bj_actions(g):
    if g["status"] == "insurance":
        return ["insurance", "no_insurance"]
    if g["status"] != "active":
        return []
    h = g["hands"][g["active"]]
    acts = ["hit", "stand"]
    if len(h["cards"]) == 2 and not h.get("split_aces"):
        acts.append("double")
        if h["cards"][0][0] == h["cards"][1][0] and len(g["hands"]) < 4:
            acts.append("split")
    return acts


def _bj_public(g, balances=None):
    done = g["status"] == "done"
    dealer = g["dealer"] if done or g.get("dealer_revealed") else [g["dealer"][0], "XX"]
    out = {
        "game_id": g["id"], "status": g["status"], "coin": g["coin"], "active": g["active"],
        "hands": [{**{k: h.get(k) for k in ("cards", "bet", "doubled", "result", "payout")},
                   "value": bj_value(h["cards"])[0], "soft": bj_value(h["cards"])[1]} for h in g["hands"]],
        "dealer": dealer, "dealer_value": bj_value([c for c in dealer if c != "XX"])[0],
        "sides": g["sides"], "insurance": g.get("insurance"), "actions": _bj_actions(g),
        "total_stake": g["total_stake"], "total_payout": g.get("total_payout", 0),
        "fair": {"nonce": g["nonce"], "server_seed_hash": g["server_seed_hash"], "client_seed": g["client_seed"]},
    }
    if balances is not None:
        out["balances"] = balances
    return out


async def _bj_finish(g):
    d = g["dealer"]
    live = [h for h in g["hands"] if bj_value(h["cards"])[0] <= 21]
    dealer_bj = bj_is_bj(d)
    natural = len(g["hands"]) == 1 and bj_is_bj(g["hands"][0]["cards"])
    if (live and not natural and not dealer_bj) or g["sides"]["bust"]["bet"] > 0:
        while bj_value(d)[0] < 17:
            d.append(_bj_draw(g))
    dv = bj_value(d)[0]
    payout = 0.0
    for h in g["hands"]:
        pv = bj_value(h["cards"])[0]
        if pv > 21:
            h["result"], h["payout"] = "bust", 0.0
        elif natural and not dealer_bj:
            h["result"], h["payout"] = "blackjack", round(h["bet"] * 2.5, 8)
        elif dealer_bj:
            h["result"], h["payout"] = ("push", h["bet"]) if natural else ("lose", 0.0)
        elif dv > 21 or pv > dv:
            h["result"], h["payout"] = "win", round(h["bet"] * 2, 8)
        elif pv == dv:
            h["result"], h["payout"] = "push", h["bet"]
        else:
            h["result"], h["payout"] = "lose", 0.0
        payout += h["payout"]
    bust = g["sides"]["bust"]
    if bust["bet"] > 0:
        mult = BUST_PAY.get(len(d), 250) if dv > 21 else 0
        bust.update(result=f"Dealer bust · {len(d)} cards" if mult else None, payout=round(bust["bet"] * (mult + 1), 8) if mult else 0.0)
        payout += bust["payout"]
    if g.get("insurance") and g["insurance"]["bet"] > 0:
        g["insurance"]["payout"] = round(g["insurance"]["bet"] * 3, 8) if dealer_bj else 0.0
        payout += g["insurance"]["payout"]
    payout += g["sides"]["pp"]["payout"] + g["sides"]["t213"]["payout"]
    g["status"], g["total_payout"] = "done", round(payout, 8)


async def _bj_settle(g):
    """Credit and record a finished hand; call only after the hand state is durably saved."""
    d, payout = g["dealer"], g["total_payout"]
    if payout > 0:
        await _adjust(g["user_id"], g["coin"], payout)
    mult = payout / g["total_stake"] if g["total_stake"] else 0
    await _record_game(g["user_id"], "blackjack", g["coin"], g["total_stake"], mult, payout, payout > g["total_stake"],
                       {"player": [h["cards"] for h in g["hands"]], "dealer": d, "results": [h["result"] for h in g["hands"]]},
                       {"nonce": g["nonce"], "server_seed_hash": g["server_seed_hash"], "client_seed": g["client_seed"]})


def _bj_advance(g):
    """Move to next unfinished hand; returns True when all player hands are done."""
    while g["active"] < len(g["hands"]):
        h = g["hands"][g["active"]]
        if not h.get("done") and bj_value(h["cards"])[0] < 21:
            return False
        h["done"] = True
        g["active"] += 1
    g["active"] = len(g["hands"]) - 1
    return True


async def _bj_save(g, token):
    g["lock"], g["lock_at"] = None, None
    g["open"] = g["status"] != "done"
    res = await db.bj_games.replace_one({"id": g["id"], "lock": token}, g)
    if not res.matched_count:
        raise HTTPException(status_code=409, detail="Hand is busy, try again")


@api_router.post("/casino/blackjack/deal")
async def bj_deal(body: BlackjackDealInput, user: dict = Depends(get_current_user)):
    if body.coin not in STARTING_BALANCES:
        raise HTTPException(status_code=400, detail="Invalid coin")
    if await db.bj_games.find_one({"user_id": user["id"], "status": {"$in": ["active", "insurance"]}}):
        raise HTTPException(status_code=400, detail="Finish your current hand first")
    total = round(body.stake + body.side_pp + body.side_213 + body.side_bust, 8)
    res = await db.wallets.update_one({"user_id": user["id"], f"balances.{body.coin}": {"$gte": total}},
                                      {"$inc": {f"balances.{body.coin}": -total}})
    if not res.modified_count:
        raise HTTPException(status_code=400, detail="Insufficient balance")
    ss, cs, nonce = await next_fair(user["id"])
    g = {"id": str(uuid.uuid4()), "user_id": user["id"], "coin": body.coin, "deck": bj_shoe(ss, cs, nonce), "pos": 0,
         "nonce": nonce, "server_seed_hash": sha256_hex(ss), "client_seed": cs, "total_stake": total,
         "hands": [{"cards": [], "bet": body.stake, "doubled": False}], "dealer": [], "active": 0, "status": "active",
         "created_at": now_iso()}
    for _ in range(2):
        g["hands"][0]["cards"].append(_bj_draw(g))
        g["dealer"].append(_bj_draw(g))
    p, up = g["hands"][0]["cards"], g["dealer"][0]
    pp = bj_pp(*p) if body.side_pp else None
    t = bj_213(p + [up]) if body.side_213 else None
    g["sides"] = {
        "pp": {"bet": body.side_pp, "result": pp, "payout": round(body.side_pp * (PP_PAY[pp] + 1), 8) if pp else 0.0},
        "t213": {"bet": body.side_213, "result": t, "payout": round(body.side_213 * (T213_PAY[t] + 1), 8) if t else 0.0},
        "bust": {"bet": body.side_bust, "result": None, "payout": 0.0},
    }
    if up[0] == "A" and not bj_is_bj(p):
        g["status"] = "insurance"
    elif bj_is_bj(p) or (up[0] in "ATJQK" and bj_is_bj(g["dealer"])):
        await _bj_finish(g)
    g["open"] = g["status"] != "done"
    from pymongo.errors import DuplicateKeyError
    try:
        await db.bj_games.insert_one(dict(g))
    except DuplicateKeyError:
        await _adjust(user["id"], body.coin, total)
        raise HTTPException(status_code=400, detail="Finish your current hand first")
    if g["status"] == "done":
        await _bj_settle(g)
    return _bj_public(g, await _balances(user["id"]))


@api_router.post("/casino/blackjack/action")
async def bj_action(body: BlackjackActionInput, user: dict = Depends(get_current_user)):
    # claim the hand atomically so parallel requests can't double-apply moves or payouts
    token = str(uuid.uuid4())
    stale = (datetime.now(timezone.utc) - timedelta(seconds=15)).isoformat()
    g = await db.bj_games.find_one_and_update(
        {"id": body.game_id, "user_id": user["id"],
         "$or": [{"lock": {"$in": [None, False]}}, {"lock_at": {"$lt": stale}}]},
        {"$set": {"lock": token, "lock_at": now_iso()}}, projection={"_id": 0}, return_document=ReturnDocument.AFTER)
    if not g:
        if not await db.bj_games.find_one({"id": body.game_id, "user_id": user["id"]}, {"_id": 1}):
            raise HTTPException(status_code=404, detail="Hand not found")
        raise HTTPException(status_code=409, detail="Hand is busy, try again")
    try:
        return await _bj_apply(g, body.action, user, token)
    finally:
        await db.bj_games.update_one({"id": body.game_id, "lock": token}, {"$set": {"lock": None, "lock_at": None}})


async def _bj_apply(g, a, user, token):
    if a not in _bj_actions(g):
        raise HTTPException(status_code=400, detail="That move isn't available")
    if a in ("insurance", "no_insurance"):
        if a == "insurance":
            ins = round(g["hands"][0]["bet"] / 2, 8)
            res = await db.wallets.update_one({"user_id": user["id"], f"balances.{g['coin']}": {"$gte": ins}},
                                              {"$inc": {f"balances.{g['coin']}": -ins}})
            if not res.modified_count:
                raise HTTPException(status_code=400, detail="Insufficient balance for insurance")
            g["insurance"] = {"bet": ins, "payout": 0.0}
            g["total_stake"] = round(g["total_stake"] + ins, 8)
        g["status"] = "active"
        if bj_is_bj(g["dealer"]):
            g["dealer_revealed"] = True
            await _bj_finish(g)
    else:
        h = g["hands"][g["active"]]
        if a in ("double", "split"):
            extra = h["bet"]
            res = await db.wallets.update_one({"user_id": user["id"], f"balances.{g['coin']}": {"$gte": extra}},
                                              {"$inc": {f"balances.{g['coin']}": -extra}})
            if not res.modified_count:
                raise HTTPException(status_code=400, detail="Insufficient balance")
            g["total_stake"] = round(g["total_stake"] + extra, 8)
        if a == "hit":
            h["cards"].append(_bj_draw(g))
        elif a == "stand":
            h["done"] = True
        elif a == "double":
            h["bet"] = round(h["bet"] * 2, 8)
            h["doubled"] = True
            h["cards"].append(_bj_draw(g))
            h["done"] = True
        elif a == "split":
            aces = h["cards"][0][0] == "A"
            second = {"cards": [h["cards"].pop(), _bj_draw(g)], "bet": h["bet"], "doubled": False, "split_aces": aces}
            h["cards"].append(_bj_draw(g))
            h["split_aces"] = aces
            g["hands"].insert(g["active"] + 1, second)
            if aces:
                h["done"] = second["done"] = True
        if _bj_advance(g):
            await _bj_finish(g)
    await _bj_save(g, token)
    if g["status"] == "done":
        await _bj_settle(g)
    return _bj_public(g, await _balances(user["id"]))


@api_router.get("/casino/blackjack/current")
async def bj_current(user: dict = Depends(get_current_user)):
    g = await db.bj_games.find_one({"user_id": user["id"], "status": {"$in": ["active", "insurance"]}}, {"_id": 0})
    return {"game": _bj_public(g) if g else None}


@api_router.get("/casino/history")
async def casino_history(user: dict = Depends(get_current_user)):
    rows = await db.casino_games.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(40)
    return {"games": rows}


class DiceInput(BaseModel):
    coin: str
    stake: float
    target: float
    direction: str = "over"   # over | under


@api_router.post("/casino/dice")
async def play_dice(body: DiceInput, user: dict = Depends(get_current_user)):
    if body.direction not in ("over", "under"):
        raise HTTPException(status_code=400, detail="Invalid direction")
    if not (0.01 <= body.target <= 99.99):
        raise HTTPException(status_code=400, detail="Target must be between 0.01 and 99.99")
    await _check_funds(user["id"], body.coin, body.stake)
    await _adjust(user["id"], body.coin, -body.stake)
    ss, cs, nonce = await next_fair(user["id"])
    roll = math.floor(rfloat(ss, cs, nonce, 0) * 10000) / 100   # 0.00 - 99.99
    if body.direction == "over":
        won = roll > body.target
        chance = 100 - body.target
    else:
        won = roll < body.target
        chance = body.target
    mult = round(EDGE * 100 / chance, 4) if chance > 0 else 0.0
    payout = round(body.stake * mult, 6) if won else 0.0
    if won:
        await _adjust(user["id"], body.coin, payout)
    fair = fair_meta(ss, cs, nonce)
    await _record_game(user["id"], "dice", body.coin, body.stake, mult if won else 0, payout, won,
                       {"roll": roll, "target": body.target, "direction": body.direction}, fair)
    return {"roll": roll, "won": won, "multiplier": mult, "payout": payout, "fair": fair,
            "balances": await _balances(user["id"])}


class ClientSeedInput(BaseModel):
    client_seed: str


@api_router.get("/casino/seed")
async def get_seed(user: dict = Depends(get_current_user)):
    doc = await ensure_seed(user["id"])
    revealed = await db.fair_seeds.find(
        {"user_id": user["id"], "status": "revealed"},
        {"_id": 0, "server_seed": 1, "server_seed_hash": 1}).sort("revealed_at", -1).to_list(50)
    return {"server_seed_hash": doc["server_seed_hash"], "client_seed": doc["client_seed"],
            "nonce": doc["nonce"], "revealed": revealed}


@api_router.post("/casino/seed/client")
async def set_client_seed(body: ClientSeedInput, user: dict = Depends(get_current_user)):
    await ensure_seed(user["id"])
    cs = (body.client_seed or "").strip()[:64] or secrets.token_hex(8)
    await db.fair_seeds.update_one({"user_id": user["id"], "status": "active"},
                                   {"$set": {"client_seed": cs}})
    return {"client_seed": cs}


@api_router.post("/casino/seed/rotate")
async def rotate_seed(user: dict = Depends(get_current_user)):
    old = await ensure_seed(user["id"])
    await db.fair_seeds.update_one({"user_id": user["id"], "status": "active"},
                                   {"$set": {"status": "revealed", "revealed_at": now_iso()}})
    new_ss = secrets.token_hex(32)
    await db.fair_seeds.insert_one({
        "user_id": user["id"], "status": "active", "server_seed": new_ss,
        "server_seed_hash": sha256_hex(new_ss), "client_seed": old["client_seed"],
        "nonce": 0, "created_at": now_iso()})
    return {"revealed_server_seed": old["server_seed"],
            "revealed_server_seed_hash": old["server_seed_hash"],
            "new_server_seed_hash": sha256_hex(new_ss)}


@api_router.get("/")
async def root():
    return {"message": "ApexOdds API"}


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.affiliates.create_index("code", unique=True)
    await db.affiliates.create_index("user_id", unique=True)
    await db.affiliate_ledger.create_index([("affiliate_id", 1), ("player_id", 1), ("coin", 1)], unique=True)
    await db.users.create_index("referred_by")
    await db.affiliate_earnings.create_index([("affiliate_id", 1), ("date", 1)])
    async for led in db.affiliate_ledger.find({}):
        got = await db.affiliate_earnings.aggregate([
            {"$match": {"affiliate_id": led["affiliate_id"], "player_id": led["player_id"], "coin": led["coin"]}},
            {"$group": {"_id": None, "s": {"$sum": "$amount"}}}]).to_list(1)
        gap = round(led.get("credited", 0) - (got[0]["s"] if got else 0), 8)
        if gap > 0:
            await db.affiliate_earnings.insert_one({"affiliate_id": led["affiliate_id"], "player_id": led["player_id"],
                                                    "coin": led["coin"], "amount": gap, "created_at": now_iso(),
                                                    "date": datetime.now(timezone.utc).date().isoformat()})
    await db.static_deposits.create_index("tx_hash", unique=True)
    await db.bj_games.update_many({"open": {"$exists": False}}, [{"$set": {"open": {"$ne": ["$status", "done"]}}}])
    await db.bj_games.create_index("user_id", name="bj_one_open_hand", unique=True,
                                   partialFilterExpression={"open": True})
    try:
        await db.static_addresses.drop_index("user_id_1_coin_1")
    except Exception:
        pass
    for c, n in {"BTC": "BTC", "ETH": "ERC20", "USDT": "TRC20", "SOL": "SOL"}.items():
        await db.static_addresses.update_many({"coin": c, "net": {"$exists": False}}, {"$set": {"net": n}})
    await db.static_addresses.create_index([("user_id", 1), ("coin", 1), ("net", 1)], unique=True)
    await db.static_deposits.update_many({"notified": {"$exists": False}}, {"$set": {"notified": True}})
    async for w in db.withdrawals.find({"notified_stage": {"$exists": False}}, {"id": 1, "status": 1, "refunded": 1}):
        await db.withdrawals.update_one({"id": w["id"]}, {"$set": {"notified_stage": _wd_stage(w)}})
    await db.notifications.create_index("key", unique=True)
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    if not await db.notifications.estimated_document_count():
        async for d in db.static_deposits.find({"notified": True}):
            await _save_notification(d["user_id"], "deposit", d, created_at=d.get("created_at"))
        async for w in db.withdrawals.find({"notified_stage": {"$ne": None}}):
            await _save_notification(w["user_id"], "withdrawal", w, stage=w["notified_stage"], key_id=w["id"],
                                     created_at=w.get("decided_at") or w.get("created_at"))
        await db.notifications.update_many({}, {"$set": {"read": True}})
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@apexodds.io").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        res = await db.users.insert_one({"name": "Admin", "email": admin_email,
                                         "password_hash": hash_password(admin_password),
                                         "role": "admin", "created_at": now_iso()})
        await ensure_wallet(str(res.inserted_id))
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email},
                                  {"$set": {"password_hash": hash_password(admin_password)}})


@app.on_event("shutdown")
async def shutdown():
    client.close()


# ----------------------------------------------------------------------------
# Affiliates: 10% of NGR (stakes - payouts) from referred players, losses carried forward
# ----------------------------------------------------------------------------
AFF_RATE = 0.10


async def _ensure_affiliate(user_id):
    a = await db.affiliates.find_one({"user_id": user_id}, {"_id": 0})
    while not a:
        code = secrets.token_hex(3).upper()
        try:
            await db.affiliates.insert_one({"user_id": user_id, "code": code, "available": {}, "claimed": {},
                                            "created_at": now_iso()})
        except Exception:
            pass
        a = await db.affiliates.find_one({"user_id": user_id}, {"_id": 0})
    return a


async def _player_ngr(player_ids):
    out = {}
    def add(uid, coin, v):
        out.setdefault(uid, {}).setdefault(coin, 0.0)
        out[uid][coin] += v
    async for r in db.bets.aggregate([
        {"$match": {"user_id": {"$in": player_ids}, "status": {"$in": ["won", "lost", "void", "cashed_out"]}}},
        {"$group": {"_id": {"u": "$user_id", "c": "$coin"}, "stake": {"$sum": "$stake"},
                    "paid": {"$sum": {"$add": [{"$ifNull": ["$cashout_amount", {"$ifNull": ["$payout", 0]}]},
                                               {"$ifNull": ["$lossback", 0]}]}}}}]):
        add(r["_id"]["u"], r["_id"]["c"], r["stake"] - r["paid"])
    async for r in db.casino_games.aggregate([
        {"$match": {"user_id": {"$in": player_ids}}},
        {"$group": {"_id": {"u": "$user_id", "c": "$coin"}, "stake": {"$sum": "$stake"}, "paid": {"$sum": "$payout"}}}]):
        add(r["_id"]["u"], r["_id"]["c"], r["stake"] - r["paid"])
    return out


async def _credit_ledger(aff_id, pid, coin, credited, target, exists):
    flt = {"affiliate_id": aff_id, "player_id": pid, "coin": coin}
    flt["credited"] = credited if exists else {"$exists": False}
    try:
        res = await db.affiliate_ledger.update_one(flt, {"$set": {"credited": target}}, upsert=not exists)
    except Exception:
        return
    if res.modified_count or res.upserted_id:
        amt = round(target - credited, 8)
        await db.affiliates.update_one({"user_id": aff_id}, {"$inc": {f"available.{coin}": amt}})
        await db.affiliate_earnings.insert_one({"affiliate_id": aff_id, "player_id": pid, "coin": coin, "amount": amt,
                                                "date": datetime.now(timezone.utc).date().isoformat(), "created_at": now_iso()})


async def _accrue_player(pid):
    try:
        u = await db.users.find_one({"_id": ObjectId(pid)}, {"referred_by": 1})
    except Exception:
        return
    aff = (u or {}).get("referred_by")
    if not aff:
        return
    for coin, v in (await _player_ngr([pid])).get(pid, {}).items():
        target = round(max(0.0, v * AFF_RATE), 8)
        led = await db.affiliate_ledger.find_one({"affiliate_id": aff, "player_id": pid, "coin": coin})
        credited = (led or {}).get("credited", 0.0)
        if target > credited:
            await _credit_ledger(aff, pid, coin, credited, target, bool(led))


async def _accrue_affiliate(aff_user_id):
    players = await db.users.find({"referred_by": aff_user_id}, {"name": 1, "created_at": 1}).to_list(5000)
    ids = [str(p["_id"]) for p in players]
    ngr = await _player_ngr(ids) if ids else {}
    ledger = {(l["player_id"], l["coin"]): l async for l in db.affiliate_ledger.find({"affiliate_id": aff_user_id})}
    rows = []
    for p in players:
        pid = str(p["_id"])
        earned = {}
        for coin, v in ngr.get(pid, {}).items():
            target = round(max(0.0, v * AFF_RATE), 8)
            credited = (ledger.get((pid, coin)) or {}).get("credited", 0.0)
            if target > credited:
                await _credit_ledger(aff_user_id, pid, coin, credited, target, (pid, coin) in ledger)
                credited = target
            earned[coin] = credited
        nm = p.get("name") or "Player"
        rows.append({"name": nm[:2] + "•••" if len(nm) > 2 else nm + "•••", "joined": p.get("created_at"),
                     "ngr": {c: round(v, 8) for c, v in ngr.get(pid, {}).items()}, "commission": earned})
    return rows


@api_router.get("/affiliate")
async def affiliate_panel(user: dict = Depends(get_current_user)):
    await _ensure_affiliate(user["id"])
    rows = await _accrue_affiliate(user["id"])
    a = await db.affiliates.find_one({"user_id": user["id"]}, {"_id": 0})
    lifetime = {}
    for r in rows:
        for c, v in r["commission"].items():
            lifetime[c] = round(lifetime.get(c, 0) + v, 8)
    rows.sort(key=lambda r: r["joined"] or "", reverse=True)
    return {"code": a["code"], "rate": AFF_RATE, "referrals": len(rows), "players": rows[:200],
            "available": {c: round(v, 8) for c, v in (a.get("available") or {}).items() if v > 0},
            "claimed": a.get("claimed") or {}, "lifetime": lifetime}


@api_router.get("/affiliate/daily")
async def affiliate_daily(user: dict = Depends(get_current_user)):
    days = 30
    today = datetime.now(timezone.utc).date()
    keys = [(today - timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)]
    out = {k: {"date": k, "commission": {}, "signups": 0} for k in keys}
    players = await db.users.find({"referred_by": user["id"]}, {"created_at": 1}).to_list(5000)
    for p in players:
        d = (p.get("created_at") or "")[:10]
        if d in out:
            out[d]["signups"] += 1
    async for r in db.affiliate_earnings.aggregate([
            {"$match": {"affiliate_id": user["id"], "date": {"$gte": keys[0]}}},
            {"$group": {"_id": {"d": "$date", "c": "$coin"}, "amt": {"$sum": "$amount"}}}]):
        if r["_id"]["d"] in out:
            out[r["_id"]["d"]]["commission"][r["_id"]["c"]] = round(r["amt"], 8)
    return {"days": list(out.values())}


@api_router.put("/affiliate/code")
async def set_affiliate_code(body: AffCodeInput, user: dict = Depends(get_current_user)):
    await _ensure_affiliate(user["id"])
    code = body.code.upper()
    if await db.affiliates.find_one({"code": code, "user_id": {"$ne": user["id"]}}):
        raise HTTPException(status_code=400, detail="That code is taken")
    try:
        await db.affiliates.update_one({"user_id": user["id"]}, {"$set": {"code": code}})
    except Exception:
        raise HTTPException(status_code=400, detail="That code is taken")
    return {"code": code}


@api_router.get("/affiliate/check/{code}")
async def check_affiliate_code(code: str):
    a = await db.affiliates.find_one({"code": code.strip().upper()[:24]})
    return {"valid": bool(a)}


@api_router.post("/affiliate/claim")
async def claim_affiliate(user: dict = Depends(get_current_user)):
    await _ensure_affiliate(user["id"])
    await _accrue_affiliate(user["id"])
    a = await db.affiliates.find_one_and_update({"user_id": user["id"]}, {"$set": {"available": {}}})
    avail = {c: round(v, 8) for c, v in (a.get("available") or {}).items() if v > 0}
    if not avail:
        raise HTTPException(status_code=400, detail="Nothing to claim yet")
    await ensure_wallet(user["id"])
    for coin, v in avail.items():
        await db.wallets.update_one({"user_id": user["id"]}, {"$inc": {f"balances.{coin}": v}})
        await db.affiliates.update_one({"user_id": user["id"]}, {"$inc": {f"claimed.{coin}": v}})
        await db.transactions.insert_one({"id": str(uuid.uuid4()), "user_id": user["id"], "type": "affiliate",
                                          "coin": coin, "amount": v, "created_at": now_iso(),
                                          "hash": "0x" + uuid.uuid4().hex[:24]})
    return {"claimed": avail, "balances": await _balances(user["id"])}


# ----------------------------------------------------------------------------
# Admin: users, balances, blocking
# ----------------------------------------------------------------------------
class AdjustInput(BaseModel):
    coin: str
    amount: float
    reason: str = Field(min_length=2, max_length=200)


class BlockInput(BaseModel):
    blocked: bool
    reason: Optional[str] = Field(default=None, max_length=200)


async def _sum_by_user(coll, match, field):
    out = {}
    async for r in db[coll].aggregate([{"$match": match},
                                       {"$group": {"_id": {"u": "$user_id", "c": "$coin"}, "t": {"$sum": f"${field}"}}}]):
        out.setdefault(r["_id"]["u"], {})[r["_id"]["c"]] = round(r["t"], 8)
    return out


async def _money_flow(ids):
    dep = await _sum_by_user("transactions", {"user_id": {"$in": ids}, "type": "deposit"}, "amount")
    wd = await _sum_by_user("withdrawals", {"user_id": {"$in": ids},
                                            "status": {"$nin": ["rejected", "failed", "canceled"]}}, "amount")
    wag = await _sum_by_user("bets", {"user_id": {"$in": ids}}, "stake")
    for u, v in (await _sum_by_user("casino_games", {"user_id": {"$in": ids}}, "stake")).items():
        for c, t in v.items():
            wag.setdefault(u, {})[c] = round(wag.get(u, {}).get(c, 0) + t, 8)
    return dep, wd, wag


@api_router.get("/admin/users")
async def admin_users(q: Optional[str] = None, skip: int = 0, limit: int = 50, admin: dict = Depends(get_admin_user)):
    flt = {}
    if q and q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        flt = {"$or": [{"name": rx}, {"email": rx}]}
    total = await db.users.count_documents(flt)
    users = await db.users.find(flt, {"password_hash": 0}).sort("created_at", -1).skip(max(0, skip)).limit(min(limit, 200)).to_list(200)
    ids = [str(u["_id"]) for u in users]
    wallets = {w["user_id"]: w.get("balances", {}) async for w in db.wallets.find({"user_id": {"$in": ids}})}
    dep, wd, wag = await _money_flow(ids)
    ref_ids = list({u["referred_by"] for u in users if u.get("referred_by")})
    refs = {str(r["_id"]): r.get("name") or r["email"] async for r in db.users.find(
        {"_id": {"$in": [ObjectId(x) for x in ref_ids if ObjectId.is_valid(x)]}}, {"name": 1, "email": 1})}
    today = datetime.now(timezone.utc).date().isoformat()
    rows = [{"id": uid, "name": u.get("name"), "email": u["email"], "role": u.get("role", "user"),
             "created_at": u.get("created_at"), "blocked": bool(u.get("blocked")),
             "referred_by": refs.get(u.get("referred_by")), "balances": wallets.get(uid, {}),
             "deposits": dep.get(uid, {}), "withdrawals": wd.get(uid, {}), "wagered": wag.get(uid, {})}
            for u, uid in zip(users, ids)]
    return {"users": rows, "total": total,
            "signups_today": await db.users.count_documents({"created_at": {"$gte": today}}),
            "blocked": await db.users.count_documents({"blocked": True})}


async def _admin_target(uid):
    if not ObjectId.is_valid(uid):
        raise HTTPException(404, "User not found")
    u = await db.users.find_one({"_id": ObjectId(uid)})
    if not u:
        raise HTTPException(404, "User not found")
    return u


@api_router.post("/admin/users/{uid}/adjust")
async def admin_adjust(uid: str, body: AdjustInput, admin: dict = Depends(get_admin_user)):
    u = await _admin_target(uid)
    if body.coin not in STARTING_BALANCES:
        raise HTTPException(400, "Unknown coin")
    amt = round(body.amount, 8)
    if amt == 0:
        raise HTTPException(400, "Amount can't be zero")
    await ensure_wallet(uid)
    flt = {"user_id": uid}
    if amt < 0:
        flt[f"balances.{body.coin}"] = {"$gte": -amt}
    res = await db.wallets.update_one(flt, {"$inc": {f"balances.{body.coin}": amt}})
    if not res.modified_count:
        raise HTTPException(400, "Balance can't go below zero")
    await db.transactions.insert_one({"id": str(uuid.uuid4()), "user_id": uid, "type": "adjustment", "coin": body.coin,
                                      "amount": amt, "created_at": now_iso(), "hash": "admin:" + uuid.uuid4().hex[:12]})
    await db.admin_actions.insert_one({"id": str(uuid.uuid4()), "user_id": uid, "user_email": u["email"],
                                       "admin": admin["email"], "action": "adjust", "coin": body.coin, "amount": amt,
                                       "reason": body.reason, "created_at": now_iso()})
    return {"balances": await _balances(uid)}


@api_router.post("/admin/users/{uid}/block")
async def admin_block(uid: str, body: BlockInput, admin: dict = Depends(get_admin_user)):
    u = await _admin_target(uid)
    if uid == admin["id"] or u.get("role") == "admin":
        raise HTTPException(400, "Admin accounts can't be locked")
    await db.users.update_one({"_id": u["_id"]}, {"$set": {"blocked": body.blocked}})
    await db.admin_actions.insert_one({"id": str(uuid.uuid4()), "user_id": uid, "user_email": u["email"],
                                       "admin": admin["email"], "action": "block" if body.blocked else "unblock",
                                       "reason": body.reason, "created_at": now_iso()})
    return {"blocked": body.blocked}


@api_router.get("/admin/users/{uid}/log")
async def admin_user_log(uid: str, admin: dict = Depends(get_admin_user)):
    return {"actions": await db.admin_actions.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(100)}


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[os.environ.get("FRONTEND_URL", "http://localhost:3000"), "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)
