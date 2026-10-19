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

STARTING_BALANCES = {"BTC": 0.05, "ETH": 0.8, "USDT": 2500.0, "SOL": 15.0}
COIN_USD = {"BTC": 64000.0, "ETH": 3400.0, "USDT": 1.0, "SOL": 150.0}

# ----------------------------------------------------------------------------
# Models
# ----------------------------------------------------------------------------
class RegisterInput(BaseModel):
    name: str
    email: EmailStr
    password: str = Field(min_length=6)


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class Selection(BaseModel):
    event_id: str
    league: str
    league_label: str
    home: str
    away: str
    market: str          # moneyline | spread | total
    pick: str            # label shown, e.g. "LAL ML", "Over 210.5"
    side: str            # home | away | draw | over | under
    line: Optional[float] = None
    odds: float          # decimal odds


class PlaceBetInput(BaseModel):
    selections: List[Selection]
    stake: float
    coin: str
    bet_type: str = "single"   # single | parlay


class WalletTxInput(BaseModel):
    coin: str
    amount: float


class PaymentConfigInput(BaseModel):
    provider: str
    api_base: str = ""
    api_key: str = ""
    mode: str = "mock"   # mock | live


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


# ----------------------------------------------------------------------------
# Auth routes
# ----------------------------------------------------------------------------
@api_router.post("/auth/register")
async def register(body: RegisterInput, response: Response):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    doc = {"name": body.name, "email": email, "password_hash": hash_password(body.password),
           "role": "user", "created_at": now_iso()}
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
# ESPN odds
# ----------------------------------------------------------------------------
# group = sidebar category | label = specific competition | sport/league = ESPN path
SPORTS = [
    # Basketball
    {"key": "nba", "group": "basketball", "label": "NBA", "sport": "basketball", "league": "nba", "draw": False},
    {"key": "wnba", "group": "basketball", "label": "WNBA", "sport": "basketball", "league": "wnba", "draw": False},
    {"key": "ncaam", "group": "basketball", "label": "NCAA Men's", "sport": "basketball", "league": "mens-college-basketball", "draw": False},
    {"key": "ncaaw", "group": "basketball", "label": "NCAA Women's", "sport": "basketball", "league": "womens-college-basketball", "draw": False},
    {"key": "nbl", "group": "basketball", "label": "NBL Australia", "sport": "basketball", "league": "nbl", "draw": False},
    # American Football
    {"key": "nfl", "group": "football", "label": "NFL", "sport": "football", "league": "nfl", "draw": False},
    {"key": "ncaaf", "group": "football", "label": "NCAA Football", "sport": "football", "league": "college-football", "draw": False},
    # Baseball
    {"key": "mlb", "group": "baseball", "label": "MLB", "sport": "baseball", "league": "mlb", "draw": False},
    {"key": "collegebb", "group": "baseball", "label": "College Baseball", "sport": "baseball", "league": "college-baseball", "draw": False},
    # Hockey
    {"key": "nhl", "group": "hockey", "label": "NHL", "sport": "hockey", "league": "nhl", "draw": False},
    # Soccer
    {"key": "eng.1", "group": "soccer", "label": "Premier League", "sport": "soccer", "league": "eng.1", "draw": True},
    {"key": "eng.2", "group": "soccer", "label": "Championship", "sport": "soccer", "league": "eng.2", "draw": True},
    {"key": "esp.1", "group": "soccer", "label": "La Liga", "sport": "soccer", "league": "esp.1", "draw": True},
    {"key": "ita.1", "group": "soccer", "label": "Serie A", "sport": "soccer", "league": "ita.1", "draw": True},
    {"key": "ger.1", "group": "soccer", "label": "Bundesliga", "sport": "soccer", "league": "ger.1", "draw": True},
    {"key": "fra.1", "group": "soccer", "label": "Ligue 1", "sport": "soccer", "league": "fra.1", "draw": True},
    {"key": "ned.1", "group": "soccer", "label": "Eredivisie", "sport": "soccer", "league": "ned.1", "draw": True},
    {"key": "por.1", "group": "soccer", "label": "Primeira Liga", "sport": "soccer", "league": "por.1", "draw": True},
    {"key": "usa.1", "group": "soccer", "label": "MLS", "sport": "soccer", "league": "usa.1", "draw": True},
    {"key": "mex.1", "group": "soccer", "label": "Liga MX", "sport": "soccer", "league": "mex.1", "draw": True},
    {"key": "uefa.champions", "group": "soccer", "label": "Champions League", "sport": "soccer", "league": "uefa.champions", "draw": True},
    {"key": "uefa.europa", "group": "soccer", "label": "Europa League", "sport": "soccer", "league": "uefa.europa", "draw": True},
    {"key": "sau.1", "group": "soccer", "label": "Saudi Pro League", "sport": "soccer", "league": "ksa.1", "draw": True},
    {"key": "tur.1", "group": "soccer", "label": "Süper Lig", "sport": "soccer", "league": "tur.1", "draw": True},
    # Tennis
    {"key": "atp", "group": "tennis", "label": "ATP Tour", "sport": "tennis", "league": "atp", "draw": False},
    {"key": "wta", "group": "tennis", "label": "WTA Tour", "sport": "tennis", "league": "wta", "draw": False},
]
SPORTS_BY_KEY = {s["key"]: s for s in SPORTS}

