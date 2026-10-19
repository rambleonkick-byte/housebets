import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Rocket, Bomb, CircleDot, Grid3x3, Dices, ArrowRight, ShieldCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { CasinoHistoryModal } from "@/components/CasinoHistoryModal";

const GAMES = [
  { key: "limbo", name: "Limbo", desc: "Set a target multiplier and let it fly.", icon: Rocket, to: "/casino/limbo", glow: "#10B981" },
  { key: "dice", name: "Dice", desc: "Roll over or under your chosen number.", icon: Dices, to: "/casino/dice", glow: "#627EEA" },
  { key: "mines", name: "Mines", desc: "Reveal gems, dodge the bombs, cash out.", icon: Bomb, to: "/casino/mines", glow: "#F59E0B" },
  { key: "plinko", name: "Plinko", desc: "Drop the ball into high-multiplier slots.", icon: CircleDot, to: "/casino/plinko", glow: "#8B5CF6" },
  { key: "keno", name: "Keno", desc: "Pick numbers and match the draw.", icon: Grid3x3, to: "/casino/keno", glow: "#22C55E" },
];

export function Casino() {
  const { user, setAuthOpen } = useAuth();
  const [histOpen, setHistOpen] = useState(false);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400 mb-2">Originals · provably fair</p>
          <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tight">House Games</h1>
          <p className="text-sm text-zinc-400 mt-2 max-w-md">Instant-win crypto games with a 1% house edge. Every result is cryptographically verifiable.</p>
        </div>
        <button data-testid="casino-history-open" onClick={() => (user ? setHistOpen(true) : setAuthOpen(true))}
          className="flex items-center gap-1.5 text-sm font-medium text-zinc-300 border border-[#2A2F45] hover:border-emerald-500/50 rounded-lg px-3 py-2 shrink-0 transition-colors">
          <ShieldCheck size={16} className="text-emerald-400" /> <span className="hidden sm:inline">History &amp; Fairness</span>
        </button>
      </div>

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
      <CasinoHistoryModal open={histOpen} onClose={() => setHistOpen(false)} />
    </div>
  );
}
