import { useEffect, useMemo, useState } from "react";
import { Zap, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "@/lib/api";

const inp = "bg-[#090A0F] border border-[#2A2F45] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-400";
const MKT = { moneyline: "Moneyline", spread: "Spread", total: "Total", set1_ml: "1st Set", set2_ml: "2nd Set", total_games: "Total Games", games_spread: "Games Handicap" };

function NewBoostForm({ onCreated }) {
  const [events, setEvents] = useState([]);
  const [q, setQ] = useState("");
  const [eid, setEid] = useState("");
  const [sel, setSel] = useState("");
  const [odds, setOdds] = useState("");
  const [pctMode, setPctMode] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get("/odds").then(({ data }) => setEvents((data.events || []).filter((e) => e.state === "in" || (e.state === "pre" && new Date(e.start) > Date.now() + 5 * 60000))
      .sort((a, b) => new Date(a.start) - new Date(b.start))));
  }, []);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return events.filter((e) => !s || `${e.name} ${e.home.name} ${e.away.name} ${e.league_label}`.toLowerCase().includes(s));
  }, [events, q]);
  const ev = events.find((e) => e.event_id === eid);
  const choices = (ev?.markets || []).filter((m) => MKT[m.market]).flatMap((m) => m.selections.filter((s) => s.odds).map((s) => ({ key: `${m.market}|${s.side}`, market: m.market, ...s })));
  const pick = choices.find((c) => c.key === sel);
  const live = ev?.state === "in";
  const usePct = pctMode || live;
  const preview = pick && +odds > 0 ? (usePct ? 1 + (pick.odds - 1) * (1 + odds / 100) : +odds) : null;

  const create = async () => {
    if (!pick || !(preview > pick.odds) || (usePct && +odds > 100)) { toast.error(usePct ? "Enter a boost between 1% and 100%" : "Boosted price must be higher than the current price"); return; }
    setBusy(true);
    try {
      await api.post("/admin/boosts", { event_id: eid, market: pick.market, side: pick.side, ...(usePct ? { pct: +odds / 100 } : { odds: +odds }) });
      toast.success(usePct ? `${pick.pick} boosted +${+odds}% (now ${preview.toFixed(2)})` : `${pick.pick} boosted to ${(+odds).toFixed(2)}`);
      setSel(""); setOdds(""); onCreated();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    setBusy(false);
  };

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1.5fr_1.3fr] xl:grid-cols-[0.8fr_1.4fr_1.2fr_140px_auto] items-center">
      <input data-testid="admin-boost-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search team or league" className={inp} />
      <select data-testid="admin-boost-event" value={eid} onChange={(e) => { setEid(e.target.value); setSel(""); }} className={inp}>
        <option value="">Choose game ({shown.length})</option>
        {shown.map((e) => (
          <option key={e.event_id} value={e.event_id}>{e.state === "in" ? "🔴 LIVE · " : ""}{e.league_label} · {e.away.name} @ {e.home.name}{e.state === "in" ? "" : ` · ${new Date(e.start).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`}</option>
        ))}
      </select>
      <select data-testid="admin-boost-selection" value={sel} onChange={(e) => setSel(e.target.value)} disabled={!ev} className={`${inp} disabled:opacity-40`}>
        <option value="">Choose pick</option>
        {choices.map((c) => <option key={c.key} value={c.key}>{MKT[c.market]}: {c.pick} @ {c.odds.toFixed(2)}</option>)}
      </select>
      <div className="flex gap-1">
        <button data-testid="admin-boost-mode" type="button" disabled={live} onClick={() => setPctMode(!pctMode)} title={live ? "Live games use a percent boost" : "Switch price / percent"}
          className={`${inp} px-2 font-mono font-bold ${usePct ? "text-rose-300" : "text-zinc-300"} disabled:opacity-60`}>{usePct ? "%" : "@"}</button>
        <input data-testid="admin-boost-odds" type="number" step={usePct ? "1" : "0.01"} min="1" value={odds} onChange={(e) => setOdds(e.target.value)}
          placeholder={!pick ? "Price" : usePct ? "e.g. 15" : `> ${pick.odds.toFixed(2)}`} disabled={!pick} className={`${inp} font-mono w-full disabled:opacity-40`} />
      </div>
      <button data-testid="admin-boost-create" onClick={create} disabled={busy || !pick || !odds}
        className="flex items-center justify-center gap-1.5 bg-rose-500 hover:bg-rose-400 text-white font-bold text-sm px-4 py-2 rounded-lg disabled:opacity-40">
        <Plus size={15} /> Boost
      </button>
      {preview && <p className="text-xs text-zinc-500 col-span-full" data-testid="admin-boost-preview">{pick.pick}: {pick.odds.toFixed(2)} → <b className="text-rose-300">{preview.toFixed(2)}</b>{usePct && " now — follows the live price"}</p>}
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
        <p className="text-xs text-zinc-500 mt-0.5">Shows first in the Boosted Odds row. Fixed-price boosts hide 5 minutes before start; percent boosts follow the live price and also run during live games.</p>
      </div>
      <NewBoostForm onCreated={load} />
      {list.map((b) => (
        <div key={b.id} data-testid={`admin-boost-${b.id}`} className="flex items-center gap-3 text-sm bg-[#090A0F] border border-[#2A2F45] rounded-lg px-3 py-2">
          <span className="mr-auto">
            {b.card ? <><b>{b.card.legs[0].pick}</b> <span className="text-zinc-500">· {b.card.away} @ {b.card.home}</span></> : <span className="text-zinc-500">Not showing (game started, or price already above boost)</span>}
          </span>
          <span className="font-mono">{b.card && <span className="line-through text-zinc-600 mr-2">{b.card.base_odds.toFixed(2)}</span>}<b className="text-rose-300">{b.card ? b.card.boosted_odds.toFixed(2) : b.odds ? b.odds.toFixed(2) : ""}</b>{b.pct && <span className="text-rose-400 ml-1.5 text-xs">+{Math.round(b.pct * 100)}%{b.card?.live ? " live" : ""}</span>}</span>
          <button data-testid={`admin-boost-remove-${b.id}`} onClick={() => remove(b.id)} className="text-zinc-500 hover:text-red-400"><Trash2 size={15} /></button>
        </div>
      ))}
    </div>
  );
}
