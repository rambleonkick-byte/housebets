import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { fmtUsd } from "@/lib/prices";

export function AdminUserBets({ uid }) {
  const [bets, setBets] = useState(null);
  useEffect(() => { api.get(`/admin/users/${uid}/bets`).then(({ data }) => setBets(data.bets)).catch(() => setBets([])); }, [uid]);
  const total = (bets || []).reduce((s, b) => s + (b.free_bet ? 0 : b.stake), 0);

  return (
    <div data-testid="admin-user-open-bets">
      <p className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 mb-2 flex justify-between">
        <span>Open bets {bets && `(${bets.length})`}</span>
        {bets?.length > 0 && <span data-testid="admin-user-open-stake">{fmtUsd(total)} at risk</span>}
      </p>
      {!bets ? <Loader2 size={16} className="animate-spin text-emerald-400" /> : bets.length === 0 ? (
        <p className="text-xs text-zinc-600" data-testid="admin-user-no-open-bets">No open bets.</p>
      ) : (
        <ul className="space-y-2">
          {bets.map((b) => (
            <li key={b.id} data-testid={`admin-user-bet-${b.id}`} className="bg-[#0E1017] border border-[#2A2F45] rounded-lg p-3">
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
                <span>To win <b className="font-mono text-emerald-400">{fmtUsd(b.potential_payout - (b.free_bet ? b.stake : 0))}</b></span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
