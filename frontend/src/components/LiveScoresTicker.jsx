import { useMemo } from "react";

function Item({ ev }) {
  const live = ev.state === "in";
  const d = new Date(ev.start);
  const when = d.toDateString() === new Date().toDateString()
    ? d.toTimeString().slice(0, 5) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <div className="flex items-center gap-3 px-4 border-r border-[#2A2F45] shrink-0 h-full">
      {live
        ? <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-red-400"><span className="live-dot w-1.5 h-1.5 rounded-full bg-red-500" />LIVE</span>
        : <span className="text-[10px] font-mono text-zinc-500">{when}</span>}
      <span className="text-[10px] font-mono uppercase text-emerald-400/80">{ev.league_label}</span>
      <span className="text-xs font-semibold whitespace-nowrap">{ev.away.abbr || ev.away.name}</span>
      {live && ev.away.score != null
        ? <span className="font-mono text-xs font-bold text-white">{ev.away.score} - {ev.home.score}</span>
        : <span className="text-[10px] text-zinc-600">vs</span>}
      <span className="text-xs font-semibold whitespace-nowrap">{ev.home.abbr || ev.home.name}</span>
      {live && <span className="text-[10px] font-mono text-zinc-500">{ev.status_detail}</span>}
    </div>
  );
}

export function LiveScoresTicker({ events }) {
  const items = useMemo(() => {
    const live = events.filter((e) => e.state === "in");
    const up = events.filter((e) => e.state === "pre").slice(0, Math.max(0, 24 - live.length));
    return [...live, ...up];
  }, [events]);
  if (!items.length) return null;
  return (
    <div data-testid="live-scores-ticker" className="ticker group relative mx-4 mt-3 h-10 rounded-xl bg-[#0B0D14] border border-[#2A2F45] overflow-hidden">
      <div className="absolute left-0 inset-y-0 z-10 flex items-center px-3 bg-[#0B0D14] border-r border-[#2A2F45] shadow-[12px_0_16px_-4px_#0B0D14]">
        <span className="text-[10px] font-mono font-black uppercase tracking-[0.2em] text-emerald-400">Scores</span>
      </div>
      <div className="ticker-track flex h-full w-max pl-24" style={{ animationDuration: `${items.length * 4}s` }}>
        {[...items, ...items].map((ev, i) => <Item key={`${ev.event_id}-${i}`} ev={ev} />)}
      </div>
      <div className="absolute right-0 inset-y-0 w-12 bg-gradient-to-l from-[#0B0D14] to-transparent pointer-events-none" />
    </div>
  );
}
