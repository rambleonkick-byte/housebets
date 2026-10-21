import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Ticket, Trash2, X, Loader2, Zap, Share2, ArrowUp, ArrowDown } from "lucide-react";
import { ShareSlipModal } from "@/components/ShareSlipModal";
import { useBetSlip } from "@/context/BetSlipContext";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiErrorDetail, COIN_META } from "@/lib/api";
import { fmtOdds, fmtCrypto, fmtAmt } from "@/lib/format";
import { Usd } from "@/components/Usd";
import { toast } from "sonner";

const COINS = ["USD"];
const SGP_CORRELATION = 0.8;
const PILL = {
  total: "bg-lime-400/10 border-lime-400/25 text-lime-300",
  moneyline: "bg-emerald-400/10 border-emerald-400/25 text-emerald-300",
  spread: "bg-sky-400/10 border-sky-400/25 text-sky-300",
  prop: "bg-cyan-400/10 border-cyan-400/25 text-cyan-300",
};

function groupByGame(items) {
  const map = new Map();
  for (const s of items) {
    if (!map.has(s.event_id)) map.set(s.event_id, []);
    map.get(s.event_id).push(s);
  }
  return [...map.values()];
}

function computeParlayOdds(items) {
  let total = 1;
  for (const legs of groupByGame(items)) {
    const prod = legs.reduce((a, s) => a * s.odds, 1);
    const corr = Math.pow(SGP_CORRELATION, legs.length - 1);
    total *= 1 + (prod - 1) * corr;
  }
  return total;
}

function SlipLogo() {
  return (
    <div className="flex items-center gap-2" data-testid="bet-slip-logo">
      <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center shadow-[0_0_18px_-2px_rgba(16,185,129,0.7)]">
        <Zap size={15} className="text-black" fill="currentColor" />
      </div>
      <div className="leading-none">
        <span className="font-display text-[15px] font-black tracking-tight">APEX</span>
        <span className="font-display text-[15px] font-black tracking-tight text-emerald-400">ODDS</span>
      </div>
    </div>
  );
}

