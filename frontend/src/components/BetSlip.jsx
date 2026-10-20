import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Ticket, Trash2, X, Loader2 } from "lucide-react";
import { useBetSlip } from "@/context/BetSlipContext";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiErrorDetail, COIN_META } from "@/lib/api";
import { fmtOdds, fmtCrypto } from "@/lib/format";
import { Usd } from "@/components/Usd";
import { toast } from "sonner";

const COINS = ["USDT", "BTC", "ETH", "SOL"];
const SGP_CORRELATION = 0.8;

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

export function BetSlip() {
  const { items, removeSelection, clear, selId, open, setOpen } = useBetSlip();
  const { user, setAuthOpen, setBalances } = useAuth();
  const [stake, setStake] = useState("");
  const [coin, setCoin] = useState("USDT");
  const [mode, setMode] = useState("single");
  const [loading, setLoading] = useState(false);

  const isParlay = mode === "parlay" && items.length > 1;
  const parlayOdds = useMemo(() => computeParlayOdds(items), [items]);
  const groups = useMemo(() => groupByGame(items), [items]);
  const hasSgp = useMemo(() => groups.some((g) => g.length > 1), [groups]);
  const stakeNum = parseFloat(stake) || 0;

  const singlePayout = useMemo(
    () => items.reduce((sum, s) => sum + stakeNum * s.odds, 0),
    [items, stakeNum]
  );
  const payout = isParlay ? stakeNum * parlayOdds : singlePayout;
  const totalStake = isParlay ? stakeNum : stakeNum * items.length;
  const bal = user?.balances?.[coin] ?? 0;

  const place = async () => {
    if (!user) { setAuthOpen(true); return; }
    if (stakeNum <= 0) { toast.error("Enter a stake"); return; }
    if (totalStake > bal) { toast.error("Insufficient balance"); return; }
    setLoading(true);
    try {
      if (isParlay) {
        const { data } = await api.post("/bets", {
          selections: items.map(stripSel), stake: stakeNum, coin, bet_type: "parlay",
        });
        setBalances(data.balances);
      } else {
        let lastBal = null;
        for (const s of items) {
          const { data } = await api.post("/bets", {
            selections: [stripSel(s)], stake: stakeNum, coin, bet_type: "single",
          });
          lastBal = data.balances;
        }
        if (lastBal) setBalances(lastBal);
      }
      toast.success("Bet placed!");
      clear();
      setStake("");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  const content = (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A2F45]">
        <div className="flex items-center gap-2">
          <Ticket size={16} className="text-emerald-400" />
          <span className="font-display font-bold tracking-tight">Bet Slip</span>
          <span data-testid="bet-slip-count" className="font-mono text-xs bg-emerald-500/20 text-emerald-300 rounded px-1.5 py-0.5">
            {items.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <button data-testid="bet-slip-clear" onClick={clear} className="text-zinc-500 hover:text-red-400 transition-colors">
              <Trash2 size={15} />
            </button>
          )}
          <button className="lg:hidden text-zinc-500 hover:text-white" onClick={() => setOpen(false)}>
            <X size={18} />
          </button>
        </div>
      </div>

      {items.length > 1 && (
        <div className="flex gap-1 p-2 border-b border-[#2A2F45]">
          {["single", "parlay"].map((m) => (
            <button key={m} data-testid={`bet-slip-mode-${m}`} onClick={() => setMode(m)}
              className={`flex-1 text-xs font-medium py-1.5 rounded-md capitalize transition-colors ${
                mode === m ? "bg-emerald-500 text-black" : "text-zinc-400 hover:text-white"
              }`}>
              {m}{m === "parlay" ? ` ×${fmtOdds(parlayOdds)}` : ""}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center h-full py-16 text-zinc-600">
            <Ticket size={32} className="mb-3 opacity-40" />
            <p className="text-sm">Tap any odds to build your slip.</p>
          </div>
        ) : (
          groups.map((legs) => {
            const sgp = legs.length > 1;
            const head = legs[0];
            return (
              <div key={head.event_id} data-testid={`slip-game-${head.event_id}`} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 px-0.5">
                  <p className="text-[11px] text-zinc-500 truncate">{head.away} @ {head.home} · {head.league_label}</p>
                  {sgp && (
                    <span data-testid={`slip-sgp-badge-${head.event_id}`}
                      className="shrink-0 text-[9px] font-mono font-bold uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/40 rounded px-1.5 py-0.5">
                      Same Game ×{legs.length}
                    </span>
                  )}
                </div>
                {legs.map((s) => (
                  <motion.div key={selId(s)} layout initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                    className="bg-[#0E1017] border border-[#2A2F45] rounded-lg p-3" data-testid={`slip-item-${selId(s)}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold truncate min-w-0">{s.pick}</p>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-sm font-bold text-emerald-400">{fmtOdds(s.odds)}</span>
                        <button data-testid={`slip-remove-${selId(s)}`} onClick={() => removeSelection(selId(s))}
                          className="text-zinc-600 hover:text-red-400"><X size={14} /></button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            );
          })
        )}
      </div>

      {items.length > 0 && (
        <div className="border-t border-[#2A2F45] p-3 space-y-3">
          <div className="flex gap-1.5">
            {COINS.map((c) => (
              <button key={c} data-testid={`bet-slip-coin-${c}`} onClick={() => setCoin(c)}
                className={`flex-1 text-xs font-mono font-semibold py-1.5 rounded-md border transition-colors ${
                  coin === c ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-[#2A2F45] text-zinc-400"
                }`}>{c}</button>
            ))}
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-zinc-500">Stake {isParlay ? "" : "(per bet)"}</span>
              <span className="text-[11px] font-mono text-zinc-500">
                Bal: <span style={{ color: COIN_META[coin].color }}>{fmtCrypto(bal, coin)} {coin}</span> <Usd amount={bal} coin={coin} prefix="(" className="text-zinc-500" />{")"}
              </span>
            </div>
            <input data-testid="bet-slip-stake-input" type="number" min="0" value={stake}
              onChange={(e) => setStake(e.target.value)} placeholder="0.00"
              className="w-full bg-[#090A0F] border border-[#2A2F45] rounded-lg px-3 py-2.5 font-mono text-sm
                focus:outline-none focus:border-emerald-500" />
            <div className="flex gap-1.5 mt-1.5">
              {[10, 50, 100].map((v) => (
                <button key={v} data-testid={`bet-slip-quick-${v}`} onClick={() => setStake(String(v))}
                  className="flex-1 text-[11px] font-mono text-zinc-400 border border-[#2A2F45] rounded py-1 hover:border-emerald-500/60">
                  +{v}
                </button>
              ))}
              <button data-testid="bet-slip-quick-max" onClick={() => setStake(String(isParlay ? bal : bal / Math.max(items.length, 1)))}
                className="flex-1 text-[11px] font-mono text-emerald-400 border border-emerald-500/40 rounded py-1 hover:bg-emerald-500/10">
                MAX
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">Total stake</span>
            <span className="text-right"><span className="font-mono font-semibold" data-testid="bet-slip-total-stake">{fmtCrypto(totalStake, coin)} {coin}</span>
              <Usd amount={totalStake} coin={coin} className="block text-[11px] text-zinc-500" testId="bet-slip-total-stake-usd" /></span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">Potential payout</span>
            <span className="text-right"><span className="font-mono font-bold text-emerald-400" data-testid="bet-slip-payout">{fmtCrypto(payout, coin)} {coin}</span>
              <Usd amount={payout} coin={coin} className="block text-[11px] text-emerald-400/60" testId="bet-slip-payout-usd" /></span>
          </div>
          {isParlay && hasSgp && (
            <p data-testid="bet-slip-sgp-note" className="text-[10px] text-amber-300/80 leading-snug">
              Same-game legs are correlated, so their combined odds are trimmed.
            </p>
          )}

          <button data-testid="bet-slip-place-button" onClick={place} disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-3 rounded-lg transition-colors disabled:opacity-60">
            {loading && <Loader2 size={16} className="animate-spin" />}
            {user ? (isParlay ? "Place Parlay" : `Place ${items.length} Bet${items.length > 1 ? "s" : ""}`) : "Sign in to bet"}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <aside className="hidden lg:flex flex-col w-80 shrink-0 border-l border-[#2A2F45] bg-[#0B0D14] h-[calc(100vh-4rem)] sticky top-16">
        {content}
      </aside>

      {/* mobile floating button */}
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
            <motion.div className="absolute bottom-0 inset-x-0 h-[85vh] bg-[#0B0D14] border-t border-[#2A2F45] rounded-t-2xl overflow-hidden"
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
