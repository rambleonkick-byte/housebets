import { useEffect, useState } from "react";
import { BellRing, Gauge, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "@/lib/api";

const inp = "bg-[#090A0F] border border-[#2A2F45] rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-emerald-500";

export function AdminGlobalLimit() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get("/admin/limits").then(({ data }) => setS({ ...data, amount: String(data.amount) })); }, []);
  const save = async (next) => {
    setBusy(true);
    try {
      const { data } = await api.put("/admin/limits", { enabled: next.enabled, amount: +next.amount });
      setS({ ...data, amount: String(data.amount) });
      toast.success(data.enabled ? `Max win set to $${data.amount}` : "Max win limit switched off");
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    setBusy(false);
  };
  if (!s) return null;
  return (
    <div className="bg-[#12141C] border border-[#2A2F45] rounded-2xl p-4 flex flex-wrap items-center gap-3" data-testid="admin-global-limit">
      <p className="flex items-center gap-2 font-bold mr-auto"><Gauge size={16} className="text-amber-300" /> Max win per bet (all players)</p>
      <button data-testid="admin-limit-toggle" disabled={busy} onClick={() => save({ ...s, enabled: !s.enabled })}
        className={`text-xs font-bold px-3 py-2 rounded-lg border ${s.enabled ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/10" : "border-zinc-600 text-zinc-400"}`}>
        {s.enabled ? "ON" : "OFF — no limit"}
      </button>
      <span className="text-zinc-500 text-sm">$</span>
      <input data-testid="admin-limit-amount" type="number" min="1" value={s.amount} disabled={!s.enabled}
        onChange={(e) => setS({ ...s, amount: e.target.value })} className={`${inp} w-28 disabled:opacity-40`} />
      <button data-testid="admin-limit-save" disabled={busy || !s.enabled || !(+s.amount > 0)} onClick={() => save(s)}
        className="bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm px-4 py-2 rounded-lg disabled:opacity-40">
        {busy ? <Loader2 size={14} className="animate-spin" /> : "Save"}
      </button>
      <button data-testid="admin-telegram-test" onClick={pingPhone}
        className="text-xs font-bold px-3 py-2 rounded-lg border border-sky-500/50 text-sky-300 bg-sky-500/10 hover:bg-sky-500/20">
        Connect / test phone alerts
      </button>
    </div>
  );
}

export function AdminBigWin() {
  const [s, setS] = useState(null);
  useEffect(() => { api.get("/admin/big-win").then(({ data }) => setS({ ...data, amount: String(data.amount) })); }, []);
  const save = async (next) => {
    try {
      const { data } = await api.put("/admin/big-win", { enabled: next.enabled, amount: +next.amount });
      setS({ ...data, amount: String(data.amount) });
      toast.success(data.enabled ? `Big win alerts at $${data.amount}+` : "Big win alerts off");
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };
  if (!s) return null;
  return (
    <div className="bg-[#12141C] border border-[#2A2F45] rounded-2xl p-4 flex flex-wrap items-center gap-3" data-testid="admin-big-win">
      <p className="flex items-center gap-2 font-bold mr-auto"><BellRing size={16} className="text-sky-300" /> Big win phone alert (profit per bet or game)</p>
      <button data-testid="admin-big-win-toggle" onClick={() => save({ ...s, enabled: !s.enabled })}
        className={`text-xs font-bold px-3 py-2 rounded-lg border ${s.enabled ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/10" : "border-zinc-600 text-zinc-400"}`}>
        {s.enabled ? "ON" : "OFF"}
      </button>
      <span className="text-zinc-500 text-sm">$</span>
      <input data-testid="admin-big-win-amount" type="number" min="1" value={s.amount} disabled={!s.enabled}
        onChange={(e) => setS({ ...s, amount: e.target.value })} className={`${inp} w-28 disabled:opacity-40`} />
      <button data-testid="admin-big-win-save" disabled={!s.enabled || !(+s.amount > 0)} onClick={() => save(s)}
        className="bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm px-4 py-2 rounded-lg disabled:opacity-40">Save</button>
    </div>
  );
}

const pingPhone = async () => {
  try { await api.post("/admin/telegram/test"); toast.success("Test ping sent to your Telegram"); }
  catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
};

export function PlayerLimitForm({ u, onDone }) {
  const [v, setV] = useState(u.max_win == null ? "" : String(u.max_win));
  const [busy, setBusy] = useState(false);
  const save = async (val) => {
    setBusy(true);
    try {
      const { data } = await api.put(`/admin/users/${u.id}/max-win`, { max_win: val });
      toast.success(data.max_win == null ? "Using the global limit" : data.max_win === 0 ? "No max win for this player" : `Max win set to $${data.max_win}`);
      setV(val == null ? "" : String(val)); onDone();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    setBusy(false);
  };
  return (
    <div data-testid="admin-player-limit">
      <p className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 mb-2">
        Max win per bet · <span className="text-zinc-300" data-testid="admin-player-limit-current">{u.max_win == null ? "global default" : u.max_win === 0 ? "no limit" : `$${u.max_win}`}</span>
      </p>
      <div className="flex gap-2">
        <input data-testid="admin-player-limit-input" type="number" min="0" value={v} onChange={(e) => setV(e.target.value)} placeholder="e.g. 5000"
          className={`${inp} flex-1 min-w-0`} />
        <button data-testid="admin-player-limit-save" disabled={busy || v === "" || +v < 0} onClick={() => save(+v)}
          className="bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs px-3 rounded-lg disabled:opacity-40">Set</button>
        <button data-testid="admin-player-limit-unlimited" disabled={busy} onClick={() => save(0)}
          className="text-xs px-3 rounded-lg border border-[#2A2F45] hover:bg-white/5">No limit</button>
        <button data-testid="admin-player-limit-reset" disabled={busy || u.max_win == null} onClick={() => save(null)}
          className="text-xs px-3 rounded-lg border border-[#2A2F45] hover:bg-white/5 disabled:opacity-40">Default</button>
      </div>
    </div>
  );
}
