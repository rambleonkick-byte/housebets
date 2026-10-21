import { useCallback, useEffect, useState } from "react";
import { Clock, Radio, Ticket } from "lucide-react";
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
  useEffect(() => {
    if (!has) return;
    const load = () => api.get("/bets/cashout-quotes").then(({ data }) => setQuotes(data.quotes)).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [has]);
  return { bets, setBets, quotes, reload };
}

function OpenBetCard({ b, quote, onCashout, onSetAuto }) {
  const toWin = b.potential_payout - (b.free_bet ? b.stake : 0);
  return (
    <div data-testid={`open-bet-${b.id}`} className="bg-gradient-to-b from-[#161924] to-[#12141C] border border-[#232838] rounded-2xl p-3.5">
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-2">
        <span className="flex items-center gap-1.5">
          <span className="text-amber-300">{b.bet_type === "parlay" ? `${b.selections.length}-leg parlay` : "Single"}</span>
          {b.free_bet && <span className="text-emerald-300">· Free bet</span>}
        </span>
        <span>{new Date(b.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
      </div>
      <div className="space-y-2">
        {b.selections.map((s, i) => (
          <div key={i} className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-white truncate">{s.pick}</p>
              <p className="text-[11px] text-zinc-500 truncate">{s.away} @ {s.home} · {s.league_label}</p>
            </div>
            <span className="font-mono text-sm font-bold text-zinc-200 shrink-0">{fmtOdds(s.odds)}</span>
          </div>
        ))}
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
        {bets.map((b) => <OpenBetCard key={b.id} b={b} quote={quotes[b.id]} onCashout={cashout} onSetAuto={setAuto} />)}
      </div>
    </div>
  );
}
