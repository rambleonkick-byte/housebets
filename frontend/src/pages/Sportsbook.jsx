import { useEffect, useMemo, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { Sidebar } from "@/components/Sidebar";
import { MatchCard } from "@/components/MatchCard";
import { UfcEventCard } from "@/components/UfcEventCard";
import { BetSlip } from "@/components/BetSlip";
import { BoostsStrip } from "@/components/BoostsStrip";
import { CasinoStrip } from "@/components/CasinoStrip";
import { useSharedSlipLoader } from "@/lib/slips";
import { useBetSlip } from "@/context/BetSlipContext";

const HERO = "https://images.unsplash.com/photo-1679391029864-d46f366a456b?crop=entropy&cs=srgb&fm=jpg&w=1600&q=80";

export function Sportsbook() {
  const [sports, setSports] = useState([]);
  const [byLeague, setByLeague] = useState({});
  const [pending, setPending] = useState(new Set());
  const [active, setActive] = useState("all");
  const leagueKeys = useMemo(() => sports.flatMap((s) => (s.leagues || []).map((l) => l.key)), [sports]);

  useEffect(() => { api.get("/sports").then(({ data }) => setSports(data)); }, []);

  const loadOdds = useCallback(() => {
    if (!leagueKeys.length) return;
    setPending(new Set(leagueKeys));
    leagueKeys.forEach((k) => {
      api.get("/odds", { params: { league_key: k } })
        .then(({ data }) => setByLeague((p) => ({ ...p, [k]: data.events || [] })))
        .catch(() => {})
        .finally(() => setPending((p) => { const n = new Set(p); n.delete(k); return n; }));
    });
  }, [leagueKeys]);

  useEffect(() => { loadOdds(); }, [loadOdds]);
  const events = useMemo(() => Object.values(byLeague).flat().sort((a, b) => {
    const r = (e) => (e.state === "in" ? 0 : e.state === "pre" ? 1 : 2);
    return r(a) - r(b) || (a.start || "").localeCompare(b.start || "");
  }), [byLeague]);
  const loading = pending.size > 0;
  const allDone = leagueKeys.length > 0 && !loading;
  useSharedSlipLoader(events, !allDone);
  const { syncPrices } = useBetSlip();
  useEffect(() => { syncPrices(events); }, [events, syncPrices]);
  useEffect(() => {
    const t = setInterval(loadOdds, 20000);
    return () => clearInterval(t);
  }, [loadOdds]);

  const counts = useMemo(() => {
    const c = { all: events.length };
    for (const e of events) { c[e.league] = (c[e.league] || 0) + 1; c[`lg:${e.league_key}`] = (c[`lg:${e.league_key}`] || 0) + 1; }
    return c;
  }, [events]);
  const liveBy = useMemo(() => {
    const c = {};
    for (const e of events) if (e.state === "in") { c[e.league] = (c[e.league] || 0) + 1; c[`lg:${e.league_key}`] = 1; c.all = (c.all || 0) + 1; }
    return c;
  }, [events]);

  const shown = active === "all" ? events
    : active.startsWith("lg:") ? events.filter((e) => e.league_key === active.slice(3))
    : events.filter((e) => e.league === active);
  const leagues = sports.flatMap((s) => s.leagues || []);
  const inView = (k) => active === "all" || active === `lg:${k}` || sports.find((s) => s.key === active)?.leagues?.some((l) => l.key === k);
  const pendingShown = [...pending].filter((k) => inView(k) && !byLeague[k]);
  const liveCount = events.filter((e) => e.state === "in").length;

  return (
    <div className="flex max-w-[1600px] mx-auto">
      <Sidebar sports={sports} active={active} onSelect={setActive} counts={counts} live={liveBy} />

      <main className="flex-1 min-w-0 pb-24 lg:pb-8">
        {/* Hero */}
        <div className="relative m-4 rounded-xl overflow-hidden border border-[#2A2F45]">
          <img src={HERO} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#090A0F] via-[#090A0F]/85 to-transparent" />
          <div className="relative px-6 py-8 md:py-10">
            <p className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400 mb-2">Live odds · SportsGameOdds</p>
            <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tight max-w-xl leading-[1.05]">
              Bet smarter with <span className="text-emerald-400">real-time</span> crypto.
            </h1>
            <p className="text-sm text-zinc-400 mt-3 max-w-md">
              Browse live markets across NBA, soccer, MLB & more. Stake BTC, ETH, SOL or USDT.
            </p>
            <div className="flex items-center gap-4 mt-5">
              <div className="flex items-center gap-2">
                <span className="live-dot w-2 h-2 rounded-full bg-red-500" />
                <span className="font-mono text-sm"><span className="font-bold">{liveCount}</span> <span className="text-zinc-400">live now</span></span>
              </div>
              <div className="font-mono text-sm"><span className="font-bold">{events.length}</span> <span className="text-zinc-400">markets</span></div>
            </div>
          </div>
        </div>

        <BoostsStrip ready={allDone} />
        <CasinoStrip />

        {/* Mobile sport chips */}
        <div className="lg:hidden flex gap-2 overflow-x-auto scrollbar-thin px-4 pb-2">
          <Chip label="All" active={active === "all"} onClick={() => setActive("all")} testid="chip-all" />
          {leagues.map((l) => (
            <Chip key={l.key} label={l.label} active={active === `lg:${l.key}`} onClick={() => setActive(`lg:${l.key}`)} testid={`chip-${l.key}`} />
          ))}
        </div>

        <div className="flex items-center justify-between px-4 py-2">
          <h2 className="font-display text-xl font-bold tracking-tight uppercase">
            {active === "all" ? "All Events" : active.startsWith("lg:") ? leagues.find((l) => `lg:${l.key}` === active)?.label || "Events" : sports.find((s) => s.key === active)?.label || "Events"}
          </h2>
          <button data-testid="refresh-odds" onClick={loadOdds}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-emerald-400 transition-colors">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        <div className="px-4 grid grid-cols-1 xl:grid-cols-2 gap-3" data-testid="odds-grid">
          <EventList events={shown} />
          {pendingShown.map((k) => (
            <div key={k} data-testid={`league-loading-${k}`}
              className="h-56 bg-[#12141C] border border-[#2A2F45] rounded-lg animate-pulse flex items-end p-4">
              <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-600">Loading {leagues.find((l) => l.key === k)?.label || k}…</span>
            </div>
          ))}
          {pendingShown.length === 0 && shown.length === 0 && (
            <div className="col-span-full text-center py-20 text-zinc-500" data-testid="odds-empty">
              No events available right now. Try another sport or refresh.
            </div>
          )}
        </div>
      </main>

      <BetSlip />
    </div>
  );
}

function EventList({ events }) {
  const cards = {};
  const out = [];
  for (const ev of events) {
    if (ev.league_key === "UFC" && ev.card_name) {
      if (!cards[ev.card_name]) { cards[ev.card_name] = []; out.push({ card: ev.card_name }); }
      cards[ev.card_name].push(ev);
    } else out.push({ ev });
  }
  return out.map((o) => o.card
    ? <UfcEventCard key={o.card} name={o.card} fights={cards[o.card]} />
    : <MatchCard key={o.ev.event_id} ev={o.ev} />);
}

function Chip({ label, active, onClick, testid }) {
  return (
    <button data-testid={testid} onClick={onClick}
      className={`whitespace-nowrap text-xs font-medium px-3 py-2 rounded-full border transition-colors ${
        active ? "bg-emerald-500 border-emerald-400 text-black" : "border-[#2A2F45] text-zinc-400"
      }`}>{label}</button>
  );
}
