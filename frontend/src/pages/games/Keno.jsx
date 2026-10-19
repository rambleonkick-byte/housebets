import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Eraser, Shuffle } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { BetControls, useGameBase, GameLayout } from "@/components/casino/GameKit";
import { toast } from "sonner";

export function Keno() {
  const g = useGameBase();
  const [picks, setPicks] = useState([]);
  const [drawn, setDrawn] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const toggle = (n) => {
    if (loading) return;
    setPicks((p) => p.includes(n) ? p.filter((x) => x !== n) : p.length >= 10 ? p : [...p, n]);
    setDrawn([]); setResult(null);
  };
  const clear = () => { setPicks([]); setDrawn([]); setResult(null); };
  const auto = () => {
    const pool = Array.from({ length: 40 }, (_, i) => i + 1);
    const picked = [];
    while (picked.length < 8) {
      const x = pool[Math.floor(Math.random() * pool.length)];
      if (!picked.includes(x)) picked.push(x);
    }
    setPicks(picked); setDrawn([]); setResult(null);
  };

  const play = async () => {
    if (!g.user) return g.setAuthOpen(true);
    if (picks.length === 0) return toast.error("Pick 1–10 numbers");
    if (g.stakeNum <= 0) return toast.error("Enter a bet amount");
    if (g.stakeNum > g.balance) return toast.error("Insufficient balance");
    setLoading(true); setDrawn([]);
    try {
      const { data } = await api.post("/casino/keno", { coin: g.coin, stake: g.stakeNum, picks });
      // reveal drawn numbers with stagger
      data.drawn.forEach((n, i) => setTimeout(() => setDrawn((d) => [...d, n]), i * 120));
      setTimeout(() => {
        g.setBalances(data.balances); setResult(data);
        if (data.multiplier >= 1) toast.success(`${data.hits} hits · ${data.multiplier}× · ${data.payout} ${g.coin}`);
        else toast(`${data.hits} hits · no win`);
        setLoading(false);
      }, data.drawn.length * 120 + 200);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
      setLoading(false);
    }
  };

  return (
    <GameLayout title="Keno" tag="House Game · pick your numbers"
      controls={
        <BetControls {...g} disabled={loading}>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">Selected</span>
            <span className="font-mono text-emerald-400" data-testid="keno-selected-count">{picks.length}/10</span>
          </div>
          {result && (
            <div className="flex items-center justify-between text-sm bg-[#0E1017] rounded-lg px-3 py-2 border border-[#2A2F45]">
              <span className="text-zinc-400 text-xs">{result.hits} hits</span>
              <span className={`font-mono font-bold ${result.multiplier >= 1 ? "text-emerald-400" : "text-zinc-400"}`}>{result.multiplier}×</span>
            </div>
          )}
          <div className="flex gap-1.5">
            <button data-testid="keno-auto" onClick={auto} disabled={loading}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs text-zinc-300 border border-[#2A2F45] rounded-md py-2 hover:border-emerald-500/50 disabled:opacity-50">
              <Shuffle size={13} /> Auto
            </button>
            <button data-testid="keno-clear" onClick={clear} disabled={loading}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs text-zinc-300 border border-[#2A2F45] rounded-md py-2 hover:border-red-500/50 disabled:opacity-50">
              <Eraser size={13} /> Clear
            </button>
          </div>
          <button data-testid="keno-play-button" onClick={play} disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-3 rounded-lg transition-colors disabled:opacity-60">
            {loading && <Loader2 size={16} className="animate-spin" />} Play Keno
          </button>
        </BetControls>
      }>
      <div className="flex-1 flex items-center justify-center">
        <div className="grid grid-cols-8 gap-1.5 sm:gap-2 w-full max-w-md" data-testid="keno-grid">
          {Array.from({ length: 40 }).map((_, idx) => {
            const n = idx + 1;
            const picked = picks.includes(n);
            const hit = drawn.includes(n);
            return (
              <motion.button key={n} data-testid={`keno-cell-${n}`} onClick={() => toggle(n)} disabled={loading}
                whileTap={{ scale: 0.9 }}
                animate={hit ? { scale: [1.2, 1] } : {}}
                className={`aspect-square rounded-md flex items-center justify-center font-mono text-xs sm:text-sm font-semibold border transition-colors ${
                  hit && picked ? "bg-emerald-500 border-emerald-400 text-black"
                  : hit ? "bg-amber-500/30 border-amber-500 text-amber-300"
                  : picked ? "bg-emerald-500/15 border-emerald-500/60 text-emerald-300"
                  : "bg-[#0E1017] border-[#2A2F45] text-zinc-400 hover:border-emerald-500/40"
                }`}>
                {n}
              </motion.button>
            );
          })}
        </div>
      </div>
    </GameLayout>
  );
}