GROUPS = [
    {"key": "soccer", "label": "Soccer", "icon": "goal"},
    {"key": "basketball", "label": "Basketball", "icon": "dribbble"},
    {"key": "football", "label": "Am. Football", "icon": "shield"},
    {"key": "baseball", "label": "Baseball", "icon": "circle-dot"},
    {"key": "hockey", "label": "Ice Hockey", "icon": "snowflake"},
    {"key": "tennis", "label": "Tennis", "icon": "circle"},
    {"key": "mma", "label": "UFC / MMA", "icon": "swords"},
]

# The Odds API (real bookmaker odds). Curated keys; cached long to respect quota.
ODDS_API_KEY = os.environ.get("ODDS_API_KEY")
OA_SPORTS = [
    {"key": "soccer_epl", "group": "soccer", "label": "Premier League", "draw": True},
    {"key": "soccer_uefa_champs_league", "group": "soccer", "label": "Champions League", "draw": True},
    {"key": "basketball_nba", "group": "basketball", "label": "NBA", "draw": False},
    {"key": "americanfootball_nfl", "group": "football", "label": "NFL", "draw": False},
    {"key": "baseball_mlb", "group": "baseball", "label": "MLB", "draw": False},
    {"key": "icehockey_nhl", "group": "hockey", "label": "NHL", "draw": False},
    {"key": "mma_mixed_martial_arts", "group": "mma", "label": "UFC / MMA", "draw": False},
]
_OA_CACHE = {}


def _abbr(name):
    name = (name or "").strip()
    parts = [p for p in name.split() if p]
    if len(parts) >= 2:
        return "".join(p[0] for p in parts[:3]).upper()
    return name[:3].upper() or "TBD"

_ODDS_CACHE: dict = {}


def american_to_decimal(ml) -> Optional[float]:
    try:
        ml = float(ml)
    except (TypeError, ValueError):
        return None
    if ml == 0:
        return None
    return round(1 + (ml / 100.0 if ml > 0 else 100.0 / abs(ml)), 2)


def mk_odds(dec):
    return dec if dec and dec > 1.0 else None


