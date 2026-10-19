import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Rocket, Bomb, CircleDot, Grid3x3, ArrowRight } from "lucide-react";

const GAMES = [
  { key: "limbo", name: "Limbo", desc: "Set a target multiplier and let it fly.", icon: Rocket, to: "/casino/limbo", glow: "#10B981" },
  { key: "mines", name: "Mines", desc: "Reveal gems, dodge the bombs, cash out.", icon: Bomb, to: "/casino/mines", glow: "#F59E0B" },
  { key: "plinko", name: "Plinko", desc: "Drop the ball into high-multiplier slots.", icon: CircleDot, to: "/casino/plinko", glow: "#627EEA" },
  { key: "keno", name: "Keno", desc: "Pick numbers and match the draw.", icon: Grid3x3, to: "/casino/keno", glow: "#22C55E" },
];

export function Casino() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <p className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400 mb-2">Originals · provably fair</p>
      <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tight">House Games</h1>
      <p className="text-sm text-zinc-400 mt-2 max-w-md">Instant-win crypto games. Bet from your simulated balance, 1% house edge.</p>

      <div className="grid sm:grid-cols-2 gap-4 mt-8" data-testid="casino-lobby">
        {GAMES.map((g, i) => {
          const Icon = g.icon;
          return (
            <motion.div key={g.key} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}>
              <Link to={g.to} data-testid={`casino-game-${g.key}`}
                className="group relative block overflow-hidden rounded-xl border border-[#2A2F45] bg-[#12141C] p-5 hover:border-emerald-500/50 transition-colors">
                <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full blur-3xl opacity-20 group-hover:opacity-40 transition-opacity"
                  style={{ background: g.glow }} />
                <div className="relative flex items-start justify-between">
                  <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4"
                    style={{ background: `${g.glow}22`, color: g.glow }}>
                    <Icon size={24} />
                  </div>
                  <ArrowRight size={18} className="text-zinc-600 group-hover:text-emerald-400 group-hover:translate-x-1 transition-all" />
                </div>
                <h3 className="font-display text-xl font-bold tracking-tight relative">{g.name}</h3>
                <p className="text-sm text-zinc-400 mt-1 relative">{g.desc}</p>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
