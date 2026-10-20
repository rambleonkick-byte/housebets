# ApexOdds — Crypto Sportsbook (PRD)

## Original Problem Statement
"I need a crypto sportsbook built that sources odds from free sources and also lets me plug in my own payment api."

## User Choices
- Odds source: ESPN public scoreboard API (free, no key)
- Payments: simulated crypto balances + pluggable payment-API config stub
- Auth: JWT email + password (httpOnly cookie)
- Features: browse sports & live odds, bet slip, place bets from crypto balance, bet history, wallet deposit/withdraw
- Visual: modern dark crypto-terminal look (emerald/gold accents)

## Architecture
- Backend: FastAPI + MongoDB (motor). JWT (bcrypt) auth via httpOnly cookie.
  - `/api/auth/*` register/login/logout/me
  - `/api/sports`, `/api/odds` — ESPN fetch + 45s cache, moneyline/spread/total markets, decimal odds
  - `/api/bets` — place (single/parlay), auto-settle on finished ESPN events
  - `/api/wallet` deposit/withdraw (simulated BTC/ETH/USDT/SOL), transactions
  - `/api/payment/config` GET/PUT — pluggable gateway (provider/base/key/mode)
- Frontend: React 19 + Tailwind v4 + framer-motion + sonner. 3-column terminal layout (sidebar / odds feed / bet slip), modals for auth, wallet, history.

## Implemented (2026-06)
- Full auth flow, ESPN live odds (35+ events), interactive bet slip with parlay, simulated crypto wallet, bet history with settlement, pluggable payment config UI. Tested end-to-end: 100% pass.

## Backlog (P1/P2)
- Live score auto-refresh/websocket ticker
- Cashout on open bets
- Prop settlement (props currently stay open; needs player box-score data)
- Crash game (still "SOON" in casino lobby)
- Real payment provider wiring (NOWPayments/Coinbase) when keys provided
- Admin settlement panel

## Same-Game Parlay (2026-06)
- Bet slip now allows multiple props/markets from one game. Context blocks conflicting sides of the same underlying market (e.g. Over+Under on one prop line).
- Slip groups legs by game with a "SAME GAME ×N" badge.
- SGP odds use a correlation discount (0.80 per extra same-game leg): adj = 1 + (product − 1) × 0.80^(legs−1). Cross-game legs compound normally. Implemented in both frontend (`BetSlip.jsx` computeParlayOdds) and backend (`server.py` compute_parlay_odds, authoritative). Verified: 2.0×1.8 same-game → 3.08, cross-game → 3.60.

## Credentials
- Admin: admin@apexodds.io / admin123
- Test user: player@apexodds.io / player123