def build_markets(sport_meta, comp, odds_block):
    """Return list of markets with selections."""
    draw = sport_meta["draw"]
    markets = []
    home_dec = away_dec = None
    spread = over_under = None
    if odds_block:
        spread = odds_block.get("spread")
        over_under = odds_block.get("overUnder")
        hto = odds_block.get("homeTeamOdds") or {}
        ato = odds_block.get("awayTeamOdds") or {}
        home_dec = american_to_decimal(hto.get("moneyLine"))
        away_dec = american_to_decimal(ato.get("moneyLine"))

    # fallback moneyline from spread heuristic
    if home_dec is None or away_dec is None:
        if spread is not None:
            try:
                s = abs(float(spread))
                fav = max(1.25, round(1.9 - s * 0.05, 2))
                dog = round(1.0 + (1.0 / (1 - 1.0 / fav)) - fav + 0.15 + s * 0.08, 2)
                dog = max(1.6, min(dog, 6.0))
                if float(spread) < 0:  # home favored
                    home_dec, away_dec = fav, dog
                else:
                    home_dec, away_dec = dog, fav
            except (TypeError, ValueError):
                pass
    if home_dec is None:
        home_dec = 1.9
    if away_dec is None:
        away_dec = 1.9

    ml_sel = [
        {"side": "home", "pick": f"{sport_meta['label_home']} ML", "odds": home_dec, "line": None},
    ]
    if draw:
        ml_sel.append({"side": "draw", "pick": "Draw", "odds": 3.3, "line": None})
    ml_sel.append({"side": "away", "pick": f"{sport_meta['label_away']} ML", "odds": away_dec, "line": None})
    markets.append({"market": "moneyline", "label": "Moneyline", "selections": ml_sel})

    if spread is not None:
        try:
            sp = float(spread)
            markets.append({"market": "spread", "label": "Spread", "selections": [
                {"side": "home", "pick": f"{sport_meta['label_home']} {sp:+g}", "odds": 1.91, "line": sp},
                {"side": "away", "pick": f"{sport_meta['label_away']} {-sp:+g}", "odds": 1.91, "line": -sp},
            ]})
        except (TypeError, ValueError):
            pass
    if over_under is not None:
        try:
            ou = float(over_under)
            markets.append({"market": "total", "label": "Total", "selections": [
                {"side": "over", "pick": f"Over {ou}", "odds": 1.91, "line": ou},
                {"side": "under", "pick": f"Under {ou}", "odds": 1.91, "line": ou},
            ]})
        except (TypeError, ValueError):
            pass
    return markets


async def fetch_league_events(sport_meta) -> List[dict]:
    key = sport_meta["key"]
    cached = _ODDS_CACHE.get(key)
    if cached and (datetime.now(timezone.utc).timestamp() - cached["ts"]) < 45:
        return cached["data"]
    url = (f"https://site.api.espn.com/apis/site/v2/sports/"
           f"{sport_meta['sport']}/{sport_meta['league']}/scoreboard")
    events = []
    try:
        async with httpx.AsyncClient(timeout=10) as hc:
            r = await hc.get(url)
            data = r.json()
        for ev in data.get("events", [])[:14]:
            comp = (ev.get("competitions") or [{}])[0]
            competitors = comp.get("competitors", [])
            home = next((c for c in competitors if c.get("homeAway") == "home"), None)
            away = next((c for c in competitors if c.get("homeAway") == "away"), None)
            if not home or not away:
                continue
            h_team = home.get("team", {})
            a_team = away.get("team", {})
            status = ev.get("status", {}).get("type", {})
            odds_block = (comp.get("odds") or [None])[0]
            meta = dict(sport_meta)
            meta["label_home"] = h_team.get("abbreviation") or h_team.get("shortDisplayName", "HOME")
            meta["label_away"] = a_team.get("abbreviation") or a_team.get("shortDisplayName", "AWAY")
            events.append({
                "event_id": ev.get("id"),
                "league": sport_meta["group"],
                "league_key": sport_meta["key"],
                "league_label": sport_meta["label"],
                "name": ev.get("shortName") or ev.get("name"),
                "start": ev.get("date"),
                "state": status.get("state", "pre"),     # pre | in | post
                "status_detail": status.get("shortDetail", ""),
                "home": {"name": h_team.get("displayName"), "abbr": meta["label_home"],
                         "logo": (h_team.get("logo") or ""), "score": home.get("score")},
                "away": {"name": a_team.get("displayName"), "abbr": meta["label_away"],
                         "logo": (a_team.get("logo") or ""), "score": away.get("score")},
                "markets": build_markets(meta, comp, odds_block),
            })
    except Exception as e:
        logger.warning(f"ESPN fetch failed for {key}: {e}")
    _ODDS_CACHE[key] = {"ts": datetime.now(timezone.utc).timestamp(), "data": events}
    return events


