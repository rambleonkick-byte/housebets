import { useEffect, useMemo, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { Sidebar } from "@/components/Sidebar";
import { MatchCard } from "@/components/MatchCard";
import { BetSlip } from "@/components/BetSlip";
import { CasinoStrip } from "@/components/CasinoStrip";
import { useSharedSlipLoader } from "@/lib/slips";
import { useBetSlip } from "@/context/BetSlipContext";

const HERO = "https://images.unsplash.com/photo-1679391029864-d46f366a456b?crop=entropy&cs=srgb&fm=jpg&w=1600&q=80";

export function Sportsbook() {
  const [sports, setSports] = useState([]);
  const [events, setEvents] = useState([]);
  const [active, setActive] = useState("all");
  const [loading, setLoading] = useState(true);

  const loadSports = useCallback(async () => {
    const { data } = await api.get("/sports");
    setSports(data);
  }, []);

  const loadOdds = useCallback(async () => {
    const { data } = await api.get("/odds");
    setEvents(data.events || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadSports(); loadOdds(); }, [loadSports, loadOdds]);
  useSharedSlipLoader(events, loading);
  const { syncPrices } = useBetSlip();
  useEffect(() => { syncPrices(events); }, [events, syncPrices]);
  useEffect(() => {
    const t = setInterval(loadOdds, 20000);
    return () => clearInterval(t);
  }, [loadOdds]);

  const counts = useMemo(() => {
    const c = { all: events.length };
    for (const e of events) c[e.league] = (c[e.league] || 0) + 1;
    return c;
  }, [events]);
  const liveBy = useMemo(() => {
    const c = {};
    for (const e of events) if (e.state === "in") { c[e.league] = (c[e.league] || 0) + 1; c.all = (c.all || 0) + 1; }
    return c;
  }, [events]);

  const shown = active === "all" ? events : events.filter((e) => e.league === active);
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
            <p className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400 mb-2">Live odds · API-Sports</p>
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

        <CasinoStrip />

        {/* Mobile sport chips */}
        <div className="lg:hidden flex gap-2 overflow-x-auto scrollbar-thin px-4 pb-2">
          <Chip label="All" active={active === "all"} onClick={() => setActive("all")} testid="chip-all" />
          {sports.map((s) => (
            <Chip key={s.key} label={s.label} active={active === s.key} onClick={() => setActive(s.key)} testid={`chip-${s.key}`} />
          ))}
        </div>

        <div className="flex items-center justify-between px-4 py-2">
          <h2 className="font-display text-xl font-bold tracking-tight uppercase">
            {active === "all" ? "All Events" : sports.find((s) => s.key === active)?.label || "Events"}
          </h2>
          <button data-testid="refresh-odds" onClick={() => { setLoading(true); loadOdds(); }}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-emerald-400 transition-colors">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        <div className="px-4 grid grid-cols-1 xl:grid-cols-2 gap-3" data-testid="odds-grid">
          {loading && events.length === 0 ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-56 bg-[#12141C] border border-[#2A2F45] rounded-lg animate-pulse" />
            ))
          ) : shown.length === 0 ? (
            <div className="col-span-full text-center py-20 text-zinc-500" data-testid="odds-empty">
              No events available right now. Try another sport or refresh.
            </div>
          ) : (
            shown.map((ev) => <MatchCard key={ev.event_id} ev={ev} />)
          )}
        </div>
      </main>

      <BetSlip />
    </div>
  );
}

function Chip({ label, active, onClick, testid }) {
  return (
    <button data-testid={testid} onClick={onClick}
      className={`whitespace-nowrap text-xs font-medium px-3 py-2 rounded-full border transition-colors ${
        active ? "bg-emerald-500 border-emerald-400 text-black" : "border-[#2A2F45] text-zinc-400"
      }`}>{label}</button>
  );
}
