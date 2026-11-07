import { useEffect, useState, useCallback } from "react";
import { AlertTriangle, RefreshCw, Hand } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "@/lib/api";
import { fmtUsd } from "@/lib/prices";

const HINT = { won: "text-emerald-400", lost: "text-red-400", push: "text-zinc-300" };
const GRADE = [["won", "Won", "border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10"],
  ["lost", "Lost", "border-red-500/50 text-red-300 hover:bg-red-500/10"],
  ["void", "Void", "border-zinc-600 text-zinc-300 hover:bg-white/5"]];

const ReviewBet = ({ b, manual, busy, onGrade }) => (
  <li className="p-4 text-sm flex flex-wrap justify-between gap-3" data-testid={`admin-review-bet-${b.id}`}>
    <div className="space-y-1 min-w-0">
      {b.selections.map((s, i) => (
        <p key={i}>
          <b>{s.pick}</b> <span className="text-zinc-500">({s.away} @ {s.home}) @ {Number(s.odds).toFixed(2)}</span>
          {s.score && <span className="block text-xs font-mono text-zinc-400">{s.score}</span>}
          {s.suggest && <span className={`block text-xs font-bold ${HINT[s.suggest] || "text-zinc-400"}`} data-testid={`admin-review-hint-${b.id}-${i}`}>Results say: {s.suggest.toUpperCase()}</span>}
        </p>
      ))}
      <p className="text-xs text-zinc-500">{b.user_email} · placed {new Date(b.created_at).toLocaleString()}{b.review_reason ? ` · ${b.review_reason}` : ""}</p>
    </div>
    <div className="text-right space-y-2">
      <p className="font-mono text-xs">{fmtUsd(b.stake)} → {fmtUsd(b.potential_payout)}</p>
      {manual && (
        <div className="flex gap-1.5 justify-end">
          {GRADE.map(([r, label, cls]) => (
            <button key={r} data-testid={`admin-review-grade-${r}-${b.id}`} disabled={busy} onClick={() => onGrade(b, r)}
              className={`text-xs font-bold px-2.5 py-1 rounded-md border disabled:opacity-40 ${cls}`}>{label}</button>
          ))}
        </div>
      )}
    </div>
  </li>
);

export const AdminBetReview = () => {
  const [data, setData] = useState(null);
  const [auto, setAuto] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get("/admin/bets/review").then(({ data }) => setData(data)), []);
  useEffect(() => { load(); api.get("/admin/auto-settle").then(({ data }) => setAuto(data.enabled)); }, [load]);

  const run = async (fn) => { setBusy(true); try { await fn(); } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); } setBusy(false); };
  const sweep = () => run(async () => {
    const { data: r } = await api.post("/admin/bets/settle-sweep");
    toast.success(`Settlement check done — ${r.open_count} bets still open`);
    await load();
  });
  const flip = () => run(async () => {
    const { data: r } = await api.put("/admin/auto-settle", { enabled: !auto });
    setAuto(r.enabled);
    toast.success(r.enabled ? "Bets will settle automatically again" : "All bets now need manual grading");
    await load();
  });
  const grade = (b, result) => {
    if (!window.confirm(`Grade ${fmtUsd(b.stake)} bet by ${b.user_email} as ${result.toUpperCase()}?`)) return;
    run(async () => { await api.post(`/admin/bets/${b.id}/grade`, { result }); toast.success(`Bet graded ${result}`); await load(); });
  };

  const manual = data?.manual;
  return (
    <div className="bg-[#0C1A36] border border-[#1D3157] rounded-2xl" data-testid="admin-bet-review">
      <div className="p-4 border-b border-[#162848] flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-bold">
          {manual ? <Hand size={16} className="text-sky-300" /> : <AlertTriangle size={16} className="text-amber-400" />}
          {manual ? "Open bets to grade" : "Bets needing review"}
          <span className="text-xs font-mono text-zinc-500" data-testid="admin-open-bets-count">{data ? `${data.open_count} open total` : ""}</span>
        </p>
        <div className="flex gap-2">
          {auto !== null && (
            <button data-testid="admin-auto-settle-toggle" onClick={flip} disabled={busy}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg border disabled:opacity-40 ${auto ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/10" : "border-sky-500/50 text-sky-300 bg-sky-500/10"}`}>
              {auto ? "Auto grading ON" : "Manual grading ON"}
            </button>
          )}
          {!manual && (
            <button data-testid="admin-settle-sweep" onClick={sweep} disabled={busy}
              className="flex items-center gap-2 border border-[#1D3157] hover:bg-white/5 text-sm px-3 py-1.5 rounded-lg disabled:opacity-40">
              <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> Check results now
            </button>
          )}
          {manual && (
            <button data-testid="admin-review-refresh" onClick={() => run(load)} disabled={busy}
              className="flex items-center gap-2 border border-[#1D3157] hover:bg-white/5 text-sm px-3 py-1.5 rounded-lg disabled:opacity-40">
              <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> Refresh
            </button>
          )}
        </div>
      </div>
      {data && !data.bets.length && <p className="p-4 text-sm text-zinc-500" data-testid="admin-review-empty">{manual ? "No open bets to grade." : "No stuck bets. Open bets settle automatically every 10 minutes."}</p>}
      <ul className="divide-y divide-[#162848] max-h-[600px] overflow-y-auto">
        {data?.bets.map((b) => <ReviewBet key={b.id} b={b} manual={manual} busy={busy} onGrade={grade} />)}
      </ul>
    </div>
  );
};
