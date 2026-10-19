import { motion } from "framer-motion";

export function Sidebar({ sports, active, onSelect, counts }) {
  return (
    <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-[#2A2F45] bg-[#0B0D14] h-[calc(100vh-4rem)] sticky top-16 overflow-y-auto scrollbar-thin">
      <div className="p-4">
        <p className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400 mb-3">Sports</p>
        <nav className="space-y-1">
          <SideItem label="All Events" active={active === "all"} count={counts.all}
            onClick={() => onSelect("all")} testid="sidebar-sport-all" />
          {sports.map((s) => (
            <SideItem key={s.key} label={s.label} active={active === s.key} count={counts[s.key]}
              onClick={() => onSelect(s.key)} testid={`sidebar-sport-${s.key}`} />
          ))}
        </nav>
      </div>
      <div className="mt-auto p-4 border-t border-[#2A2F45]">
        <div className="text-[11px] text-zinc-500 leading-relaxed">
          Live odds sourced from <span className="text-zinc-300">ESPN</span> public feeds.
          Balances are simulated crypto for demo play.
        </div>
      </div>
    </aside>
  );
}

function SideItem({ label, active, count, onClick, testid }) {
  return (
    <button data-testid={testid} onClick={onClick}
      className={`relative w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors ${
        active ? "bg-emerald-500/10 text-emerald-300" : "text-zinc-400 hover:text-white hover:bg-[#161922]"
      }`}>
      {active && (
        <motion.span layoutId="side-active" className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-emerald-400" />
      )}
      <span className="font-medium truncate">{label}</span>
      {count > 0 && (
        <span className="font-mono text-[11px] text-zinc-500">{count}</span>
      )}
    </button>
  );
}
