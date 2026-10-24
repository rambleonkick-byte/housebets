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

## Auto-Bet Mode (2026-06)
- `PlayArea` in GameKit: Manual/Auto switch. Auto: number of bets (0 = unlimited), stop on profit, stop on loss (in coin), live Bets + Net profit stats, Start/Stop button, summary toast. Loop awaits each round's animation, 300ms gap; stops on errors (e.g. insufficient balance).
- Wired into Dice, Limbo, Keno, Plinko (each `play()` now resolves `{payout, stake}` after its animation, or null). Controls locked while running. Mines excluded (manual tile picks).
- Verified: Dice 5/5 rounds, Limbo unlimited stopped by stop-on-loss, Keno manual stop, no console errors.

## Auto-Bet Win/Loss Adjust + Mines Auto-Pick (2026-06)
- PlayArea: "On win" / "On loss" → Reset (back to base stake) or Increase by X% of last stake. Base stake restored when auto bet ends. Verified Dice on-loss +100%: 0.01 → 0.02 → 0.04, restored to 0.01.
- Mines now has Manual/Auto. Auto: tap tiles to build a numbered pattern (violet, capped at 25 − mines, Clear button); each round starts a game, reveals the pattern in order (gem/bomb sounds), cashes out if all safe (BigWin), else counts as loss. Works with rounds, stop on profit/loss and win/loss adjust. Verified 3/3 rounds.

## Odds Feed → API-Sports (2026-06)
- New `backend/apisports.py` (key `APISPORTS_KEY` in backend/.env, Free plan 100 req/day per sport). Soccer: v3 football fixtures (yesterday+today) + odds (today, Bet365 id 8, pages 1–2) → moneyline 1X2 + Over/Under 2.5. NBA(12)/NHL(57)/MLB(1)/NFL(1): v1 games by date for status & scores.
- Free plan blocks current-season odds for v1 sports ("try 2022 to 2024"), so US sports are priced from SportsGameOdds when its matching game is available (team-name match). SGO is also kept for player props (merged into matching API-Sports events).
- Cache persisted in Mongo `feed_cache` (soccer 60 min TTL, others 45 min; failures back off 10 min) so restarts don't burn quota. `_fetch_sgo_sequential` now returns API-Sports events (+merges); no-market events are `hidden` from /api/odds but used for settlement. Event ids `as-<sport>-<id>`; bets on old SGO ids won't auto-settle.
- Blackjack: lock-token + guarded save + post-save settle (race fixed, iteration_9 PASS); bj_one_open_hand partial unique index. Wallet "Payment API (pluggable) MOCK" UI removed. Sidebar redesigned (pill tabs, Top Sports card, icons, LIVE badges). House games strip scrollbar hidden.
- Follow-ups (iteration_10): API-Sports prices close at kick-off (markets dropped when state != pre or start passed → bets rejected, no past-posting); upstream errors raise so the last good cache is kept; MatchCard selected state fixed (has() with event_id) and FINAL cards' odds disabled.

## Reverted to SportsGameOdds (2026-06)
- User asked to revert the API-Sports switch. Removed backend/apisports.py, APISPORTS_KEY, and the merge/cache layer; `_fetch_sgo_sequential`, `_find_event` and `/api/odds` are back to the original SGO-only code. Labels back to "SportsGameOdds". Kept unrelated fixes (blackjack race fix, wallet MOCK removal, sidebar redesign, scrollbar, MatchCard selected/FINAL fixes). Mongo `feed_cache` collection is now unused.
- SGO free tier currently returns 429 for most leagues, so /api/odds may be empty until the rate limit resets or the plan is upgraded.

## MMA + League Categories (2026-06)
- Added SGO league `UFC` (group `mma`, label UFC, moneyline only; fighters shown by last name). Sidebar icon Swords.
- `/api/sports` now returns each sport with its `leagues` (from SGO_LEAGUES). Sidebar shows league sub-items (NFL / NCAA Football, NBA / NCAA Basketball) under multi-league sports with counts + live dot; selecting `lg:<ID>` filters by `league_key`. Mobile chips are per league. Verified NFL filter shows 15 cards.

