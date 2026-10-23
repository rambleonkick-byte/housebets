import { useEffect, useMemo, useState } from "react";
import { Zap, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "@/lib/api";

const inp = "bg-[#090A0F] border border-[#2A2F45] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-400";
const MKT = { moneyline: "Moneyline", spread: "Spread", total: "Total" };

function NewBoostForm({ onCreated }) {
  const [events, setEvents] = useState([]);
  const [q, setQ] = useState("");
  const [eid, setEid] = useState("");
  const [sel, setSel] = useState("");
  const [odds, setOdds] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get("/odds").then(({ data }) => setEvents((data.events || []).filter((e) => e.state === "pre" && new Date(e.start) > Date.now() + 5 * 60000)
      .sort((a, b) => new Date(a.start) - new Date(b.start))));
  }, []);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return events.filter((e) => !s || `${e.name} ${e.home.name} ${e.away.name} ${e.league_label}`.toLowerCase().includes(s));
  }, [events, q]);
  const ev = events.find((e) => e.event_id === eid);
  const choices = (ev?.markets || []).filter((m) => MKT[m.market]).flatMap((m) => m.selections.filter((s) => s.odds).map((s) => ({ key: `${m.market}|${s.side}`, market: m.market, ...s })));
  const pick = choices.find((c) => c.key === sel);

  const create = async () => {
    if (!pick || !(+odds > pick.odds)) { toast.error("Boosted price must be higher than the current price"); return; }
    setBusy(true);
    try {
      await api.post("/admin/boosts", { event_id: eid, market: pick.market, side: pick.side, odds: +odds });
      toast.success(`${pick.pick} boosted to ${(+odds).toFixed(2)}`);
      setSel(""); setOdds(""); onCreated();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    setBusy(false);
  };

  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_1fr] lg:grid-cols-[1.2fr_1.4fr_1fr_110px_auto] items-center">
      <input data-testid="admin-boost-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search team or league" className={inp} />
      <select data-testid="admin-boost-event" value={eid} onChange={(e) => { setEid(e.target.value); setSel(""); }} className={inp}>
        <option value="">Choose game ({shown.length})</option>
        {shown.map((e) => (
          <option key={e.event_id} value={e.event_id}>{e.league_label} · {e.away.name} @ {e.home.name} · {new Date(e.start).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</option>
        ))}
      </select>
      <select data-testid="admin-boost-selection" value={sel} onChange={(e) => setSel(e.target.value)} disabled={!ev} className={`${inp} disabled:opacity-40`}>
        <option value="">Choose pick</option>
        {choices.map((c) => <option key={c.key} value={c.key}>{MKT[c.market]}: {c.pick} @ {c.odds.toFixed(2)}</option>)}
      </select>
      <input data-testid="admin-boost-odds" type="number" step="0.01" min="1.01" value={odds} onChange={(e) => setOdds(e.target.value)}
        placeholder={pick ? `> ${pick.odds.toFixed(2)}` : "New price"} disabled={!pick} className={`${inp} font-mono disabled:opacity-40`} />
      <button data-testid="admin-boost-create" onClick={create} disabled={busy || !pick || !odds}
        className="flex items-center justify-center gap-1.5 bg-rose-500 hover:bg-rose-400 text-white font-bold text-sm px-4 py-2 rounded-lg disabled:opacity-40">
        <Plus size={15} /> Boost
      </button>
    </div>
  );
}

export function AdminBoosts() {
  const [list, setList] = useState([]);
  const load = () => api.get("/admin/boosts").then(({ data }) => setList(data.boosts || [])).catch(() => {});
  useEffect(() => { load(); }, []);
  const remove = async (id) => {
    try { await api.delete(`/admin/boosts/${id}`); toast.success("Boost removed"); load(); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };
  return (
    <div className="bg-[#12141C] border border-[#2A2F45] rounded-2xl p-4 space-y-3" data-testid="admin-boosts">
      <div>
        <p className="flex items-center gap-2 font-bold"><Zap size={16} className="text-rose-400" /> Super Boosts</p>
        <p className="text-xs text-zinc-500 mt-0.5">Shows first in the Boosted Odds row. Hides 5 minutes before the game starts.</p>
      </div>
      <NewBoostForm onCreated={load} />
      {list.map((b) => (
        <div key={b.id} data-testid={`admin-boost-${b.id}`} className="flex items-center gap-3 text-sm bg-[#090A0F] border border-[#2A2F45] rounded-lg px-3 py-2">
          <span className="mr-auto">
            {b.card ? <><b>{b.card.legs[0].pick}</b> <span className="text-zinc-500">· {b.card.away} @ {b.card.home}</span></> : <span className="text-zinc-500">Not showing (game started, or price already above boost)</span>}
          </span>
          <span className="font-mono">{b.card && <span className="line-through text-zinc-600 mr-2">{b.card.base_odds.toFixed(2)}</span>}<b className="text-rose-300">{b.odds.toFixed(2)}</b></span>
          <button data-testid={`admin-boost-remove-${b.id}`} onClick={() => remove(b.id)} className="text-zinc-500 hover:text-red-400"><Trash2 size={15} /></button>
        </div>
      ))}
    </div>
  );
}
