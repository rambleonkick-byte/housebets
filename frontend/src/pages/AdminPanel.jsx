import { useEffect, useState, useCallback } from "react";
import { Search, ShieldCheck, Users, UserX, UserPlus, Lock, Unlock, Loader2, X, ArrowDownToLine } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail, COIN_META } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { usePrices, fmtUsd } from "@/lib/prices";
import { usdValue, fmtCrypto } from "@/lib/format";

const COINS = ["BTC", "ETH", "USDT", "SOL"];
const PAGE = 50;

function Stat({ icon: Icon, label, value, testid }) {
  return (
    <div className="bg-[#12141C] border border-[#2A2F45] rounded-2xl p-4" data-testid={testid}>
      <p className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-zinc-500"><Icon size={14} /> {label}</p>
      <p className="font-display text-2xl font-black mt-1">{value}</p>
    </div>
  );
}

function Coins({ v }) {
  const e = COINS.filter((c) => v?.[c]);
  if (!e.length) return <span className="text-zinc-600">—</span>;
  return e.map((c) => <span key={c} className="block font-mono text-[11px]" style={{ color: COIN_META[c]?.color }}>{fmtCrypto(v[c], c)} {c}</span>);
}

function AdjustForm({ u, onDone }) {
  const [coin, setCoin] = useState("USDT");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (sign) => {
    const a = parseFloat(amount);
    if (!a || a <= 0) return toast.error("Enter an amount");
    setBusy(true);
    try {
      await api.post(`/admin/users/${u.id}/adjust`, { coin, amount: sign * a, reason });
      toast.success(`${sign > 0 ? "Added" : "Removed"} ${a} ${coin}`);
      setAmount(""); setReason(""); onDone();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };
  const inp = "bg-[#090A0F] border border-[#2A2F45] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/60";
  return (
    <div className="space-y-2" data-testid="admin-adjust-form">
      <p className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">Adjust balance</p>
      <div className="flex gap-2">
        <select data-testid="admin-adjust-coin" value={coin} onChange={(e) => setCoin(e.target.value)} className={inp}>
          {COINS.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input data-testid="admin-adjust-amount" type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" className={`${inp} flex-1 font-mono`} />
      </div>
      <input data-testid="admin-adjust-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className={`${inp} w-full`} />
      <div className="flex gap-2">
        <button data-testid="admin-adjust-add" disabled={busy || reason.trim().length < 2} onClick={() => submit(1)} className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm py-2 rounded-lg disabled:opacity-40">Add</button>
        <button data-testid="admin-adjust-remove" disabled={busy || reason.trim().length < 2} onClick={() => submit(-1)} className="flex-1 border border-red-500/40 text-red-300 hover:bg-red-500/10 font-bold text-sm py-2 rounded-lg disabled:opacity-40">Remove</button>
      </div>
    </div>
  );
}

function UserDrawer({ u, rates, onClose, onChanged }) {
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const loadLog = useCallback(() => api.get(`/admin/users/${u.id}/log`).then(({ data }) => setLog(data.actions)), [u.id]);
  useEffect(() => { loadLog(); }, [loadLog]);
  const refresh = () => { onChanged(); loadLog(); };
  const toggleBlock = async () => {
    setBusy(true);
    try {
      await api.post(`/admin/users/${u.id}/block`, { blocked: !u.blocked });
      toast.success(u.blocked ? "Account unlocked" : "Account locked");
      refresh();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };
  const Row = ({ label, v, testid }) => (
    <div className="flex justify-between gap-4 py-2 border-t border-[#1E2234]" data-testid={testid}>
      <span className="text-xs text-zinc-400">{label}<span className="block font-mono text-[11px] text-zinc-500">{fmtUsd(usdValue(v, rates))}</span></span>
      <span className="text-right"><Coins v={v} /></span>
    </div>
  );
  return (
    <div className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm flex justify-end" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-[#12141C] border-l border-[#2A2F45] overflow-y-auto scrollbar-thin p-5 space-y-5" onClick={(e) => e.stopPropagation()} data-testid="admin-user-drawer">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="font-display text-xl font-bold truncate" data-testid="admin-drawer-name">{u.name}</p>
            <p className="text-sm text-zinc-400 truncate">{u.email}</p>
            <p className="text-[11px] text-zinc-500 mt-1">Joined {u.created_at ? new Date(u.created_at).toLocaleString() : "—"}{u.referred_by && ` · referred by ${u.referred_by}`}</p>
          </div>
          <button data-testid="admin-drawer-close" onClick={onClose} className="text-zinc-500 hover:text-white"><X size={20} /></button>
        </div>
        <div>
          <Row label="Balance" v={u.balances} testid="admin-drawer-balance" />
          <Row label="Deposited" v={u.deposits} testid="admin-drawer-deposits" />
          <Row label="Withdrawn" v={u.withdrawals} testid="admin-drawer-withdrawals" />
          <Row label="Wagered" v={u.wagered} testid="admin-drawer-wagered" />
        </div>
        <AdjustForm u={u} onDone={refresh} />
        {u.role !== "admin" && (
          <button data-testid="admin-block-toggle" onClick={toggleBlock} disabled={busy}
            className={`w-full flex items-center justify-center gap-2 font-bold text-sm py-2.5 rounded-lg border transition-colors ${u.blocked ? "border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10" : "border-red-500/40 text-red-300 hover:bg-red-500/10"}`}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : u.blocked ? <Unlock size={15} /> : <Lock size={15} />}
            {u.blocked ? "Unlock account" : "Lock account"}
          </button>
        )}
        <div>
          <p className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 mb-2">Admin activity</p>
          {log.length === 0 ? <p className="text-xs text-zinc-600">No changes yet.</p> : (
            <ul className="space-y-1.5" data-testid="admin-action-log">
              {log.map((a) => (
                <li key={a.id} className="text-xs bg-[#090A0F] border border-[#2A2F45] rounded-lg px-3 py-2">
                  <span className="font-semibold">{a.action === "adjust" ? `${a.amount > 0 ? "+" : ""}${a.amount} ${a.coin}` : a.action === "block" ? "Locked" : "Unlocked"}</span>
                  {a.reason && <span className="text-zinc-400"> · {a.reason}</span>}
                  <span className="block text-[10px] text-zinc-600">{a.admin} · {new Date(a.created_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminPanel({ onWithdrawals }) {
  const { user } = useAuth();
  const { rates } = usePrices();
  const [q, setQ] = useState("");
  const [skip, setSkip] = useState(0);
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(() => api.get("/admin/users", { params: { q, skip, limit: PAGE } }).then(({ data }) => setData(data))
    .catch((e) => toast.error(formatApiErrorDetail(e.response?.data?.detail))), [q, skip]);
  useEffect(() => { if (user?.role === "admin") { const t = setTimeout(load, 250); return () => clearTimeout(t); } }, [user, load]);

  if (user?.role !== "admin") return <p className="text-center text-zinc-500 py-32" data-testid="admin-denied">Admin access required.</p>;
  const open = data?.users.find((u) => u.id === openId);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6" data-testid="admin-panel">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400 flex items-center gap-1.5"><ShieldCheck size={13} /> Admin</p>
          <h1 className="font-display text-4xl font-black tracking-tight">Players</h1>
        </div>
        <button data-testid="admin-open-withdrawals" onClick={onWithdrawals} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm px-4 py-2.5 rounded-lg">
          <ArrowDownToLine size={16} /> Withdrawal queue
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat icon={Users} label="Total users" value={data?.total ?? "—"} testid="admin-stat-total" />
        <Stat icon={UserPlus} label="Signed up today" value={data?.signups_today ?? "—"} testid="admin-stat-today" />
        <Stat icon={UserX} label="Locked accounts" value={data?.blocked ?? "—"} testid="admin-stat-blocked" />
      </div>
      <div className="bg-[#12141C] border border-[#2A2F45] rounded-2xl">
        <div className="p-4 border-b border-[#1E2234] flex items-center gap-2">
          <Search size={16} className="text-zinc-500" />
          <input data-testid="admin-user-search" value={q} onChange={(e) => { setQ(e.target.value); setSkip(0); }} placeholder="Search name or email"
            className="flex-1 bg-transparent text-sm focus:outline-none" />
        </div>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm" data-testid="admin-users-table">
            <thead>
              <tr className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 text-left">
                {["User", "Joined", "Balance", "Deposited", "Withdrawn", "Wagered", "Status"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {!data ? (
                <tr><td colSpan={7} className="py-12 text-center"><Loader2 className="animate-spin text-emerald-400 mx-auto" /></td></tr>
              ) : data.users.map((u) => (
                <tr key={u.id} data-testid={`admin-user-row-${u.id}`} onClick={() => setOpenId(u.id)} className="border-t border-[#1E2234] hover:bg-white/[0.02] cursor-pointer align-top">
                  <td className="px-4 py-3 min-w-[200px]">
                    <p className="font-semibold">{u.name} {u.role === "admin" && <span className="text-[9px] font-mono text-emerald-300 border border-emerald-500/40 rounded px-1 ml-1">ADMIN</span>}</p>
                    <p className="text-xs text-zinc-500">{u.email}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-400 whitespace-nowrap">{u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-3"><p className="font-mono text-xs font-bold text-white">{fmtUsd(usdValue(u.balances, rates))}</p><Coins v={u.balances} /></td>
                  <td className="px-4 py-3 font-mono text-xs">{fmtUsd(usdValue(u.deposits, rates))}</td>
                  <td className="px-4 py-3 font-mono text-xs">{fmtUsd(usdValue(u.withdrawals, rates))}</td>
                  <td className="px-4 py-3 font-mono text-xs">{fmtUsd(usdValue(u.wagered, rates))}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-mono uppercase rounded px-1.5 py-0.5 border ${u.blocked ? "text-red-300 border-red-500/40 bg-red-500/10" : "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"}`}>{u.blocked ? "Locked" : "Active"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.total > PAGE && (
          <div className="flex items-center justify-between p-4 border-t border-[#1E2234] text-xs text-zinc-400">
            <span>{skip + 1}–{Math.min(skip + PAGE, data.total)} of {data.total}</span>
            <div className="flex gap-2">
              <button data-testid="admin-page-prev" disabled={skip === 0} onClick={() => setSkip(skip - PAGE)} className="px-3 py-1.5 border border-[#2A2F45] rounded-lg disabled:opacity-40">Prev</button>
              <button data-testid="admin-page-next" disabled={skip + PAGE >= data.total} onClick={() => setSkip(skip + PAGE)} className="px-3 py-1.5 border border-[#2A2F45] rounded-lg disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>
      {open && <UserDrawer u={open} rates={rates} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}
