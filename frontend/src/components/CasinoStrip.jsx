import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Dice5, ChevronRight } from "lucide-react";
import { CASINO_GAMES } from "@/lib/casinoGames";

export function CasinoStrip() {
  return (
    <section className="px-4 pt-1 pb-3" data-testid="casino-strip">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Dice5 size={18} className="text-emerald-400" />
          <h2 className="font-display text-xl font-bold tracking-tight uppercase">House Games</h2>
        </div>
        <Link to="/casino" data-testid="casino-strip-viewall"
          className="flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-emerald-400 transition-colors">
          View all <ChevronRight size={14} />
        </Link>
      </div>

      <div data-testid="casino-strip-scroller" className="flex gap-3 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
        {CASINO_GAMES.map((g, i) => {
          const card = (
            <motion.div
              initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
              whileHover={{ y: -4 }}
              className="group relative w-32 sm:w-36 shrink-0 rounded-xl overflow-hidden border-2 transition-shadow"
              style={{ borderColor: `${g.accent}55` }}
              onMouseEnter={(e) => (e.currentTarget.style.boxShadow = `0 8px 28px -8px ${g.accent}aa`)}
              onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}>
              <div className="aspect-[3/4] relative bg-[#08122A]">
                <img src={g.img} alt={g.name} loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#050C1D] via-[#050C1D]/20 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-2 flex flex-col items-center gap-1">
                  <h3 className="font-display text-base font-black tracking-tight uppercase text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
                    {g.name}
                  </h3>
                  <span className="text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                    style={g.soon
                      ? { background: "rgba(113,113,122,0.5)", color: "#d4d4d8" }
                      : { background: `${g.accent}26`, color: g.accent, border: `1px solid ${g.accent}66` }}>
                    {g.soon ? "Soon" : "House"}
                  </span>
                </div>
              </div>
            </motion.div>
          );
          return g.soon ? (
            <div key={g.key} data-testid={`casino-strip-${g.key}`} className="cursor-not-allowed">{card}</div>
          ) : (
            <Link key={g.key} to={g.to} data-testid={`casino-strip-${g.key}`} className="block">{card}</Link>
          );
        })}
      </div>
    </section>
  );
}
