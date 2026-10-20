import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { LayoutGrid, Goal, Dribbble, Shield, CircleDot, Snowflake, Dices, Swords } from "lucide-react";

const ICONS = {
  all: { Icon: LayoutGrid, color: "#10B981" },
  soccer: { Icon: Goal, color: "#22C55E" },
  basketball: { Icon: Dribbble, color: "#F97316" },
  football: { Icon: Shield, color: "#A16207" },
  baseball: { Icon: CircleDot, color: "#EF4444" },
  hockey: { Icon: Snowflake, color: "#38BDF8" },
  mma: { Icon: Swords, color: "#F43F5E" },
};

function Tabs() {
  return (
    <div className="flex gap-1 bg-[#12141C] border border-[#1E2234] rounded-full p-1" data-testid="sidebar-tabs">
      <span className="flex-1 text-center text-sm font-bold text-white bg-[#262A38] rounded-full py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">Sport</span>
      <Link to="/casino" data-testid="sidebar-tab-casino"
        className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-zinc-400 hover:text-white rounded-full py-2 transition-colors">
        <Dices size={14} /> Casino
      </Link>
    </div>
  );
}

export function Sidebar({ sports, active, onSelect, counts, live = {} }) {
  const items = [{ key: "all", label: "All Events" }, ...sports];
  return (
    <aside className="hidden lg:flex flex-col w-64 shrink-0 h-[calc(100vh-4rem)] sticky top-16 overflow-y-auto scrollbar-thin p-3 gap-3" data-testid="sidebar">
      <Tabs />
      <div className="bg-[#12141C] border border-[#1E2234] rounded-2xl p-3">
        <div className="flex items-center gap-2 px-2 pt-1 pb-3">
          <p className="text-xs font-black uppercase tracking-wide text-white">Top Sports</p>
          <span className="text-[10px] font-bold text-zinc-400 bg-[#262A38] rounded-full px-1.5 py-0.5" data-testid="sidebar-total">{counts.all || 0}</span>
        </div>
        <nav className="space-y-0.5">
          {items.map((s) => (
            <div key={s.key}>
              <SideItem sKey={s.key} label={s.label} active={active === s.key} count={counts[s.key]}
                live={live[s.key]} onClick={() => onSelect(s.key)} testid={`sidebar-sport-${s.key}`} />
              {(s.leagues || []).length > 1 && (
                <div className="ml-5 pl-3 border-l border-[#262A38] space-y-0.5 my-0.5">
                  {s.leagues.map((l) => (
                    <LeagueItem key={l.key} label={l.label} active={active === `lg:${l.key}`} count={counts[`lg:${l.key}`]}
                      live={live[`lg:${l.key}`]} onClick={() => onSelect(`lg:${l.key}`)} testid={`sidebar-league-${l.key}`} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>
      <p className="mt-auto px-2 text-[11px] text-zinc-500 leading-relaxed">
        Live odds from <span className="text-zinc-300">85+ bookmakers</span>, updated in real time.
      </p>
    </aside>
  );
}

function LeagueItem({ label, active, count, live, onClick, testid }) {
  return (
    <button data-testid={testid} onClick={onClick}
      className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${
        active ? "bg-emerald-500/10 text-emerald-300 font-semibold" : "text-zinc-400 hover:text-white hover:bg-[#1A1D28]"}`}>
      <span className="flex-1 text-left truncate">{label}</span>
      {live ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        : count > 0 ? <span className="font-mono text-[10px] text-zinc-500">{count}</span> : null}
    </button>
  );
}

function SideItem({ sKey, label, active, count, live, onClick, testid }) {
  const { Icon, color } = ICONS[sKey] || ICONS.all;
  return (
    <button data-testid={testid} onClick={onClick}
      className={`relative w-full flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-sm transition-colors ${
        active ? "text-white" : "text-zinc-300 hover:text-white hover:bg-[#1A1D28]"}`}>
      {active && <motion.span layoutId="side-active" className="absolute inset-0 rounded-xl bg-[#1E2230] border border-[#2A2F45]" />}
      <Icon size={17} className="relative shrink-0" style={{ color }} />
      <span className="relative flex-1 text-left font-semibold truncate">{label}</span>
      {live > 0 ? (
        <span className="relative text-[10px] font-black text-white bg-red-500 rounded px-1.5 py-0.5" data-testid={`${testid}-live`}>LIVE</span>
      ) : count > 0 ? (
        <span className="relative font-mono text-[11px] text-zinc-500">{count}</span>
      ) : null}
    </button>
  );
}
