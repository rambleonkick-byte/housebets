import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Clock, Radio, Ticket, CheckCircle2, XCircle, CircleDot, MinusCircle, Share2 } from "lucide-react";
import { BrandMark, OpenBetShareModal } from "@/components/OpenBetShare";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { CashoutButton } from "@/components/CashoutButton";
import { fmtOdds, fmtAmt } from "@/lib/format";

export function useOpenBets() {
  const { user } = useAuth();
  const [bets, setBets] = useState(null);
  const [quotes, setQuotes] = useState({});
  const reload = useCallback(() => api.get("/bets").then(({ data }) => setBets(data.bets.filter((b) => b.status === "open"))).catch(() => {}), []);
  useEffect(() => {
    if (!user) { setBets(null); return; }
    reload();
    const t = setInterval(reload, 30000);
    window.addEventListener("bets:changed", reload);
    return () => { clearInterval(t); window.removeEventListener("bets:changed", reload); };
  }, [user, reload]);
  const has = !!bets?.length;
  const idsKey = (bets || []).map((b) => b.id).join(",");
  const [live, setLive] = useState({});
  useEffect(() => {
    if (!has) return;
    const load = () => api.get("/bets/live").then(({ data }) => setLive(data.live)).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [has, idsKey]);
  useEffect(() => {
    if (!has) return;
    const load = () => api.get("/bets/cashout-quotes").then(({ data }) => setQuotes(data.quotes)).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [has]);
  return { bets, setBets, quotes, reload, live };
}

const STATUS = {
  won: { Icon: CheckCircle2, cls: "text-emerald-400", label: "Hit" },
  winning: { Icon: CircleDot, cls: "text-emerald-400 animate-pulse", label: "Winning" },
  losing: { Icon: CircleDot, cls: "text-red-400 animate-pulse", label: "Losing" },
  lost: { Icon: XCircle, cls: "text-red-400", label: "Lost" },
  push: { Icon: MinusCircle, cls: "text-zinc-400", label: "Push" },
  live: { Icon: CircleDot, cls: "text-amber-300 animate-pulse", label: "Live" },
  pending: { Icon: Clock, cls: "text-zinc-400", label: "Final · grading" },
};

function LegStatus({ l }) {
  const st = l?.state === "pre" || !l ? null : STATUS[l.status];
  if (!st) return <Clock size={15} className="text-zinc-600 shrink-0" />;
  const { Icon, cls } = st;
  return <Icon size={15} className={`shrink-0 ${cls}`} />;
}

function PropProgress({ p, status, testid }) {
  const max = Math.max(p.line * 1.5, p.current * 1.1, 1);
  const pct = Math.min(100, (p.current / max) * 100);
  const linePct = (p.line / max) * 100;
  const good = status === "won" || status === "winning";
  const bad = status === "lost" || status === "losing";
  return (
    <div className="mt-1.5" data-testid={testid}>
      <div className="relative h-1.5 rounded-full bg-[#090A0F] overflow-visible">
        <motion.div initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: "easeOut" }}
          className={`h-full rounded-full ${good ? "bg-emerald-400" : bad ? "bg-red-400" : "bg-amber-300"}`} />
        <span className="absolute -top-1 w-0.5 h-3.5 bg-white/70 rounded" style={{ left: `calc(${linePct}% - 1px)` }} />
      </div>
      <div className="flex justify-between text-[10px] font-mono mt-1 text-zinc-500">
        <span><b className="text-zinc-200">{+p.current.toFixed(1)}</b> now</span>
        <span>{p.side === "over" ? "Over" : "Under"} {p.line}</span>
      </div>
    </div>
  );
}

