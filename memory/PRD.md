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

## Live USD Values (2026-06)
- Backend `GET /api/prices` pulls live BTC/ETH/USDT/SOL USD prices from CoinGecko (free, no key), cached 60s, falls back to static rates if unreachable (`live:false`). `/api/wallet` usd_rates now live.
- Frontend `usePrices()` hook (lib/prices.js, polls 60s) + `<Usd>` component. USD shown in header balance, wallet total (with "Live market prices" indicator), per-coin balances + unit price, recent activity, bet slip (balance/stake/payout), bet history, casino bet panel + history, admin withdrawal queue.

## Pending
- Withdrawal alert email recipient still not set (user to provide later).
- Next: Crash game (solo rounds default), Prop search & filters, Deposit countdown.

## Fee-free Deposits (2026-06)
- OxaPay white-label invoices now use `fee_paid_by_payer: 0` — the merchant absorbs the OxaPay gateway fee; players send exactly the USD-equivalent amount (verified: $50 USDT invoice → pay_amount 50.0).

## Permanent Deposit Addresses (2026-06)
- Replaced expiring USD-amount invoices with OxaPay static addresses: one permanent address per player per coin (`static_addresses` collection, unique user_id+coin), created on first view via `POST /v1/payment/static-address`.
- `GET /api/wallet/deposit-address/{coin}` (get-or-create), `POST /api/wallet/deposit-address/{coin}/check` (polls OxaPay `/payment/{track_id}` txs). Webhook handles `type=static_address`: credits each confirmed tx once (idempotent via unique `static_deposits.tx_hash`), crediting `sent_amount` (fee-free for player).
- Deposit tab: shows QR + permanent address + network, auto-polls every 10s. Verified: same address returned on repeat, signed webhook credited 5 USDT once (duplicate ignored).
- Note: OxaPay revokes static addresses with no transactions for 6 months.

## USDT on Ethereum (2026-06)
- USDT network switched TRC20 → ERC20 (backend + frontend COIN_NETWORK, explorer → Etherscan). Applies to deposits and withdrawals.
- static_addresses now keyed by (user_id, coin, net); old Tron USDT addresses kept (net=TRC20) so any late deposits to them still credit via webhook. New USDT addresses are ERC20 (verified 0x… address, persistent).

## Deposit Notifications (2026-06)
- `GET /api/wallet/deposit-alerts`: syncs the user's static addresses with OxaPay (throttled 30s/user), returns un-notified confirmed deposits from `static_deposits` (notified=false) and marks them notified; returns fresh balances.
- Global `DepositAlerts` component (App.js) polls every 15s while logged in — works on any page, wallet open or not. Shows a custom toast: amount + coin, ≈USD, and the tx hash linking to the right explorer (`explorerUrl` in lib/api.js, USDT by network ERC20/TRC20). Header balance updates instantly.
- Verified: signed webhook for 25 USDT → popup on login with Etherscan link (test data cleaned up).

## Withdrawal Alerts (2026-06)
- `/api/wallet/deposit-alerts` now also returns `withdrawals` alerts. Stages: `sent` (approved & broadcast: processing/confirming), `confirmed`, `refunded` (rejected/failed). Each withdrawal stores `notified_stage`; an alert fires once per stage change. In-flight payouts are synced with OxaPay (throttled 30s/user). Existing withdrawals backfilled at startup.
- Same global poller shows a toast per stage (amber sent / green confirmed / red refunded) with amount, ≈USD and explorer tx link. Verified with seeded confirmed withdrawal (cleaned up).

## Notification Center (2026-06)
- `notifications` collection (unique `key`: dep:<tx_hash> / wd:<id>:<stage>), saved whenever a deposit/withdrawal alert fires. `GET /api/notifications` (latest 50 + unread count), `POST /api/notifications/read-all`. One-time startup backfill from past deposits/withdrawals (marked read).
- Header bell (`NotificationBell.jsx`) with unread badge; popover lists history (icon/tone per stage, amount, time-ago, explorer link). Closing the panel marks all read. Refreshes when the alert poller finds new items. Verified with seeded deposit + withdrawal (cleaned up).

## Bet Slip Redesign (2026-06)
- Slip is now a floating rounded card with the ApexOdds logo, glowing "Bet Slip" title, LIVE badge (when any leg is live), pill Single/Parlay toggle.
- One card per game: full team names "Away vs Home", league · status/time, colored pick pills (totals lime, moneyline emerald, spread sky, props cyan), large odds on the right, SGP badge.
- Footer: big "Combined odds · N selections" panel, coin pills, compact stake row (10/50/MAX), total stake + payout with USD, pill CTA. Selection meta now carries home_name/away_name/status_detail/live (MatchCard).

## Shareable Slips (2026-06)
- `POST /api/slips` (auth) saves selections + mode → short code; `GET /api/slips/{code}` public. Collection `shared_slips`.
- Bet slip "Share" button → ShareSlipModal: ApexOdds-branded slip card, copy link (`/?slip=CODE`), Save image (PNG via html-to-image), native Share (mobile, attaches image when supported).
- Opening a link loads picks into the viewer's slip, re-priced from the live feed (`lib/slips.js` refreshLeg); finished/missing legs dropped with a toast. URL param cleaned after load.
- Known gap: `/api/bets` still trusts client-sent odds — should validate against live feed server-side.