def _oa_markets(bk, meta):
    """Build our market format from one Odds-API bookmaker block."""
    by_key = {m["key"]: m for m in bk.get("markets", [])}
    home_name, away_name = meta["_home"], meta["_away"]
    ha, aa = _abbr(home_name), _abbr(away_name)
    markets = []
    h2h = by_key.get("h2h")
    if h2h:
        sel = []
        for o in h2h.get("outcomes", []):
            price = o.get("price")
            if not price or price <= 1:
                continue
            if o["name"] == home_name:
                sel.append({"side": "home", "pick": f"{ha} ML", "odds": round(price, 2), "line": None})
            elif o["name"] == away_name:
                sel.append({"side": "away", "pick": f"{aa} ML", "odds": round(price, 2), "line": None})
            else:
                sel.append({"side": "draw", "pick": "Draw", "odds": round(price, 2), "line": None})
        order = {"home": 0, "draw": 1, "away": 2}
        sel.sort(key=lambda s: order.get(s["side"], 9))
        if sel:
            markets.append({"market": "moneyline", "label": "Moneyline", "selections": sel})
    sp = by_key.get("spreads")
    if sp:
        sel = []
        for o in sp.get("outcomes", []):
            price, pt = o.get("price"), o.get("point")
            if not price or pt is None:
                continue
            if o["name"] == home_name:
                sel.append({"side": "home", "pick": f"{ha} {pt:+g}", "odds": round(price, 2), "line": pt})
            elif o["name"] == away_name:
                sel.append({"side": "away", "pick": f"{aa} {pt:+g}", "odds": round(price, 2), "line": pt})
        if len(sel) == 2:
            markets.append({"market": "spread", "label": "Spread", "selections": sel})
    tot = by_key.get("totals")
    if tot:
        sel = []
        for o in tot.get("outcomes", []):
            price, pt = o.get("price"), o.get("point")
            if not price or pt is None:
                continue
            side = "over" if o["name"].lower() == "over" else "under"
            sel.append({"side": side, "pick": f"{o['name']} {pt}", "odds": round(price, 2), "line": pt})
        if len(sel) == 2:
            markets.append({"market": "total", "label": "Total", "selections": sel})
    return markets


async def fetch_oddsapi_sport(meta):
    if not ODDS_API_KEY:
        return []
    key = meta["key"]
    cached = _OA_CACHE.get(key)
    if cached and (datetime.now(timezone.utc).timestamp() - cached["ts"]) < 900:
        return cached["data"]
    url = f"https://api.the-odds-api.com/v4/sports/{key}/odds"
    params = {"apiKey": ODDS_API_KEY, "regions": "us", "markets": "h2h,spreads,totals",
              "oddsFormat": "decimal", "dateFormat": "iso"}
    events = []
    try:
        async with httpx.AsyncClient(timeout=12) as hc:
            r = await hc.get(url, params=params)
        if r.status_code != 200:
            logger.warning(f"OddsAPI {key} -> {r.status_code}: {r.text[:120]}")
            _OA_CACHE[key] = {"ts": datetime.now(timezone.utc).timestamp(), "data": []}
            return []
        logger.info(f"OddsAPI {key} remaining={r.headers.get('x-requests-remaining')}")
        now = datetime.now(timezone.utc)
        for ev in r.json()[:12]:
            bks = ev.get("bookmakers") or []
            if not bks:
                continue
            bk = next((b for b in bks if any(m["key"] == "h2h" for m in b.get("markets", []))), bks[0])
            m2 = dict(meta); m2["_home"] = ev["home_team"]; m2["_away"] = ev["away_team"]
            markets = _oa_markets(bk, m2)
            if not markets:
                continue
            try:
                ct = datetime.fromisoformat(ev["commence_time"].replace("Z", "+00:00"))
                state = "in" if ct <= now else "pre"
                detail = "Live" if state == "in" else ct.strftime("%b %d, %H:%M UTC")
            except Exception:
                state, detail = "pre", ""
            events.append({
                "event_id": f"oa_{ev['id']}", "league": meta["group"], "league_key": key,
                "league_label": meta["label"], "name": f"{_abbr(ev['away_team'])} @ {_abbr(ev['home_team'])}",
                "start": ev.get("commence_time"), "state": state, "status_detail": detail,
                "home": {"name": ev["home_team"], "abbr": _abbr(ev["home_team"]), "logo": "", "score": None},
                "away": {"name": ev["away_team"], "abbr": _abbr(ev["away_team"]), "logo": "", "score": None},
                "markets": markets, "source": "oddsapi", "book": bk.get("title", "Sportsbook"),
            })
    except Exception as e:
        logger.warning(f"OddsAPI fetch failed for {key}: {e}")
    _OA_CACHE[key] = {"ts": datetime.now(timezone.utc).timestamp(), "data": events}
    return events


