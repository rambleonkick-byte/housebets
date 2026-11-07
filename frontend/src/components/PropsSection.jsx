import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { OddsButton } from "@/components/MatchCard";

const GROUPS = [
  { key: "all", label: "All" },
  { key: "scoring", label: "Scoring", test: (s) => /points|goals|touchdown|runs|homeRuns|threePointers|fieldGoals|freeThrows|shots/i.test(s) && !/passing|rushing|receiving/i.test(s) },
  { key: "passing", label: "Passing", test: (s) => /passing/i.test(s) },
  { key: "rushing", label: "Rushing", test: (s) => /rushing/i.test(s) },
  { key: "receiving", label: "Receiving", test: (s) => /receiving|receptions/i.test(s) },
  { key: "rebounds", label: "Rebounds", test: (s) => /rebounds/i.test(s) },
  { key: "assists", label: "Assists", test: (s) => /assists/i.test(s) },
  { key: "defense", label: "Defense", test: (s) => /blocks|steals|tackles|sacks|interceptions|saves/i.test(s) },
  { key: "combos", label: "Combos", test: (s) => s.includes("+") },
  { key: "other", label: "Other" },
];
const groupOf = (stat) => GROUPS.slice(1, -1).find((g) => g.test(stat))?.key || "other";

function PropRow({ p, meta }) {
  return (
    <div className="grid gap-1.5 items-center" style={{ gridTemplateColumns: "1fr 4.25rem 4.25rem" }}>
      <p className="text-[11px] text-zinc-400 truncate">{p.label} <span className="font-mono text-zinc-200">{p.line}</span></p>
      {p.over != null ? (
        <OddsButton meta={meta} sel={{ market: "prop", side: `${p.stat}:${p.player_id}:over`, label: "Over",
          pick: `${p.player} O${p.line} ${p.label}`, line: p.line, odds: p.over }} />
      ) : <div />}
      {p.under != null ? (
        <OddsButton meta={meta} sel={{ market: "prop", side: `${p.stat}:${p.player_id}:under`, label: "Under",
          pick: `${p.player} U${p.line} ${p.label}`, line: p.line, odds: p.under }} />
      ) : <div />}
    </div>
  );
}

export function PropsSection({ ev, meta }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("all");
  const tid = ev.event_id;
  const available = useMemo(() => new Set(ev.props.map((p) => groupOf(p.stat))), [ev.props]);
  const players = useMemo(() => {
    const term = q.trim().toLowerCase();
    const by = new Map();
    for (const p of ev.props) {
      if (group !== "all" && groupOf(p.stat) !== group) continue;
      if (term && !p.player.toLowerCase().includes(term) && !p.label.toLowerCase().includes(term)) continue;
      if (!by.has(p.player)) by.set(p.player, []);
      by.get(p.player).push(p);
    }
    return [...by.entries()];
  }, [ev.props, q, group]);
  const playerCount = useMemo(() => new Set(ev.props.map((p) => p.player)).size, [ev.props]);

  return (
    <div className="px-4 pb-4 border-t border-[#162848] pt-3">
      <button data-testid={`props-toggle-${tid}`} onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-zinc-400 hover:text-emerald-300 transition-colors">
        <span>Player Props ({ev.props.length} · {playerCount} players)</span>
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 bg-[#071024] border border-[#1D3157] rounded-lg px-2.5 py-1.5 focus-within:border-emerald-500/50">
            <Search size={13} className="text-zinc-500" />
            <input data-testid={`props-search-${tid}`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search player or stat"
              className="flex-1 bg-transparent text-xs focus:outline-none" />
          </div>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
            {GROUPS.filter((g) => g.key === "all" || available.has(g.key)).map((g) => (
              <button key={g.key} data-testid={`props-filter-${tid}-${g.key}`} onClick={() => setGroup(g.key)}
                className={`shrink-0 text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full border transition-colors ${group === g.key ? "bg-emerald-500 text-black border-emerald-500" : "border-[#1D3157] text-zinc-400 hover:text-white"}`}>
                {g.label}
              </button>
            ))}
          </div>
          <div className="max-h-96 overflow-y-auto scrollbar-thin pr-1 space-y-3" data-testid={`props-list-${tid}`}>
            {players.length === 0 && <p className="text-xs text-zinc-500 py-4 text-center" data-testid={`props-empty-${tid}`}>No props match.</p>}
            {players.map(([name, list]) => (
              <div key={name} data-testid={`props-player-${tid}`}>
                <p className="text-xs font-semibold mb-1.5 sticky top-0 bg-[#0C1A36] py-0.5">{name} <span className="text-[10px] font-normal text-zinc-500">({list.length})</span></p>
                <div className="space-y-1.5">{list.map((p) => <PropRow key={`${p.stat}-${p.player_id}`} p={p} meta={meta} />)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
