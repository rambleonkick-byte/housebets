import { useEffect, useState, useCallback } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "@/lib/api";
import { fmtUsd } from "@/lib/prices";

export const AdminBetReview = () => {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get("/admin/bets/review").then(({ data }) => setData(data)), []);
  useEffect(() => { load(); }, [load]);

  const sweep = async () => {
    setBusy(true);
    try {
      const { data: r } = await api.post("/admin/bets/settle-sweep");
      toast.success(`Settlement check done — ${r.open_count} bets still open`);
      await load();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    setBusy(false);
  };

  return (
    <div className="bg-[#12141C] border border-[#2A2F45] rounded-2xl" data-testid="admin-bet-review">
      <div className="p-4 border-b border-[#1E2234] flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-bold">
          <AlertTriangle size={16} className="text-amber-400" /> Bets needing review
          <span className="text-xs font-mono text-zinc-500" data-testid="admin-open-bets-count">{data ? `${data.open_count} open total` : ""}</span>
        </p>
        <button data-testid="admin-settle-sweep" onClick={sweep} disabled={busy}
          className="flex items-center gap-2 border border-[#2A2F45] hover:bg-white/5 text-sm px-3 py-1.5 rounded-lg disabled:opacity-40">
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> Check results now
        </button>
      </div>
      {data && !data.bets.length && <p className="p-4 text-sm text-zinc-500" data-testid="admin-review-empty">No stuck bets. Open bets settle automatically every 3 minutes.</p>}
      <ul className="divide-y divide-[#1E2234]">
        {data?.bets.map((b) => (
          <li key={b.id} className="p-4 text-sm flex flex-wrap justify-between gap-2" data-testid={`admin-review-bet-${b.id}`}>
            <div>
              <p className="font-semibold">{b.selections.map((s) => `${s.pick} (${s.away} @ ${s.home})`).join(" · ")}</p>
              <p className="text-xs text-zinc-500">{b.user_email} · placed {new Date(b.created_at).toLocaleString()} · {b.review_reason}</p>
            </div>
            <p className="font-mono text-xs">{fmtUsd(b.stake)} → {fmtUsd(b.potential_payout)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
};