@api_router.get("/sports")
async def list_sports():
    return GROUPS


@api_router.get("/odds")
async def get_odds(league: Optional[str] = None):
    metas = [s for s in SPORTS if s["group"] == league] if league else SPORTS
    oa_metas = [s for s in OA_SPORTS if s["group"] == league] if league else OA_SPORTS
    tasks = [fetch_league_events(m) for m in metas] + [fetch_oddsapi_sport(m) for m in oa_metas]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    out = []
    for r in results:
        if isinstance(r, list):
            out.extend(r)
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
    return {"balances": wallet["balances"], "usd_rates": COIN_USD, "transactions": txs}


@api_router.post("/wallet/deposit")
async def deposit(body: WalletTxInput, user: dict = Depends(get_current_user)):
    if body.coin not in STARTING_BALANCES or body.amount <= 0:
        raise HTTPException(status_code=400, detail="Invalid deposit")
    await ensure_wallet(user["id"])
    await db.wallets.update_one({"user_id": user["id"]},
                                {"$inc": {f"balances.{body.coin}": body.amount}})
    tx = {"id": str(uuid.uuid4()), "user_id": user["id"], "type": "deposit",
          "coin": body.coin, "amount": body.amount, "created_at": now_iso(),
          "hash": "0x" + uuid.uuid4().hex[:24]}
    await db.transactions.insert_one(dict(tx))
    wallet = await db.wallets.find_one({"user_id": user["id"]}, {"_id": 0})
    return {"balances": wallet["balances"], "transaction": tx}


@api_router.post("/wallet/withdraw")
async def withdraw(body: WalletTxInput, user: dict = Depends(get_current_user)):
    await ensure_wallet(user["id"])
    wallet = await db.wallets.find_one({"user_id": user["id"]})
    if body.coin not in STARTING_BALANCES or body.amount <= 0:
        raise HTTPException(status_code=400, detail="Invalid withdrawal")
    if wallet["balances"].get(body.coin, 0) < body.amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")
    await db.wallets.update_one({"user_id": user["id"]},
                                {"$inc": {f"balances.{body.coin}": -body.amount}})
    tx = {"id": str(uuid.uuid4()), "user_id": user["id"], "type": "withdraw",
          "coin": body.coin, "amount": body.amount, "created_at": now_iso(),
          "hash": "0x" + uuid.uuid4().hex[:24]}
    await db.transactions.insert_one(dict(tx))
    wallet = await db.wallets.find_one({"user_id": user["id"]}, {"_id": 0})
    return {"balances": wallet["balances"], "transaction": tx}


# ----------------------------------------------------------------------------
# OxaPay — real crypto deposits
# ----------------------------------------------------------------------------
OXAPAY_KEY = os.environ.get("OXAPAY_MERCHANT_API_KEY")
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
        "amount": body.amount, "currency": body.coin, "lifetime": 60, "fee_paid_by_payer": 1,
        "callback_url": f"{base}/api/oxapay/webhook", "return_url": f"{base}/casino",
        "order_id": order_id, "description": f"ApexOdds deposit ({body.coin})",
    }
    try:
        async with httpx.AsyncClient(timeout=20) as hc:
            r = await hc.post(f"{OXAPAY_API}/payment/invoice", json=payload,
                              headers={"merchant_api_key": OXAPAY_KEY, "Content-Type": "application/json"})
        result = r.json()
    except Exception as e:
        logger.warning(f"OxaPay invoice error: {e}")
        raise HTTPException(status_code=502, detail="Payment gateway unreachable")
    if r.status_code >= 400 or result.get("status") != 200:
        logger.warning(f"OxaPay invoice rejected: {r.status_code} {result}")
        raise HTTPException(status_code=502, detail=result.get("message") or "Gateway error creating invoice")
    data = result["data"]
    await db.oxa_invoices.insert_one({
        "order_id": order_id, "user_id": user["id"], "coin": body.coin, "amount": body.amount,
        "status": "pending", "credited": False, "track_id": str(data["track_id"]),
        "payment_url": data["payment_url"], "created_at": now_iso()})
    return {"order_id": order_id, "track_id": str(data["track_id"]), "payment_url": data["payment_url"]}


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
    if track_id:
        await _credit_oxa_invoice(str(track_id), event.get("status", ""))
    return "ok"