function OpenBetCard({ b, quote, legs, onCashout, onSetAuto, onShare }) {
  const toWin = b.potential_payout - (b.free_bet ? b.stake : 0);
  return (
    <div data-testid={`open-bet-${b.id}`} className="bg-gradient-to-b from-[#161924] to-[#12141C] border border-[#232838] rounded-2xl p-3.5"
      style={{ backgroundImage: "radial-gradient(90% 50% at 100% 0%, rgba(16,185,129,0.10), transparent 60%)" }}>
      <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-[#1E2234]">
        <BrandMark />
        <button data-testid={`open-bet-share-${b.id}`} onClick={() => onShare(b)} title="Share this bet"
          className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/10 rounded-full px-2.5 py-1 transition-colors">
          <Share2 size={11} /> Share
        </button>
      </div>
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-2">
        <span className="flex items-center gap-1.5">
          <span className="text-amber-300">{b.bet_type === "parlay" ? `${b.selections.length}-leg parlay` : "Single"}</span>
          {b.free_bet && <span className="text-emerald-300">· Free bet</span>}
        </span>
        <span>{new Date(b.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
      </div>
      <div className="space-y-2">
        {b.selections.map((s, i) => {
          const l = legs?.[i];
          const inPlay = l && l.state !== "pre";
          return (
            <div key={i} data-testid={`open-bet-leg-${b.id}-${i}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <span className="mt-0.5" data-testid={`open-bet-leg-status-${b.id}-${i}`} data-status={l?.status || l?.state || "unknown"}><LegStatus l={l} /></span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-white truncate">{s.pick}</p>
                    <p className="text-[11px] text-zinc-500 truncate">
                      {inPlay ? (
                        <span data-testid={`open-bet-leg-score-${b.id}-${i}`}>
                          <span className={l.state === "in" ? "text-red-400 font-bold" : "text-zinc-400"}>{l.state === "in" ? "● LIVE " : "FINAL "}</span>
                          {s.away} <b className="text-zinc-200 font-mono">{l.away_score ?? "-"}</b> – <b className="text-zinc-200 font-mono">{l.home_score ?? "-"}</b> {s.home}
                          {l.clock && l.state === "in" ? ` · ${l.clock}` : ""}
                        </span>
                      ) : <>{s.away} @ {s.home} · {s.league_label}</>}
                    </p>
                  </div>
                </div>
                <span className="font-mono text-sm font-bold text-zinc-200 shrink-0">{fmtOdds(s.odds)}</span>
              </div>
              {inPlay && l.progress && <div className="pl-6"><PropProgress p={l.progress} status={l.status} testid={`open-bet-leg-progress-${b.id}-${i}`} /></div>}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-3 pt-2.5 border-t border-[#1E2234] text-[11px]">
        <span className="text-zinc-500">Stake <b className="font-mono text-zinc-200" data-testid={`open-bet-stake-${b.id}`}>{fmtAmt(b.stake, b.coin)}</b></span>
        <span className="text-zinc-500">To win <b className="font-mono text-emerald-400" data-testid={`open-bet-towin-${b.id}`}>{fmtAmt(toWin, b.coin)}</b></span>
      </div>
      {!b.free_bet && <CashoutButton bet={b} value={quote} onCashout={onCashout} onSetAuto={onSetAuto} />}
    </div>
  );
}

export function OpenBetsPanel({ data }) {
  const { user, setAuthOpen, setBalances } = useAuth();
  const { bets, setBets, quotes, reload } = data;
  const [share, setShare] = useState(null);

  const cashout = async (b) => {
    try {
      const { data: r } = await api.post(`/bets/${b.id}/cashout`, { expected: quotes[b.id] });
      setBalances(r.balances);
      setBets((prev) => prev.filter((x) => x.id !== b.id));
      toast.success(`Cashed out ${fmtAmt(r.amount, b.coin)}`);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); reload(); }
  };
  const setAuto = async (b, target) => {
    try {
      const { data: r } = await api.post(`/bets/${b.id}/auto-cashout`, { target });
      setBets((prev) => prev.map((x) => (x.id === b.id ? { ...x, auto_cashout: r.auto_cashout } : x)));
      toast.success(target ? `Auto cash out set at ${fmtAmt(target, b.coin)}` : "Auto cash out removed");
      return true;
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); return false; }
  };

  if (!user) return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6" data-testid="open-bets-signin">
      <Ticket size={28} className="text-zinc-700 mb-3" />
      <p className="text-sm text-zinc-400">Sign in to see your open bets.</p>
      <button onClick={() => setAuthOpen(true)} className="mt-3 text-xs font-bold bg-emerald-500 text-black px-4 py-2 rounded-full">Sign in</button>
    </div>
  );
  if (!bets) return <div className="flex-1 flex items-center justify-center"><Radio size={18} className="text-emerald-400 animate-pulse" /></div>;
  if (!bets.length) return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6" data-testid="open-bets-empty">
      <Clock size={28} className="text-zinc-700 mb-3" />
      <p className="text-sm text-zinc-400">No open bets right now.</p>
      <p className="text-xs text-zinc-600 mt-1">Bets you place show up here until they settle.</p>
    </div>
  );
  const atRisk = bets.reduce((s, b) => s + (b.free_bet ? 0 : b.stake), 0);
  const toWin = bets.reduce((s, b) => s + b.potential_payout - (b.free_bet ? b.stake : 0), 0);
  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="open-bets-panel">
      <div className="mx-4 mb-3 grid grid-cols-2 gap-2 text-center">
        <div className="bg-[#12141C] border border-[#232838] rounded-xl py-2">
          <p className="text-[10px] font-mono uppercase text-zinc-500">At risk</p>
          <p className="font-mono text-sm font-bold" data-testid="open-bets-at-risk">{fmtAmt(atRisk, "USD")}</p>
        </div>
        <div className="bg-[#12141C] border border-[#232838] rounded-xl py-2">
          <p className="text-[10px] font-mono uppercase text-zinc-500">Potential win</p>
          <p className="font-mono text-sm font-bold text-emerald-400" data-testid="open-bets-to-win">{fmtAmt(toWin, "USD")}</p>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 pb-4 space-y-3">
        {bets.map((b) => <OpenBetCard key={b.id} b={b} quote={quotes[b.id]} legs={data.live?.[b.id]} onCashout={cashout} onSetAuto={setAuto}
          onShare={(bet) => setShare({ bet, legs: data.live?.[bet.id], by: user.name || "My" })} />)}
      </div>
      <OpenBetShareModal share={share} onClose={() => setShare(null)} />
    </div>
  );
}
