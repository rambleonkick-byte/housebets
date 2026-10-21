import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "@/lib/api";
import { fmtUsd } from "@/lib/prices";

const TABS = [["open", "Open bets"], ["settled", "Settled bets"], ["casino", "Casino"]];
const TONE = { won: "text-emerald-400", lost: "text-red-400", void: "text-zinc-400", cashed_out: "text-sky-400" };
const GRADES = [["won", "Won", "border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10"],
  ["lost", "Lost", "border-red-500/50 text-red-300 hover:bg-red-500/10"],
  ["void", "Void", "border-zinc-500/50 text-zinc-300 hover:bg-white/5"]];

function BetCard({ b, onGrade, busy }) {
  const ret = b.status === "cashed_out" ? b.cashout_amount : b.payout;
  return (
    <li data-testid={`admin-user-bet-${b.id}`} className="bg-[#0E1017] border border-[#2A2F45] rounded-lg p-3">
      <div className="flex justify-between text-[10px] font-mono uppercase text-zinc-500 mb-1.5">
        <span>{b.bet_type} · {b.selections.length} leg{b.selections.length > 1 ? "s" : ""}{b.free_bet && " · free bet"}{b.needs_review && <span className="text-amber-400"> · needs review</span>}</span>
        <span>{new Date(b.created_at).toLocaleString()}</span>
      </div>
      {b.selections.map((s, i) => (
        <div key={i} className="flex justify-between gap-2 text-sm">
          <span className="text-zinc-200 truncate">{s.pick} <span className="text-zinc-500 text-xs">· {s.away} @ {s.home}</span></span>
          <span className="font-mono text-xs text-zinc-400 shrink-0">{Number(s.odds).toFixed(2)}</span>
        </div>
      ))}
      <div className="flex justify-between text-xs mt-2 pt-2 border-t border-[#1E2234] text-zinc-500">
        <span>Stake <b className="font-mono text-zinc-200">{fmtUsd(b.stake)}</b></span>
        {b.status === "open" ? <span>To win <b className="font-mono text-emerald-400">{fmtUsd(b.potential_payout - (b.free_bet ? b.stake : 0))}</b></span>
          : <span data-testid={`admin-user-bet-status-${b.id}`} className={`font-bold uppercase ${TONE[b.status]}`}>{b.status.replace("_", " ")} · <span className="font-mono">{fmtUsd(ret || 0)}</span>{b.lossback > 0 && <span className="text-emerald-300 normal-case font-normal"> +{fmtUsd(b.lossback)} lossback</span>}</span>}
      </div>
      {b.graded_by && <p className="text-[10px] text-zinc-600 mt-1">Graded manually by {b.graded_by}</p>}
      {onGrade && (
        <div className="grid grid-cols-3 gap-1.5 mt-2">
          {GRADES.map(([r, l, c]) => (
            <button key={r} data-testid={`admin-grade-${r}-${b.id}`} disabled={busy} onClick={() => onGrade(b, r)}
              className={`text-xs font-bold py-1.5 rounded-md border disabled:opacity-40 ${c}`}>{l}</button>
          ))}
        </div>
      )}
    </li>
  );
}

function GameRow({ g }) {
  const profit = (g.payout || 0) - g.stake;
  return (
    <li data-testid={`admin-user-game-${g.id}`} className="flex items-center justify-between bg-[#0E1017] border border-[#2A2F45] rounded-lg px-3 py-2 text-sm">
      <div>
        <p className="capitalize font-semibold">{g.game} <span className="font-mono text-xs text-zinc-500">{g.multiplier}x</span></p>
        <p className="text-[10px] text-zinc-500">{new Date(g.created_at).toLocaleString()}</p>
      </div>
      <div className="text-right font-mono text-xs">
        <p className="text-zinc-400">Bet {fmtUsd(g.stake)}</p>
        <p className={profit > 0 ? "text-emerald-400" : profit < 0 ? "text-red-400" : "text-zinc-400"}>{profit > 0 ? "+" : ""}{fmtUsd(profit)}</p>
      </div>
    </li>
  );
}

export function AdminUserBets({ uid, onChanged }) {
  const [tab, setTab] = useState("open");
  const [open, setOpen] = useState(null);
  const [hist, setHist] = useState(null);
  const [busy, setBusy] = useState(false);
  const loadOpen = useCallback(() => api.get(`/admin/users/${uid}/bets`).then(({ data }) => setOpen(data.bets)).catch(() => setOpen([])), [uid]);
  const loadHist = useCallback(() => api.get(`/admin/users/${uid}/history`).then(({ data }) => setHist(data)).catch(() => setHist({ bets: [], games: [] })), [uid]);
  useEffect(() => { loadOpen(); }, [loadOpen]);
  useEffect(() => { if (tab !== "open" && !hist) loadHist(); }, [tab, hist, loadHist]);

  const grade = async (b, result) => {
    const amt = result === "won" ? b.potential_payout - (b.free_bet ? b.stake : 0) : result === "void" ? (b.free_bet ? 0 : b.stake) : 0;
    const msg = result === "lost" ? "Grade as LOST? The player gets the 10% lossback." : `Grade as ${result.toUpperCase()}? ${fmtUsd(amt)} goes to the player's balance.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await api.post(`/admin/bets/${b.id}/grade`, { result });
      toast.success(`Bet graded ${result}`);
      await loadOpen(); setHist(null); onChanged?.();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    setBusy(false);
  };

  const total = (open || []).reduce((s, b) => s + (b.free_bet ? 0 : b.stake), 0);
  const list = tab === "open" ? open : tab === "settled" ? hist?.bets : hist?.games;

  return (
    <div data-testid="admin-user-open-bets">
      <div className="flex gap-1 mb-2">
        {TABS.map(([v, l]) => (
          <button key={v} data-testid={`admin-user-tab-${v}`} onClick={() => setTab(v)}
            className={`flex-1 text-[11px] font-bold py-1.5 rounded-md border ${tab === v ? "border-emerald-500/60 text-emerald-300 bg-emerald-500/10" : "border-[#2A2F45] text-zinc-400"}`}>
            {l}{v === "open" && open ? ` (${open.length})` : ""}
          </button>
        ))}
      </div>
      {tab === "open" && open?.length > 0 && <p className="text-[11px] font-mono text-zinc-500 mb-2 text-right" data-testid="admin-user-open-stake">{fmtUsd(total)} at risk</p>}
      {!list ? <Loader2 size={16} className="animate-spin text-emerald-400" /> : list.length === 0 ? (
        <p className="text-xs text-zinc-600" data-testid="admin-user-no-open-bets">{tab === "casino" ? "No casino games." : tab === "settled" ? "No settled bets." : "No open bets."}</p>
      ) : (
        <ul className="space-y-2 max-h-[420px] overflow-y-auto scrollbar-thin pr-1">
          {tab === "casino" ? list.map((g) => <GameRow key={g.id} g={g} />)
            : list.map((b) => <BetCard key={b.id} b={b} busy={busy} onGrade={tab === "open" ? grade : null} />)}
        </ul>
      )}
    </div>
  );
}