# ----------------------------------------------------------------------------
# Bets
# ----------------------------------------------------------------------------
@api_router.post("/bets")
async def place_bet(body: PlaceBetInput, user: dict = Depends(get_current_user)):
    if not body.selections:
        raise HTTPException(status_code=400, detail="No selections")
    if body.coin not in STARTING_BALANCES:
        raise HTTPException(status_code=400, detail="Invalid coin")
    await ensure_wallet(user["id"])
    wallet = await db.wallets.find_one({"user_id": user["id"]})
    if wallet["balances"].get(body.coin, 0) < body.stake:
        raise HTTPException(status_code=400, detail="Insufficient balance")

    combined = 1.0
    for s in body.selections:
        combined *= s.odds
    is_parlay = body.bet_type == "parlay" and len(body.selections) > 1
    total_odds = round(combined, 2) if is_parlay else round(body.selections[0].odds, 2)
    potential = round(body.stake * total_odds, 6)

    await db.wallets.update_one({"user_id": user["id"]},
                                {"$inc": {f"balances.{body.coin}": -body.stake}})
    bet = {"id": str(uuid.uuid4()), "user_id": user["id"],
           "selections": [s.model_dump() for s in body.selections],
           "bet_type": "parlay" if is_parlay else "single",
           "stake": body.stake, "coin": body.coin, "total_odds": total_odds,
           "potential_payout": potential, "status": "open",
           "created_at": now_iso()}
    await db.bets.insert_one(dict(bet))
    await db.transactions.insert_one({"id": str(uuid.uuid4()), "user_id": user["id"],
                                      "type": "bet", "coin": body.coin, "amount": body.stake,
                                      "created_at": now_iso(), "hash": "0x" + uuid.uuid4().hex[:24]})
    wallet = await db.wallets.find_one({"user_id": user["id"]}, {"_id": 0})
    return {"bet": bet, "balances": wallet["balances"]}


def settle_selection(sel, ev) -> Optional[bool]:
    """Return True=win, False=loss, None=unknown/push for a finished event."""
    try:
        hs = int(ev["home"]["score"])
        as_ = int(ev["away"]["score"])
    except (TypeError, ValueError):
        return None
    m, side, line = sel["market"], sel["side"], sel.get("line")
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


async def auto_settle(user_id: str):
    open_bets = await db.bets.find({"user_id": user_id, "status": "open"}).to_list(200)
    if not open_bets:
        return
    # fetch finished events across all leagues (cached), map by event_id
    results = await asyncio.gather(*[fetch_league_events(m) for m in SPORTS], return_exceptions=True)
    finished = {}
    for r in results:
        if isinstance(r, list):
            for ev in r:
                if ev["state"] == "post":
                    finished[ev["event_id"]] = ev
    for b in open_bets:
        results = []
        for s in b["selections"]:
            ev = finished.get(s["event_id"])
            results.append(settle_selection(s, ev) if ev else None)
        if any(r is None for r in results):
            continue  # not all legs decided
        won = all(results)
        new_status = "won" if won else "lost"
        update = {"status": new_status, "settled_at": now_iso()}
        await db.bets.update_one({"id": b["id"]}, {"$set": update})
        if won:
            await db.wallets.update_one({"user_id": user_id},
                                        {"$inc": {f"balances.{b['coin']}": b["potential_payout"]}})
            await db.transactions.insert_one({"id": str(uuid.uuid4()), "user_id": user_id,
                                              "type": "payout", "coin": b["coin"],
                                              "amount": b["potential_payout"], "created_at": now_iso(),
                                              "hash": "0x" + uuid.uuid4().hex[:24]})


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


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[os.environ.get("FRONTEND_URL", "http://localhost:3000"), "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)
