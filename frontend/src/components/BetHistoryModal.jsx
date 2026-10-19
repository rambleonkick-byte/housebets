import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, History, Trophy, XCircle, Clock } from "lucide-react";
import { api } from "@/lib/api";
import { fmtCrypto, fmtOdds } from "@/lib/format";

const STATUS = {
  open: { icon: Clock, color: "text-amber-400", bg: "bg-amber-500/10", label: "Open" },
  won: { icon: Trophy, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Won" },
  lost: { icon: XCircle, color: "text-red-400", bg: "bg-red-500/10", label: "Lost" },
};

export function BetHistoryModal({ open, onClose }) {
  const [bets, setBets] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get("/bets").then(({ data }) => setBets(data.bets)).finally(() => setLoading(false));
  }, [open]);

  const shown = filter === "all" ? bets : bets.filter((b) => b.status === filter);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} data-testid="history-modal">
          <motion.div className="w-full max-w-lg bg-[#12141C] border border-[#2A2F45] rounded-xl overflow-hidden max-h-[88vh] flex flex-col"
            initial={{ scale: 0.96, y: 15 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 15 }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#2A2F45]">
              <div className="flex items-center gap-2">
                <History size={18} className="text-emerald-400" />
                <span className="font-display text-lg font-bold tracking-tight">My Bets</span>
              </div>
              <button data-testid="history-close" onClick={onClose} className="text-zinc-500 hover:text-white"><X size={20} /></button>
            </div>

            <div className="flex gap-1 p-3 border-b border-[#2A2F45]">
              {["all", "open", "won", "lost"].map((f) => (
                <button key={f} data-testid={`history-filter-${f}`} onClick={() => setFilter(f)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md capitalize transition-colors ${
                    filter === f ? "bg-emerald-500 text-black" : "text-zinc-400 hover:text-white"
                  }`}>{f}</button>
              ))}
            </div>

            <div className="overflow-y-auto scrollbar-thin p-3 space-y-2">
              {loading ? (
                <p className="text-center text-sm text-zinc-500 py-12">Loading…</p>
              ) : shown.length === 0 ? (
                <p className="text-center text-sm text-zinc-500 py-12" data-testid="history-empty">No bets yet.</p>
              ) : (
                shown.map((b) => {
                  const S = STATUS[b.status] || STATUS.open;
                  const Icon = S.icon;
                  return (
                    <div key={b.id} data-testid={`history-bet-${b.id}`} className="bg-[#0E1017] border border-[#2A2F45] rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                          {b.bet_type} · {b.selections.length} leg{b.selections.length > 1 ? "s" : ""}
                        </span>
                        <span className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded ${S.bg} ${S.color}`}>
                          <Icon size={12} /> {S.label}
                        </span>
                      </div>
                      <div className="space-y-1 mb-2">
                        {b.selections.map((s, i) => (
                          <div key={i} className="flex items-center justify-between text-sm">
                            <span className="text-zinc-300 truncate">{s.pick}</span>
                            <span className="font-mono text-xs text-zinc-500 ml-2 shrink-0">{fmtOdds(s.odds)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-between text-xs pt-2 border-t border-[#1E2234]">
                        <span className="text-zinc-500">Stake <span className="font-mono text-zinc-300">{fmtCrypto(b.stake, b.coin)} {b.coin}</span></span>
                        <span className="text-zinc-500">
                          {b.status === "won" ? "Payout" : "To win"}{" "}
                          <span className={`font-mono ${b.status === "won" ? "text-emerald-400" : "text-zinc-300"}`}>
                            {fmtCrypto(b.potential_payout, b.coin)} {b.coin}
                          </span>
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