## Server-side Odds Verification (2026-06)
- `/api/bets` no longer trusts client odds. `_verify_selections` looks up each leg in the cached SGO feed (`_find_event`/`_live_price`): market + side + exact line (props: stat+player+line) must exist and the event must not be final. Bet is priced at the server's current odds.
- If live odds are worse than what the player saw → 409 `{msg, changed:[{event_id,market,side,odds}], unavailable:[]}`; missing/finished/line-moved legs → 409 with `unavailable`. Better-or-equal odds are accepted at live price.
- Also: stake must be >0 and finite, ≤20 legs, singles exactly 1 leg, duplicate/conflicting same-market legs rejected, balance deduction is atomic (`$gte` filter) to stop double-spend.
- Frontend: on 409 the slip auto-updates odds / drops unavailable legs (`applyServerPrices`) and warns; singles remove each placed leg as they succeed.
- Verified with in-process test (tampered 50.0 → 409, lower → accepted @1.80, wrong line/fake event → 409, prop ok, conflict/neg/huge stake rejected) + UI 409 flow.

## Odds Change Alerts + Auto-accept Better Odds (2026-06)
- Sportsbook polls odds every 20s; `syncPrices(events)` (BetSlipContext) re-prices slip legs via `refreshLeg`. Moved legs show old odds struck through, arrow + green (up) / red (down) with flash animation.
- "Auto-accept better odds" switch in slip (persisted localStorage `apex_accept_better`, default on). Up-moves auto-accepted when on; down-moves (or any move when off) mark legs pending → amber note + button becomes "Accept odds changes".
- Backend `PlaceBetInput.accept_better` (default true): off → any price difference returns 409; on → only worse prices 409. 409 responses also flag legs pending in the slip. Verified backend matrix + UI flow (mocked feed).

## Cash Out (2026-06)
- `GET /api/bets/cashout-quotes` → live offer per open bet: `potential_payout / Π(current odds of unsettled legs) × 0.95` (CASHOUT_MARGIN). Finished-won legs count as 1.0; any lost leg, missing event or vanished market → null (suspended). Capped at 95% of potential payout.
- `POST /api/bets/{id}/cashout {expected}` re-prices server-side; 409 with new value if it dropped >0.5%; atomic status flip open→cashed_out, credits wallet, `cashout` transaction. auto_settle now only settles if still open (no double pay).
- My Bets modal: Cash out button with live value + USD (refresh 15s), two-tap confirm, "unavailable" state, Cashed out status/filter. Verified backend math (1.8→1.5 single = 1.14; parlay with won leg = 1.71), double-cashout blocked, UI flow with mocks.

## Auto Cash Out (2026-06)
- `POST /api/bets/{id}/auto-cashout {target|null}` sets/clears `bets.auto_cashout` (must be < 95% of potential payout).
- `_run_auto_cashouts()` checks all open bets with a target against live cash-out value and cashes out (`_do_cashout(auto=True)`, `auto_cashed: true`) when value ≥ target. Triggered (throttled 20s) whenever the odds feed or alert poll is hit, plus platform cron backstop `.emergent/crons.yml` → `POST /api/cron/auto-cashout` every 15 min (Bearer `WEBHOOK_CRON_SECRET` in backend/.env, constant-time check, acks immediately).
- Auto cash outs create a `cashout` notification (bell) and a sky-blue pop-up via `/api/wallet/deposit-alerts` → `cashouts` (alerted once).
- UI (My Bets): "Set auto cash out" → target input (prefilled +25%), active target chip with Edit/remove; "Auto cashed out" label. Verified: validation, cron 401s, trigger at 1.368 ≥ 1.3, single alert, UI flow.

## Originals Redesign (2026-06)
- Shared Stake-style kit in `components/casino/GameKit.jsx`: 3D bevelled `TILE` states (idle/picked violet/hit emerald gem/miss red/dim), `PILL_BTN`, `FieldLabel`, `StatBox`, chunky `PlayButton` (emerald/amber), restyled `BetControls` (inline ½ 2× MAX, USD), `GameLayout` (Originals tag, Provably fair badge, glowing board, optional footer) and `BigWin` overlay (multiplier + payout + USD, spring-in, auto-hide 2.6s, click to dismiss; shown only for wins >1×).
- Keno: bevelled tiles, gem hits, red misses, payout table bar highlighting current hits. Mines: 3D tiles with flip reveal, gem/bomb glossy tiles, current/next stats. Dice: win-zone track (green/red), cube handle, floating roll bubble. Limbo: gradient count-up number, recent results strip, target/result chips. Plinko: glowing pegs, animated ball path to the server bucket, heat-map buckets.

## Sound Effects (2026-06)
- `lib/sfx.js`: Web Audio synthesised sounds (no files): click, pick/unpick, bet, draw, hit, gem, bomb (noise burst), peg, tick, lose, win, bigWin (≥5×). Mute stored in localStorage `apex_sfx_muted`, pub/sub for toggles.
- Speaker toggle (`game-sound-toggle`) in every Originals header. Hooked into: coin/stake/option buttons, Play buttons, Keno picks + draw/hit reveal, Mines gem/bomb, Dice slider ticks + lose, Limbo count-up ticks + lose, Plinko peg ticks + landing, BigWin win/bigWin chimes. Verified sounds fire, mute persists across games, no console errors.