## More Leagues + MMA Method Bets + Apex badge (2026-06)
- Soccer leagues added as categories: Premier League (EPL), La Liga, Champions League, Bundesliga, Serie A, Ligue 1 (+ MLS) — all now accessible on the SGO plan (~105 soccer events).
- UFC markets: Total Rounds (roundsCompleted O/U) and Goes the Distance (wonBy_decision yes/no). Events carry `rounds` (count of `Nr` result periods). Settlement: rounds O/U decided when clear (n ≤ floor(line) → under, n ≥ floor(line)+2 → over), otherwise "push"; distance = "no" if fight ended before R3, otherwise "push" (SGO doesn't report finish method). auto_settle supports pushes: pushed legs drop out of parlays (payout ÷ pushed odds), all-push bets become `void` and refund stake. Cash-out divides out pushed legs. MatchCard renders extra markets generically; My Bets shows "Void · refunded".
- House games badge text "Maxxed" → "Apex" (Casino lobby + strip).
- Cold /api/odds now ~7–8s (14 leagues fetched sequentially to avoid SGO 429s), cached 5 min.

## UFC Event Cards + Progressive Odds (2026-06)
- ESPN UFC scoreboard (free) gives fighter headshots, W-L-D records, flags, weight class and bout order; matched to SGO fights by name (`_enrich_ufc`). ESPN names replace garbled SGO names.
- UFC shows as event cards: a large Main Event at the top ("Featured Bout" if ESPN doesn't mark it as the headliner), then fight-card rows with "To Win" buttons and More markets (rounds/distance).
- `/api/odds?league_key=X` returns one league; the frontend loads every league in parallel and shows each one as it arrives, with shimmer tiles for leagues still loading.

## Boosted Combos (2026-06)
- `GET /api/boosts`: 3 same-game combos built automatically from cached odds (favourite ML + likelier total side + a prop near 2.0, or the spread). Tiers: Bet of the Day +15%, Golden Boost +30%, Boosted Odds +20% on profit: boosted = 1+(base-1)*(1+pct). No stake cap. Each tier and its legs stay locked to the same event until it's gone.
- The homepage strip has countdown cards (hidden 5 min before kick-off) and struck base » boosted odds. Clicking a card loads the slip in boost mode. `POST /api/bets` with `boost_id` checks the legs (409 boost_gone if they don't match) and stores the boosted odds plus boost metadata.
- Global scrollbars restyled: thin, dark, rounded, emerald on hover.

## Backlog
- P0 Crash game · P1 Prop search & filters · P2 HOT tags · Pending: a valid admin email for withdrawal alerts

## Affiliate Program (2026-06)
- Every user gets an affiliate code (6-char hex, can be customized to 4-16 alnum/_-). The referral link /?ref=CODE opens the register form with the code filled in; the code can also be typed in at sign-up (an invalid code returns 400).
- Commission is 10% of NGR (stakes minus payouts) per referred player per coin, from settled sports bets (cashout_amount/payout) and casino_games. A per-player high-water mark in `affiliate_ledger` carries losses forward, with no clawback.
- `GET /api/affiliate` works out new commission whenever the panel loads; `POST /api/affiliate/claim` moves the available balance to the wallet (transaction type "affiliate"); `PUT /api/affiliate/code`; `GET /api/affiliate/check/{code}`.
- The /affiliate page has the code card, stats (referrals, ready to claim, lifetime earned) and a masked players table. A header nav link was added.
- Earnings chart (2026-06): commission now accrues in real time (`_accrue_player` runs after each casino round, bet settlement and cashout), and each increment is logged in `affiliate_earnings` {affiliate_id, player_id, coin, amount, date}. `GET /api/affiliate/daily` returns the last 30 days of commission per coin plus new sign-ups. The /affiliate page shows a recharts chart with green USD bars and a blue sign-ups line. On startup, ledger amounts with no earnings record are backfilled.

## Sports Hero Redesign (2026-06)
- `HeroCarousel.jsx`: "Stadium night lights" carousel. Opens on a welcome slide ("Under the lights. On the line.", a Join now button when signed out, live and market counts), then one featured-match slide each for NFL, NBA, UFC and Football, built from real events (live game first, then the UFC main event, then the earliest game). Slides show team logos (fighter headshots and records for UFC), a countdown or LIVE score, and moneyline odds you can tap to bet, ordered away/draw/home. The slide photo slowly zooms; slides auto-rotate every 6.5s and pause on hover. Arrows, dots with a progress bar and mobile swipe all work.
- `LiveScoresTicker.jsx`: scrolling strip of live scores and upcoming kick-off times (24 games); pauses on hover.

## Odds Speed (2026-06)
- `fetch_sgo_league` now works as stale-while-revalidate. Once the 5-min freshness window passes, it returns the last odds immediately and refreshes them in the background (`_SGO_REFRESHING` stops duplicate refreshes running at once). Odds are saved to `db.odds_cache`, so a server restart loads them straight from the database. If SportsGameOdds fails, the previous odds are kept instead of an empty list. Bet checks (`_find_event`) force a fresh fetch if the saved odds are more than 10 min old.
- League responses went from 2–3.5s (when the cache had expired) to about 0.15–0.2s.

## Admin Players Panel (2026-06)
- The header Admin button now opens /admin (`AdminPanel.jsx`). It shows stats (total users, signed up today, locked accounts), a debounced name/email search, and a table of players: joined date, balance (USD and per coin), deposited, withdrawn, wagered, and status. Pages of 50.
- Clicking a player opens a side panel showing their money in/out and who referred them. You can add or remove balance (a reason is required, and a balance can't go below zero); each change is logged as an "adjustment" transaction and in `admin_actions`. You can also lock or unlock the account (admins can't be locked) and see the change history. The withdrawal queue opens from a button on the panel.
- A locked user gets 403 "Account locked. Contact support." at login and on every signed-in request.
- APIs: GET /api/admin/users, POST /api/admin/users/{id}/adjust, POST /api/admin/users/{id}/block, GET /api/admin/users/{id}/log.

## Link Preview Branding (2026-06)
- index.html now has og:url, og:image (/brand/og-image.png, 1200x630), twitter summary_large_image, application-name, and favicon.ico, icon-512.png and apple-touch-icon.png made from the logo tile. The og URLs point to https://wager-ledger-4.emergent.host; switch them to the custom domain once it is linked.

## 10% Lossback (2026-06)
- Sports bets only. When `auto_settle` marks a bet lost, 10% of the stake (`LOSSBACK_RATE`) goes straight to the wallet as real balance with no cap. The amount is saved as `bets.lossback` and logged as a "lossback" transaction. Affiliate NGR subtracts lossback. Bet history shows a "10% lossback credited" line, and the wallet lists lossback as a plus.
- Lossback toast (2026-06): each lossback saves a "lossback" notification (key lb:{bet_id}). `/wallet/deposit-alerts` now runs `auto_settle` on its 30s sync, so bets settle while the player is browsing, and returns `lossbacks`, each only once. DepositAlerts shows a "10% LOSSBACK +X COIN — You got X COIN back on your losing bet" pop-up, and the notification bell lists it too.

## Bug fix: wrong-coin static deposits (2026-06)
- Prod user lilbabyrollbit@gmail.com sent ~200 USDT (Solana SPL) to their SOL static address and was credited 200.24 SOL (about $30k). `_credit_static_txs` now credits `tx.currency` (uppercased) when it is a supported coin, skips unsupported currencies, falls back to the address coin when currency is missing, and records `address_coin` on static_deposits. Tested 9/9 (iteration_15).
- The PROD balance correction still has to be done by the admin through the panel: remove 200.242908 SOL and add 200.242908 USDT for that user.
- Deposit coin warning (2026-06): each deposit address now has a red "Only send {COIN} to this address" box giving the network and a coin-specific tip (e.g. no USDT to the SOL address). The previous coin's address is cleared when switching coins, so it can't briefly show under the wrong coin.

## Alternate Lines (2026-06)
- SGO is now fetched with includeAltLines=true. `_alt_ladder` builds every line from each bookmaker's main line and alt lines, using the median price. Quarter lines (.25/.75) are skipped. `_smooth` uses the main price wherever a line matches the main market, and clamps prices so an easier line never pays more. The new markets are `alt_spread` (home L mirrors away -L) and `alt_total`.
- Settlement treats alt_spread like spread and alt_total like total. An exact tie on a whole-number line is now a "push" for both main and alt markets.
- Conflict keys map alt_X to X on the backend (`_market_key`) and frontend (`baseKey`), so a main and alt pick on the same market can't be combined. The slip swaps one for the other instead. selId includes the line for alt markets. 409 changed/unavailable entries carry the line.
- Frontend `AltLineSlider.jsx` uses a radix slider plus -/+ step buttons, starts at the main line and shows "Not offered" when a side has no price. GZipMiddleware cut NFL odds from 484KB to 68KB. Tested in iteration_16 and _17 (25/25 backend).

## Tawk.to Live Chat (2026-06)
- The Tawk.to embed script was added before </body> in frontend/index.html, so it loads on every page of the SPA.
- Tawk.to was shrunk to a small headphone button (2026-06). Tawk's default bubble and greeting are hidden via Tawk_API.onLoad/onChatMinimized → hideWidget(). `SupportButton.jsx` is a 44px headphone button (bottom-right; on mobile it sits above the bet slip button) that opens the chat with maximize() and shows the unread count.
- Odds cache versioning (2026-06): saved odds now carry `v: ODDS_CACHE_VERSION` (currently 2). Saved copies with an older version are ignored on load, so they're fetched fresh. After this deploy, odds with a new shape (e.g. alt lines) appear right away instead of after the 5-minute refresh. Bump the version whenever the shape of the odds data changes. Root cause from the deployer RCA: saved copies from before the update were served until they expired.

## Full Player Props (2026-06)
- Bug: `_sgo_props` capped results at 24 props sorted by player name, so only about 2 players appeared. The cap is removed: NBA now has 150–250 props (13–19 players) per game, NFL 60–180 (23–48 players), EPL ~100 (26–48 players). ODDS_CACHE_VERSION was bumped to 3.
- New `PropsSection.jsx`: the header shows the prop count and player count, plus a player/stat search box, stat-group chips (All, Scoring, Passing, Rushing, Receiving, Rebounds, Assists, Defense, Combos, Other; only chips with props are shown), props grouped under each player's name, and a scroll area up to 384px tall.

## USD-Only Wallet (2026-06)
- Balances are now a single USD figure (`STARTING_BALANCES = {"USD": 0}`); `CRYPTO_COINS` lists the deposit and withdrawal coins (BTC, ETH, USDT, SOL). Sports bets, casino games and admin adjustments only accept USD.
- Live prices come from CoinGecko, falling back to Coinbase; USDT is fixed at $1. `_live_rate` returns 503 when prices are unavailable.
- Deposits (static addresses and invoices) are credited as USD at the live price (`amount_usd` and `rate` are stored; transactions carry `crypto_coin`/`crypto_amount`). Withdrawals: the player enters USD (minimum $1) and picks a coin; the USD is reserved, the withdrawal stores the crypto `amount` plus `amount_usd`, and refunds return `amount_usd`.
- `_adjust` converts any non-USD coin to USD as a safety net.
- One-time `_migrate_to_usd` at startup (idempotent, waits for live prices):
  - wallets become {USD} (the old balances are kept in pre_usd_balances);
  - open bets and settled bets/casino games are converted to USD at migration prices (orig_coin and usd_rate kept);
  - active or insurance crypto blackjack/mines games are voided with `open: False` and their stake refunded in USD;
  - pending withdrawals get `amount_usd`; affiliate available and ledger are converted to USD.
- `_player_ngr` is USD-only.
- Frontend: `fmtCrypto(n, "USD")` shows `$x.xx`, and the new `fmtAmt` handles USD and crypto. `Usd` hides itself for USD. The coin selectors were removed from the bet slip, casino games and admin adjust. The wallet modal shows one USD total, keeps the deposit coin tabs, and the withdraw form takes USD with a "You receive ≈ X COIN" estimate. Alerts and notifications use amount_usd. Tested in iterations 18–19 (24/24 backend).

## 2026-06 — Bet settlement fix
- Root cause: settlement only looked at the live odds feed (oddsAvailable=true, limit 15). Finished games drop out of that feed, so their bets never settled, and settlement only ran when the bettor opened the site.
- Fix: results are now looked up directly by event ID (SGO /events?eventIDs=), and a background sweep settles ALL open bets every 3 min. Cancelled games void the leg (stake back on singles).
- Bets with no final result 48h after the game are flagged with needs_review and listed in Admin > "Bets needing review" (with a "Check results now" button). Endpoints: GET /api/admin/bets/review, POST /api/admin/bets/settle-sweep.
- Backlog: Crash game (P0), prop search/filters (P1), HOT tags (P2), verified email inbox for withdrawal alerts.

## 2026-06 — Support tickets replace Tawk.to
- Tawk.to script removed from index.html. Headphones button now opens a ticket panel (logged-out -> login modal).
- Player: create ticket (topic Deposit/Withdrawal/Bet/Casino/Account/Other + message), back-and-forth thread, red dot on button when admin replied (user_unread).
- Admin panel: "Support tickets" section with Open/Closed/All filters, unread badge, reply, close/reopen. Player reply reopens a closed ticket.
- Limits: max 5 open tickets per player, 20 messages / 10 min.
- Endpoints: /api/tickets (GET/POST), /api/tickets/{id} (GET), /api/tickets/{id}/messages (POST), /api/admin/tickets (GET), /api/admin/tickets/{id} (GET), /api/admin/tickets/{id}/messages (POST), /api/admin/tickets/{id}/status (POST). Collection: tickets.
- Tested: iteration_20 (backend 100%, frontend 100%); LOW issues fixed after.

## 2026-06 — Player profiles, VIP ranks, promo codes
- /profile page (header avatar link): net P&L, deposits, withdrawals, total wagered, sportsbook & casino breakdown, bonus/wagering status, free bets.
- VIP ranks copy BetOnline up to Diamond III (Elite & Black removed per user): Bronze 0 → Silver 10K → Gold 50K → Platinum I-III → Diamond I-III (5M). Points = sports stake ×3 + casino stake ×1 (void/cashed-out/free bets excluded). Level-up cash bonus per tier (admin editable, defaults Silver $25 … Diamond III $5K), 1x wagering. Existing players' already-reached tiers are NOT paid retroactively.
- Promo codes (Admin > Promo codes & VIP rewards): free cash, free bet (winnings only, no cash-out, no lossback, void restores token), deposit match (applied to next OxaPay deposit). Max uses, expiry, enable/disable, wagering multiplier.
- Withdrawals blocked while bonus wagering remains.
- Collections: rewards, promo_codes, promo_redemptions, free_bets, settings(vip_bonus).
- Tested: iteration_21 & 22 (backend 100%, frontend 100%).

## 2026-06 — Admin delete account
- Admin user drawer has "Delete account" (confirm dialog). DELETE /api/admin/users/{uid} removes the user and all their data (wallet, bets, casino games, transactions, withdrawals, tickets, rewards, free bets, redemptions, notifications, deposit addresses, affiliate records); admins can't be deleted. Logged in admin_actions.
- Preview DB only has admin@apexodds.io and dhensley727@icloud.com; live test accounts must be removed by the user via this button after redeploy.

## 2026-06 — Admin: player open bets
- Clicking a player in Admin opens the drawer, which now lists their open bets (legs, odds, stake, to-win, free-bet / needs-review tags) and total $ at risk. GET /api/admin/users/{uid}/bets.

## 2026-06 — Manual grading + full player history (admin)
- Player drawer tabs: Open bets (Won/Lost/Void buttons with confirm), Settled bets, Casino games.
- POST /api/admin/bets/{id}/grade {result}: shares _finalize_bet with auto-settlement (lossback on lost, refund on void, free-bet rules); graded_by stored; logged in admin_actions. GET /api/admin/users/{uid}/history.
- Tested: iteration_23 (backend 15/15; UI label fixes applied after).

## 2026-06 — Custom referral links
- Affiliate page shows a shareable link {origin}/?ref=CODE with "Copy link"; affiliates customize their code (4-16 chars).
- Visiting ?ref=CODE saves it (localStorage apex_ref), strips it from the URL and opens sign-up with the code prefilled.
- Old codes keep working: on change, previous code goes to affiliates.old_codes; register/check match code or old_codes; others can't claim an old code.

## 2026-06 — Right sidebar "Open Bets" tab
- Right sidebar (and mobile sheet) has tabs: Bet Slip (n) | Open Bets (n). Open Bets shows at-risk / potential-win totals and clean cards per open bet (legs, odds, stake, to win, cash out + auto cash out). Auto-refreshes every 30s and right after a bet is placed; adding a pick switches back to Bet Slip. Mobile floating button also appears when only open bets exist. Component: OpenBetsPanel.jsx (useOpenBets hook).

## 2026-06 — Live bet tracker
- Open Bets tab: each leg shows status icon (pre clock, winning/losing pulsing dot, hit/lost tick/cross, push), live score line "● LIVE AWAY x – y HOME · clock" or FINAL, and a sliding progress bar for totals & player props (current vs line marker). Polls GET /api/bets/live every 20s (SGO results by event ID, 30s cache, 10-min miss cache).
- Fix: parlays with an already-lost leg now settle as lost immediately instead of waiting for pending legs.
- Tested: backend pytest backend/tests/test_live_bet_tracker.py (11 pass); UI verified via screenshot with a real live soccer game.

## 2026-06 — Branded shareable open bets
- Each open-bet card in the sidebar has the APEX ODDS brand mark and a Share button. Share opens a branded image card (logo, player name, legs with live/final score marks, total odds, stake, to win, site address) with Save image (PNG), native Share (mobile, attaches image) and Copy link (plain site URL, no referral code per user). Component: OpenBetShare.jsx.

## 2026-06 — Winning slip brag
- My Bets (history modal): won bets with payout get "Share my win" → branded share card with big WINNER stamp, green ticks on all legs, Odds / Stake / Paid, and a "+$X PROFIT" banner; Save image / Share / Copy link (plain site). Reuses OpenBetShareModal (status === "won" switches to winner variant).

## 2026-06 — AI video advert (marketing asset)
- 26.4s square 1080x1080 ad: /app/frontend/public/brand/apexodds_ad_1x1.mp4 (served at /brand/apexodds_ad_1x1.mp4). 5 Kling v3 Pro clips (stadium, dunk, phone odds, crypto coins, goal) + Stable Audio 2.5 dramatic trailer music + Anton/Space Grotesk titles + logo end card.
- Sources/scripts: /app/marketing/gen_ad.py (fal via Universal Key), /app/marketing/build_ad.py (PIL titles + ffmpeg edit), clips in /app/marketing/ad/.

## 2026-06 — WELCOME10 free bet advert
- 1080x1080 image /app/frontend/public/brand/welcome10_ad.png (also backend/assets). Background AI-generated (gold $10 chip, stadium), text composited with PIL (script /app/marketing/build_welcome10.py) so wording is exact.
- Download links with attachment header: GET /api/marketing/welcome10.png and /api/marketing/ad.mp4 (MARKETING_FILES whitelist, files in backend/assets).
- NOTE: promo code WELCOME10 must be created in the LIVE admin panel (Free bet, $10).
- PENDING: user asked for admin@apexodds.io inbox in admin panel — awaiting answers (domain ownership/DNS, provider Resend inbound vs SendGrid vs Cloudflare, read/reply).

## 2026-06 — Odds stale: SGO monthly allowance exhausted
- Root cause: SGO Rookie plan monthly entity limit hit (100,116/100,000) → all refreshes 429. User chose to wait for monthly reset.
- Hide stale games: _drop_stale() removes events still 'pre' 15+ min after start or any event 6h+ past start.
- Data saving: adaptive league TTL (_league_ttl: live 5m, starting <3h 15m, quiet 45m); 429 backs off 15 min; settlement sweep every 10 min; results cache 90s and pre-game events not re-fetched until start; live tracker polls every 60s.

## 2026-06 — Beta max win $750
- BETA_MAX_PROFIT = 750 (server.py). Sports: place_bet blocks when potential - stake > $750 (message gives max stake). Bet slip shows red warning with max stake.
- Casino: Limbo & Dice blocked up front if stake*(mult-1) > $750; Plinko, Keno, Mines (cash-out value + cashout), Blackjack payouts capped at stake + $750 (_cap).

## 2026-06 — Admin limit control, per-player limits, bulk delete
- Global max win stored in settings {_id:"max_win", enabled, amount} (default on, $750), 15s cache; Admin card "Max win per bet (all players)" with ON/OFF + amount. GET/PUT /api/admin/limits.
- Per-player override users.max_win (number; 0 = no limit; unset = global) set in drawer (Set / No limit / Default). PUT /api/admin/users/{uid}/max-win. Effective limit via _max_profit(uid); GET /api/limits/me used by bet slip warning.
- Bulk delete: checkboxes + select-all on players table, "Delete N selected" → POST /api/admin/users/bulk-delete {ids} (admins skipped), shared _purge_user.
- Tested: backend pytest backend/tests/test_max_win_limits.py 11/11; UI flows verified via Playwright screenshot run.

- 2026-06: Casino hold change to 90% was requested then cancelled — reverted to original 1% edge and provably-fair wording.
- 2026-06: Small 'BETA' tag added under the APEX ODDS logo in the header (data-testid brand-beta-tag).
- 2026-06: Added UEFA Europa League (SGO UEFA_EUROPA_LEAGUE) to SGO_LEAGUES + hero carousel soccer group. Odds appear once SGO quota resets.
- 2026-06: Europa League odds now come FREE from ESPN's public scoreboard (DraftKings lines: 3-way ML, spread, total; no props). meta 'espn': 'soccer/uefa.europa' → _refresh_espn_league (default + next 10 days, dedupe, TTL 15m/5m live). Event ids 'espn-<id>'; settlement/live tracker via _espn_results (ESPN summary endpoint) inside _fetch_sgo_results. Tested: bet placement + /bets/live.

## 2026-06 Update
- Rebranded bookmaker labels: match cards show "Live Odds · ApexOdds", sidebar says "Live odds from ApexOdds".
- Telegram phone alerts (bot @Apex_odds_bot, TELEGRAM_BOT_TOKEN): pings on new ticket, ticket reply, withdrawal request, deposit. Chat id auto-saved in admin_settings{key:telegram} after admin sends /start; Admin > "Connect / test phone alerts" button (POST /api/admin/telegram/test).
- Telegram swipe-reply: ticket pings stored in db.tg_msgs; _tg_poll_loop (getUpdates, live site only — skipped when FRONTEND_URL has .preview.) posts replies to the ticket as admin and links chat on /start.
- Big win alerts: db.settings{_id:big_win} (default ON, $500 profit). Telegram ping from _record_game (casino) and _finalize_bet (won sportsbook bets). Admin UI AdminBigWin card; GET/PUT /api/admin/big-win.
- Player Vault: wallets.vault (USD, no interest, instant both ways, not withdrawable directly). GET /api/vault, POST /api/vault/{deposit|withdraw}. UI: Wallet modal "Vault" tab (VaultPanel.jsx).
- Admin vault view: /api/admin/users rows include "vault"; shown under balance in player table and as "Vault" row in player drawer.
- NBA & NHL switched to free ESPN odds (SGO out of credits): "espn" path on SGO_LEAGUES entries; _espn_markets now supports no-draw moneylines. To revert, remove the "espn" key from NBA/NHL.
- New SGO key (pro tier, unlimited). All leagues incl. NBA/NHL/Europa back on SportsGameOdds (props restored). ESPN scraper code kept; _espn_results still checks europa/nba/nhl paths for any old espn- bets. To use ESPN for a league again, add "espn": "<sport/league>" to its SGO_LEAGUES entry.
- ESPN odds scraper removed entirely (2026-10). All odds + settlement via SportsGameOdds only. ESPN still used only for UFC fighter photos/records and team logos (CDN).
- Admin Super Boosts: db.manual_boosts {event_id, market, side, odds}; shown first in Boosted Odds strip (tier "super", fixed_odds); bet placed as single at fixed odds. Admin panel "Super Boosts" card lists/removes. Create via POST /api/admin/boosts. CHA ML 2.45 (ATL@CHA 2026-10-23) created.
- Admin Super Boosts create form (search game, pick moneyline/spread/total side, set price > current). Preview test boosts removed.
- Withdrawal reopen: POST /api/admin/withdrawals/{wid}/reopen moves a rejected+refunded withdrawal back to pending_approval, re-reserving amount_usd from player balance (fails if insufficient). Admin withdrawals modal: "Move back to pending" button on rejected items.
- Reopen also works for failed/canceled payouts (refunded=True). Old OxaPay track_id moved to old_track_ids so stale webhooks cannot touch the reopened withdrawal.
- Payment gateway errors now return 400 (not 502) so Cloudflare passes the real OxaPay message through instead of a 520 page. RCA: prod withdrawal bf1a045d ($589 USDT ERC20) rejected by OxaPay invalid_address (contract address 0x7c7A...B553); auto-refunded.
- Tennis added: ATP & WTA leagues (group "tennis", Volleyball icon in sidebar), moneyline / set spread / total sets; player last names used as abbr. Withdraw address check: POST /api/wallet/check-address + enforced in /wallet/withdraw (ERC20 format + eth_getCode contract/smart-wallet check via publicnode RPC, BTC & SOL format); inline warning in Wallet modal disables submit.
- Tennis extra markets: set1_ml/set2_ml (Set Winner), total_games, set1_games, games_spread (from SGO games-* / points-*-1s/2s oddIDs). Finished sets hidden live via status.currentPeriodID. Settled from results Ns.games (_sgo_sets, _set_done → push on retired set). Live percent Super Boosts: manual_boosts.pct → boosted = 1+(live-1)*(1+pct), runs during live games; admin form has @/% toggle (live forces %).
- Sportsbook cash out OFF by default: db.settings{_id:cashout}.enabled (default False). GET/PUT /api/admin/cashout; quotes return enabled:false, cashout & auto-cashout endpoints 403, auto-cashout runner skips. Admin "Sportsbook cash out" toggle card. Mines in-game cashout unaffected.
