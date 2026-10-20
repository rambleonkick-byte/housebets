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
- Crash game (still "SOON" in casino lobby)
- Admin settlement panel

## Admin Withdrawal Approval Queue (2026-06)
- All withdrawals now require manual admin approval before any crypto is sent (user chose in-app approval; OxaPay has no API flag to force dashboard approval).
- Flow: user requests withdrawal → balance reserved, withdrawal saved as `pending_approval`, NO OxaPay call. Admin reviews queue → Approve submits to OxaPay (`_submit_payout`) and moves to processing→confirmed, or Reject refunds immediately. If OxaPay rejects on approve, it's marked `failed` and auto-refunded.
- Admin endpoints (role=admin only, 403 otherwise): `GET /api/admin/withdrawals[?status=]` (+counts), `POST /api/admin/withdrawals/{id}/approve`, `.../reject`. Admin UI = header "Admin" button → AdminWithdrawalsModal (tabs: Pending/Confirmed/Rejected/All, Approve & send / Reject actions, 15s auto-refresh).
- Withdrawals stored in `withdrawals` collection; wallet activity enrichment + payout tracker now join on `withdraw:<id>`. Status/webhook (`_settle_withdrawal`) refund on failed/rejected/canceled. Verified end-to-end: request→pending, non-admin 403, reject→refund (balance restored), approve→OxaPay submit→fail+refund, admin UI renders queue.

## Prop Settlement + Real Payouts (2026-06)
- Prop bets now settle: `fetch_sgo_league` attaches `player_results` (final per-player stat from each market's `score` field and `results.game`), and `settle_selection` resolves `prop` legs (over/under vs line). Missing stats leave the leg open (best-effort on free tier). Verified via unit test (over/under/missing).
- Same-game parlays can therefore pay out once all legs settle.
- Withdraw-to-address: real OxaPay payouts via `POST /v1/payout` (separate OXAPAY_PAYOUT_API_KEY). Flow reserves balance → calls OxaPay → on reject/unreachable refunds immediately; `GET /api/wallet/payout/status/{track_id}` polls and `POST /api/oxapay/payout/webhook` (HMAC-SHA512 with payout key) auto-refund on failed/rejected/canceled. Frontend withdraw tab collects address + amount + network hint. Verified: valid request authenticated & validated by OxaPay (rejected only for empty merchant balance), balance refunded on rejection.
- Payout Tracker: `GET /api/wallet` enriches each withdrawal/refund transaction with its payout record ({status, tx_hash, refunded, network}). Wallet recent-activity shows a colored status badge (confirmed=green, processing/confirming=amber, failed/refunded=red) and the tx hash as a clickable blockchain-explorer link (TronScan/Etherscan/Solscan/Blockchair). Modal polls pending payouts every 12s for live updates. Verified via seeded confirmed + confirming records.

## Same-Game Parlay (2026-06)
- Bet slip now allows multiple props/markets from one game. Context blocks conflicting sides of the same underlying market (e.g. Over+Under on one prop line).
- Slip groups legs by game with a "SAME GAME ×N" badge.
- SGP odds use a correlation discount (0.80 per extra same-game leg): adj = 1 + (product − 1) × 0.80^(legs−1). Cross-game legs compound normally. Implemented in both frontend (`BetSlip.jsx` computeParlayOdds) and backend (`server.py` compute_parlay_odds, authoritative). Verified: 2.0×1.8 same-game → 3.08, cross-game → 3.60.

## Credentials
- Admin: admin@apexodds.io / admin123
- Test user: player@apexodds.io / player123
