import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { CasinoHistoryModal } from "@/components/CasinoHistoryModal";

const IMG = {
  dice: "https://static.prod-images.emergentagent.com/jobs/2da7fdf4-e166-4ed4-bfba-3c73b2857ea1/images/f3c326bfd05f53c0df708c50f72f061b4afec3005519def4bec1c1652ba4e538.jpeg",
  limbo: "https://static.prod-images.emergentagent.com/jobs/2da7fdf4-e166-4ed4-bfba-3c73b2857ea1/images/e7b233f7c8557abf539a6058c2116c70220679c899cd23d30a31f6db8e235ce6.jpeg",
  mines: "https://static.prod-images.emergentagent.com/jobs/2da7fdf4-e166-4ed4-bfba-3c73b2857ea1/images/6527004b5961b064bdc98a19dc5fa1334e98c8d1701e6ace0c628550eaa035af.jpeg",
  keno: "https://static.prod-images.emergentagent.com/jobs/2da7fdf4-e166-4ed4-bfba-3c73b2857ea1/images/6e4275f3951a149f90d0e9567316f9892c06ea610b78df39e7368c9fb3294458.jpeg",
  plinko: "https://static.prod-images.emergentagent.com/jobs/2da7fdf4-e166-4ed4-bfba-3c73b2857ea1/images/a43942ca9067eb8c634da549048154c3316f0a9b210407d806eb14f15fe1e04f.jpeg",
  crash: "https://static.prod-images.emergentagent.com/jobs/2da7fdf4-e166-4ed4-bfba-3c73b2857ea1/images/dbc86b8d5787e13a830cbd583f67b0a13fd61d703af6bc195a5b33c56869b92d.jpeg",
};

const GAMES = [
  { key: "dice", name: "Dice", to: "/casino/dice", img: IMG.dice, accent: "#3B82F6" },
  { key: "limbo", name: "Limbo", to: "/casino/limbo", img: IMG.limbo, accent: "#2DD4BF" },
  { key: "mines", name: "Mines", to: "/casino/mines", img: IMG.mines, accent: "#F59E0B" },
  { key: "keno", name: "Keno", to: "/casino/keno", img: IMG.keno, accent: "#22C55E" },
  { key: "plinko", name: "Plinko", to: "/casino/plinko", img: IMG.plinko, accent: "#34D399" },
  { key: "crash", name: "Crash", to: null, img: IMG.crash, accent: "#F97316", soon: true },
];

export function Casino() {
  const { user, setAuthOpen } = useAuth();
  const [histOpen, setHistOpen] = useState(false);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mt-8" data-testid="casino-lobby">
        {GAMES.map((g, i) => (
          <GameCard key={g.key} game={g} index={i} />
        ))}
      </div>

      <CasinoHistoryModal open={histOpen} onClose={() => setHistOpen(false)} />
    </div>
  );
}

function GameCard({ game, index }) {
  const inner = (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.4 }}
      whileHover={{ y: -6 }}
      className="group relative rounded-2xl overflow-hidden border-2 transition-shadow duration-300"
      style={{ borderColor: `${game.accent}66`, boxShadow: `0 0 0 0 ${game.accent}00` }}
      onMouseEnter={(e) => (e.currentTarget.style.boxShadow = `0 10px 40px -8px ${game.accent}99`)}
      onMouseLeave={(e) => (e.currentTarget.style.boxShadow = `0 0 0 0 ${game.accent}00`)}
    >
      <div className="aspect-[3/4] relative bg-[#0B0D14]">
        <img src={game.img} alt={game.name} loading="lazy"
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#070810] via-[#070810]/20 to-transparent" />
        {/* colored top glow accent */}
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-24 h-24 rounded-full blur-2xl opacity-40 group-hover:opacity-70 transition-opacity"
          style={{ background: game.accent }} />

        <div className="absolute inset-x-0 bottom-0 p-3 flex flex-col items-center gap-1.5">
          <h3 className="font-display text-xl sm:text-2xl font-black tracking-tight uppercase text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
            {game.name}
          </h3>
          {game.soon ? (
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-3 py-1 rounded-md bg-zinc-700/80 text-zinc-300">
              Soon
            </span>
          ) : (
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-3 py-1 rounded-md"
              style={{ background: `${game.accent}26`, color: game.accent, border: `1px solid ${game.accent}66` }}>
              Maxxed
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );

  if (game.soon) {
    return <div data-testid={`casino-game-${game.key}`} className="cursor-not-allowed opacity-90">{inner}</div>;
  }
  return <Link to={game.to} data-testid={`casino-game-${game.key}`} className="block">{inner}</Link>;
}
