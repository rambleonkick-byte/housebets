import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ShieldCheck, Loader2, Check, Ban, RefreshCw, RotateCcw } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { fmtCrypto, fmtAmt } from "@/lib/format";
import { Usd } from "@/components/Usd";
import { toast } from "sonner";

const STATUS_STYLE = {
  pending_approval: { label: "Pending", cls: "text-sky-300 bg-sky-500/10 border-sky-500/30" },
  approving: { label: "Approving", cls: "text-sky-300 bg-sky-500/10 border-sky-500/30" },
  processing: { label: "Processing", cls: "text-amber-300 bg-amber-500/10 border-amber-500/30" },
  pending: { label: "Queued", cls: "text-amber-300 bg-amber-500/10 border-amber-500/30" },
  confirming: { label: "Confirming", cls: "text-amber-300 bg-amber-500/10 border-amber-500/30" },
  confirmed: { label: "Confirmed", cls: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30" },
  rejected: { label: "Rejected", cls: "text-red-300 bg-red-500/10 border-red-500/30" },
  failed: { label: "Failed", cls: "text-red-300 bg-red-500/10 border-red-500/30" },
  canceled: { label: "Canceled", cls: "text-red-300 bg-red-500/10 border-red-500/30" },
};

export function AdminWithdrawalsModal({ open, onClose }) {
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [filter, setFilter] = useState("pending_approval");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/withdrawals", { params: filter === "all" ? {} : { status: filter } });
      setItems(data.withdrawals);
      setCounts(data.counts || {});
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [open, load]);

  const decide = async (wid, action) => {
    setBusyId(wid + action);
    try {
      await api.post(`/admin/withdrawals/${wid}/${action}`);
      toast.success(action === "approve" ? "Approved — sent to OxaPay" : action === "reopen" ? "Back to pending — amount re-reserved from player" : "Rejected — player refunded");
      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
      load();
    } finally {
      setBusyId(null);
    }
  };

  const TABS = [
    { key: "pending_approval", label: "Pending" },
    { key: "confirmed", label: "Confirmed" },
    { key: "rejected", label: "Rejected" },
    { key: "all", label: "All" },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[96] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} data-testid="admin-withdrawals-modal">
          <motion.div className="w-full max-w-2xl bg-[#0C1A36] border border-[#1D3157] rounded-xl overflow-hidden max-h-[90vh] flex flex-col"
            initial={{ scale: 0.96, y: 15 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 15 }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1D3157]">
              <div className="flex items-center gap-2">
                <ShieldCheck size={18} className="text-emerald-400" />
                <div>
                  <p className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400">Admin</p>
                  <p className="font-display font-bold">Withdrawal Approvals</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button data-testid="admin-refresh" onClick={load} className="text-zinc-500 hover:text-emerald-400">
                  <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                </button>
                <button data-testid="admin-close" onClick={onClose} className="text-zinc-500 hover:text-white"><X size={20} /></button>
              </div>
            </div>

            <div className="flex gap-1 p-3 border-b border-[#1D3157]">
              {TABS.map((t) => (
                <button key={t.key} data-testid={`admin-tab-${t.key}`} onClick={() => setFilter(t.key)}
                  className={`flex items-center gap-1.5 text-xs font-medium py-1.5 px-3 rounded-md transition-colors ${
                    filter === t.key ? "bg-emerald-500 text-black" : "text-zinc-400 hover:text-white"
                  }`}>
                  {t.label}
                  {t.key === "pending_approval" && counts.pending_approval > 0 && (
                    <span className={`font-mono text-[10px] rounded px-1 ${filter === t.key ? "bg-black/20" : "bg-emerald-500/20 text-emerald-300"}`}>
                      {counts.pending_approval}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2" data-testid="admin-withdrawals-list">
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-16 text-zinc-600">
                  <ShieldCheck size={30} className="mb-3 opacity-40" />
                  <p className="text-sm">No withdrawals here.</p>
                </div>
              ) : (
                items.map((w) => {
                  const st = STATUS_STYLE[w.status] || { label: w.status, cls: "text-zinc-300 bg-zinc-500/10 border-zinc-500/30" };
                  const isPending = w.status === "pending_approval";
                  return (
                    <div key={w.id} data-testid={`admin-withdrawal-${w.id}`} className="bg-[#0A1530] border border-[#1D3157] rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{w.user_email}</p>
                          <p className="font-mono text-lg font-bold text-emerald-400">{w.amount_usd != null ? fmtAmt(w.amount_usd, "USD") : fmtAmt(w.amount, w.coin)}
                            <span className="text-xs text-zinc-400 ml-1.5">{fmtAmt(w.amount, w.coin)}</span>
                            <span className="text-[11px] text-zinc-500 font-sans ml-1.5">· {w.network}</span>
                          </p>
                        </div>
                        <span data-testid={`admin-status-${w.id}`} className={`shrink-0 text-[9px] font-mono uppercase tracking-wider border rounded px-1.5 py-0.5 ${st.cls}`}>
                          {st.label}
                        </span>
                      </div>
                      <div className="mt-2 bg-[#071024] border border-[#1D3157] rounded px-2.5 py-1.5">
                        <code className="font-mono text-[11px] text-zinc-300 break-all">{w.address}</code>
                      </div>
                      {w.tx_hash && <p className="mt-1 font-mono text-[10px] text-zinc-500 break-all">tx: {w.tx_hash}</p>}
                      {isPending ? (
                        <div className="flex gap-2 mt-2.5">
                          <button data-testid={`admin-approve-${w.id}`} onClick={() => decide(w.id, "approve")} disabled={!!busyId}
                            className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm py-2 rounded-lg transition-colors disabled:opacity-50">
                            {busyId === w.id + "approve" ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Approve & send
                          </button>
                          <button data-testid={`admin-reject-${w.id}`} onClick={() => decide(w.id, "reject")} disabled={!!busyId}
                            className="flex-1 flex items-center justify-center gap-1.5 border border-red-500/40 text-red-300 hover:bg-red-500/10 font-bold text-sm py-2 rounded-lg transition-colors disabled:opacity-50">
                            {busyId === w.id + "reject" ? <Loader2 size={15} className="animate-spin" /> : <Ban size={15} />} Reject
                          </button>
                        </div>
                      ) : (
                        <div className="mt-2 flex items-center gap-2">
                          {w.decided_by && <p className="text-[10px] text-zinc-600 mr-auto">Decided by {w.decided_by}</p>}
                          {["rejected", "failed", "canceled", "cancelled"].includes(w.status) && w.refunded && (
                            <button data-testid={`admin-reopen-${w.id}`} onClick={() => decide(w.id, "reopen")} disabled={!!busyId}
                              className="ml-auto flex items-center gap-1.5 border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 font-bold text-xs px-3 py-1.5 rounded-lg disabled:opacity-50">
                              {busyId === w.id + "reopen" ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Move back to pending
                            </button>
                          )}
                        </div>
                      )}
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