function LegOdds({ s }) {
  const up = s.move === "up";
  const tone = !s.move ? "text-white" : up ? "text-emerald-400" : "text-red-400";
  return (
    <div className="flex flex-col items-end leading-none">
      {s.move && s.prevOdds && (
        <span className="font-mono text-[10px] text-zinc-600 line-through mb-0.5" data-testid={`slip-prev-odds-${s._id}`}>{fmtOdds(s.prevOdds)}</span>
      )}
      <motion.span key={s.movedAt || 0} data-testid={`slip-odds-${s._id}`}
        initial={s.movedAt ? { scale: 1.25, backgroundColor: up ? "rgba(16,185,129,0.35)" : "rgba(239,68,68,0.35)" } : false}
        animate={{ scale: 1, backgroundColor: "rgba(0,0,0,0)" }} transition={{ duration: 0.9 }}
        className={`flex items-center gap-0.5 font-mono text-lg font-bold rounded-md px-1 ${tone}`}>
        {s.move && (up ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}{fmtOdds(s.odds)}
      </motion.span>
    </div>
  );
}

function GameCard({ legs, selId, onRemove }) {
  const head = legs[0];
  const sgp = legs.length > 1;
  const matchup = `${head.away_name || head.away} vs ${head.home_name || head.home}`;
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      data-testid={`slip-game-${head.event_id}`}
      className="bg-gradient-to-b from-[#161924] to-[#12141C] border border-[#232838] rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-[15px] text-white truncate" data-testid={`slip-matchup-${head.event_id}`}>{matchup}</p>
          <p className="text-xs text-zinc-500 truncate mt-0.5">
            {head.league_label}{head.status_detail ? ` · ${head.status_detail}` : ""}
          </p>
        </div>
        {sgp && (
          <span data-testid={`slip-sgp-badge-${head.event_id}`}
            className="shrink-0 text-[9px] font-mono font-bold uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5">
            SGP ×{legs.length}
          </span>
        )}
      </div>
      <div className="mt-3 space-y-2">
        {legs.map((s) => (
          <div key={selId(s)} data-testid={`slip-item-${selId(s)}`} className="group flex items-center justify-between gap-3">
            <span className={`min-w-0 truncate text-[13px] font-semibold border rounded-full px-3.5 py-1.5 ${PILL[s.market] || PILL.moneyline}`}>
              {s.pick}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <LegOdds s={s} />
              <button data-testid={`slip-remove-${selId(s)}`} onClick={() => onRemove(selId(s))} aria-label="Remove"
                className="w-6 h-6 rounded-full flex items-center justify-center text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                <X size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export function BetSlip() {
  const { items, removeSelection, clear, selId, open, setOpen, applyServerPrices, acceptChanges, acceptBetter, setAcceptBetter, boost, setBoost } = useBetSlip();
  const pendingChanges = items.some((s) => s.pending);
  const { user, setAuthOpen, setBalances } = useAuth();
  const [stake, setStake] = useState("");
  const [coin, setCoin] = useState("USD");
  const [mode, setMode] = useState("single");
  useEffect(() => { if (boost) setMode("parlay"); }, [boost]);
  const [loading, setLoading] = useState(false);
  const [share, setShare] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [freeBets, setFreeBets] = useState([]);
  const [freeBet, setFreeBet] = useState(null);
  useEffect(() => {
    if (!user || !items.length) return;
    api.get("/free-bets").then(({ data }) => setFreeBets(data.free_bets)).catch(() => {});
  }, [user, items.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickFreeBet = (fb) => {
    if (freeBet?.id === fb.id) { setFreeBet(null); setStake(""); return; }
    setFreeBet(fb); setStake(String(fb.amount));
  };

  const isParlay = !!boost || (mode === "parlay" && items.length > 1);
  const rawParlay = useMemo(() => computeParlayOdds(items), [items]);
  const parlayOdds = boost ? 1 + (rawParlay - 1) * (1 + boost.pct) : rawParlay;
  const groups = useMemo(() => groupByGame(items), [items]);
  const hasSgp = useMemo(() => groups.some((g) => g.length > 1), [groups]);
  const anyLive = items.some((s) => s.live);
  const stakeNum = parseFloat(stake) || 0;

  const singlePayout = useMemo(() => items.reduce((sum, s) => sum + stakeNum * s.odds, 0), [items, stakeNum]);
  const payout = (isParlay ? stakeNum * parlayOdds : singlePayout) - (freeBet ? stakeNum : 0);
  const totalStake = isParlay ? stakeNum : stakeNum * items.length;
  const bal = user?.balances?.[coin] ?? 0;

  const oddsLabel = boost ? boost.label : isParlay ? "Combined odds" : "Single bets";
  const oddsValue = isParlay ? fmtOdds(parlayOdds) : items.length === 1 ? fmtOdds(items[0].odds) : `×${items.length}`;

  const shareSlip = async () => {
    if (!user) { setAuthOpen(true); return; }
    setSharing(true);
    try {
      const { data } = await api.post("/slips", { selections: items.map(shareSel), mode: isParlay ? "parlay" : "single" });
      setShare({ code: data.code, groups, oddsLabel, oddsValue, count: items.length, by: user.name || "My" });
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally {
      setSharing(false);
    }
  };

  const place = async () => {
    if (!user) { setAuthOpen(true); return; }
    if (stakeNum <= 0) { toast.error("Enter a stake"); return; }
    if (freeBet && !isParlay && items.length > 1) { toast.error("A free bet covers one bet — switch to parlay or keep one pick"); return; }
    if (!freeBet && totalStake > bal) { toast.error("Insufficient balance"); return; }
    setLoading(true);
    try {
      if (isParlay) {
        const { data } = await api.post("/bets", { selections: items.map(stripSel), stake: stakeNum, coin, bet_type: "parlay", accept_better: acceptBetter, boost_id: boost?.id ?? null, free_bet_id: freeBet?.id ?? null });
        setBalances(data.balances);
      } else {
        let lastBal = null;
        for (const s of items) {
          const { data } = await api.post("/bets", { selections: [stripSel(s)], stake: stakeNum, coin, bet_type: "single", accept_better: acceptBetter, free_bet_id: freeBet?.id ?? null });
          lastBal = data.balances;
          setBalances(data.balances);
          removeSelection(selId(s));
        }
        if (lastBal) setBalances(lastBal);
      }
      toast.success(freeBet ? "Free bet placed!" : "Bet placed!");
      if (freeBet) { setFreeBets((l) => l.filter((f) => f.id !== freeBet.id)); setFreeBet(null); }
      clear();
      setStake("");
    } catch (e) {
      const d = e.response?.data?.detail;
      if (e.response?.status === 409 && d?.boost_gone) {
        setBoost(null);
        toast.warning(d.msg, { description: "Your picks are still on the slip at regular odds." });
      } else if (e.response?.status === 409 && d) {
        applyServerPrices(d);
        toast.warning(d.msg, { description: "Your slip has been updated to the latest odds." });
      } else {
        toast.error(formatApiErrorDetail(d));
      }
    } finally {
      setLoading(false);
    }
  };

  const content = (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <SlipLogo />
          <div className="flex items-center gap-1.5">
            {items.length > 0 && (
              <button data-testid="bet-slip-share" onClick={shareSlip} disabled={sharing} aria-label="Share slip"
                className="h-7 px-2.5 rounded-full flex items-center gap-1 text-[11px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors disabled:opacity-60">
                {sharing ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />} Share
              </button>
            )}
            {items.length > 0 && (
              <button data-testid="bet-slip-clear" onClick={clear} aria-label="Clear slip"
                className="w-7 h-7 rounded-full flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                <Trash2 size={14} />
              </button>
            )}
            <button className="lg:hidden w-7 h-7 rounded-full flex items-center justify-center text-zinc-500 hover:text-white" onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-3.5 h-3.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
            <span className="font-display text-lg font-bold tracking-tight">Bet Slip</span>
            <span data-testid="bet-slip-count" className="font-mono text-[11px] text-zinc-400 bg-[#1A1D29] rounded-full px-2 py-0.5">
              {items.length}
            </span>
          </div>
          {anyLive && (
            <span data-testid="bet-slip-live-badge"
              className="text-[11px] font-bold tracking-wide text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 rounded-full px-2.5 py-0.5">
              LIVE
            </span>
          )}
        </div>
        {boost && (
          <div data-testid="bet-slip-boost-banner" className="flex items-center gap-2 text-[11px] font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-full px-3 py-1.5">
            <Zap size={12} fill="currentColor" /> {boost.label} · +{Math.round(boost.pct * 100)}% boost applied
          </div>
        )}
        {items.length > 1 && !boost && (
          <div className="flex gap-1 bg-[#12141C] border border-[#232838] p-1 rounded-full">
            {["single", "parlay"].map((m) => (
              <button key={m} data-testid={`bet-slip-mode-${m}`} onClick={() => setMode(m)}
                className={`flex-1 text-xs font-semibold py-1.5 rounded-full capitalize transition-colors ${
                  mode === m ? "bg-emerald-500 text-black" : "text-zinc-400 hover:text-white"}`}>
                {m}{m === "parlay" ? ` · ${fmtOdds(parlayOdds)}` : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 pb-3 space-y-3">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center h-full py-16 text-zinc-600">
            <Ticket size={32} className="mb-3 opacity-40" />
            <p className="text-sm">Tap any odds to build your slip.</p>
          </div>
        ) : groups.map((legs) => (
          <GameCard key={legs[0].event_id} legs={legs} selId={selId} onRemove={removeSelection} />
        ))}
      </div>

      {items.length > 0 && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          <div data-testid="bet-slip-combined" className="bg-[#12141C] border border-[#232838] rounded-2xl px-4 py-3.5 flex items-center justify-between">
            <div className="leading-tight">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{oddsLabel}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-600">{items.length} selection{items.length > 1 ? "s" : ""}</p>
            </div>
            <div className="text-right leading-none">
              {boost && <p className="font-mono text-xs text-zinc-600 line-through mb-1" data-testid="bet-slip-boost-base">{fmtOdds(rawParlay)}</p>}
              <p className="font-mono text-2xl font-bold text-emerald-400" data-testid="bet-slip-combined-odds">
                {oddsValue}
              </p>
            </div>
          </div>

          <div className={COINS.length > 1 ? "flex gap-1.5" : "hidden"}>
            {COINS.map((c) => (
              <button key={c} data-testid={`bet-slip-coin-${c}`} onClick={() => setCoin(c)}
                className={`flex-1 text-[11px] font-mono font-semibold py-1.5 rounded-full border transition-colors ${
                  coin === c ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-[#232838] text-zinc-500 hover:text-zinc-300"}`}>{c}</button>
            ))}
          </div>

          <div>
            {freeBets.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mb-2" data-testid="bet-slip-free-bets">
                <span className="text-[11px] text-zinc-500 mr-1">Free bets:</span>
                {freeBets.map((fb) => (
                  <button key={fb.id} data-testid={`bet-slip-free-bet-${fb.id}`} onClick={() => pickFreeBet(fb)}
                    className={`text-[11px] font-mono font-bold px-2.5 py-1 rounded-full border transition-colors ${freeBet?.id === fb.id ? "bg-emerald-500 text-black border-emerald-500" : "border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"}`}>
                    ${fb.amount.toFixed(2)}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between mb-1.5 text-[11px]">
              <span className="text-zinc-500">{freeBet ? "Free bet stake · winnings only" : `Stake ${isParlay ? "" : "per bet"}`}</span>
              <span className="font-mono text-zinc-500">
                <span style={{ color: COIN_META[coin].color }}>{fmtAmt(bal, coin)}</span> <Usd amount={bal} coin={coin} prefix="· " />
              </span>
            </div>
            <div className="flex gap-1.5">
              <input data-testid="bet-slip-stake-input" type="number" min="0" value={stake} disabled={!!freeBet}
                onChange={(e) => setStake(e.target.value)} placeholder="0.00"
                className="flex-1 min-w-0 bg-[#090A0F] border border-[#232838] rounded-xl px-3 py-2.5 font-mono text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
              {[10, 50].map((v) => (
                <button key={v} data-testid={`bet-slip-quick-${v}`} disabled={!!freeBet} onClick={() => setStake(String(v))}
                  className="px-2.5 text-[11px] font-mono text-zinc-400 border border-[#232838] rounded-xl hover:border-emerald-500/60 disabled:opacity-40">{v}</button>
              ))}
              <button data-testid="bet-slip-quick-max" disabled={!!freeBet} onClick={() => setStake(String(isParlay ? bal : bal / Math.max(items.length, 1)))}
                className="px-2.5 text-[11px] font-mono font-bold text-emerald-400 border border-emerald-500/40 rounded-xl hover:bg-emerald-500/10 disabled:opacity-40">MAX</button>
            </div>
          </div>

          <div className="flex items-end justify-between">
            <div>
              <p className="text-[11px] text-zinc-500">Total stake</p>
              <p className="font-mono text-sm font-semibold" data-testid="bet-slip-total-stake">{fmtAmt(totalStake, coin)}</p>
              <Usd amount={totalStake} coin={coin} className="text-[10px] text-zinc-600" testId="bet-slip-total-stake-usd" />
            </div>
            <div className="text-right">
              <p className="text-[11px] text-zinc-500">Potential payout</p>
              <p className="font-mono text-sm font-bold text-emerald-400" data-testid="bet-slip-payout">{fmtAmt(payout, coin)}</p>
              <Usd amount={payout} coin={coin} className="text-[10px] text-emerald-400/60" testId="bet-slip-payout-usd" />
            </div>
          </div>
          {isParlay && hasSgp && (
            <p data-testid="bet-slip-sgp-note" className="text-[10px] text-amber-300/80 leading-snug">
              Same-game legs are correlated, so their combined odds are trimmed.
            </p>
          )}

          <div data-testid="bet-slip-accept-better" className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-zinc-400">Auto-accept better odds</span>
            <button type="button" role="switch" aria-checked={acceptBetter} data-testid="bet-slip-accept-better-toggle"
              onClick={() => setAcceptBetter((v) => !v)}
              className={`relative w-9 h-5 rounded-full transition-colors ${acceptBetter ? "bg-emerald-500" : "bg-[#2A2F45]"}`}>
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${acceptBetter ? "translate-x-4" : ""}`} />
            </button>
          </div>

          {pendingChanges && (
            <p data-testid="bet-slip-odds-changed-note" className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
              Odds have changed on your slip. Review the highlighted picks and accept to continue.
            </p>
          )}
          <button data-testid="bet-slip-place-button" onClick={pendingChanges ? acceptChanges : place} disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-3 rounded-full transition-colors disabled:opacity-60 shadow-[0_8px_24px_-8px_rgba(16,185,129,0.6)]">
            {loading && <Loader2 size={16} className="animate-spin" />}
            {pendingChanges ? "Accept odds changes" : user ? (isParlay ? "Place Parlay" : `Place ${items.length} Bet${items.length > 1 ? "s" : ""}`) : "Sign in to bet"}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <ShareSlipModal share={share} onClose={() => setShare(null)} />
      <aside className="hidden lg:flex flex-col w-80 shrink-0 h-[calc(100vh-4rem)] sticky top-16 p-3">
        <div className="flex-1 min-h-0 bg-[#0D0F16] border border-[#1E2234] rounded-3xl overflow-hidden shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)]">
          {content}
        </div>
      </aside>

      {items.length > 0 && (
        <button data-testid="bet-slip-mobile-open" onClick={() => setOpen(true)}
          className="lg:hidden fixed bottom-4 right-4 z-40 flex items-center gap-2 bg-emerald-500 text-black font-bold px-4 py-3 rounded-full shadow-lg">
          <Ticket size={18} /> {items.length}
        </button>
      )}
      <AnimatePresence>
        {open && (
          <motion.div className="lg:hidden fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
            <motion.div className="absolute bottom-0 inset-x-0 h-[85vh] bg-[#0D0F16] border-t border-[#1E2234] rounded-t-3xl overflow-hidden"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 28 }}
              onClick={(e) => e.stopPropagation()}>
              {content}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function stripSel(s) {
  return {
    event_id: s.event_id, league: s.league, league_label: s.league_label,
    home: s.home, away: s.away, market: s.market, pick: s.pick, side: s.side,
    line: s.line ?? null, odds: s.odds,
  };
}

function shareSel(s) {
  return {
    ...stripSel(s), home_name: s.home_name ?? null, away_name: s.away_name ?? null, status_detail: s.status_detail ?? null,
  };
}
