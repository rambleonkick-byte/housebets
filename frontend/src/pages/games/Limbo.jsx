import { useState } from "react";
import { motion } from "framer-motion";
import { Rocket, Loader2 } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { BetControls, useGameBase, GameLayout } from "@/components/casino/GameKit";
import { toast } from "sonner";

export function Limbo() {
  const g = useGameBase();
  const [target, setTarget] = useState("2.00");
  const [loading, setLoading] = useState(false);
  const [last, setLast] = useState(null);
  const [display, setDisplay] = useState(1);
  const targetNum = parseFloat(target) || 0;

  const play = async () => {
    if (!g.user) return g.setAuthOpen(true);
    if (g.stakeNum <= 0) return toast.error("Enter a bet amount");
    if (g.stakeNum > g.balance) return toast.error("Insufficient balance");
    if (targetNum < 1.01) return toast.error("Target must be ≥ 1.01");
    setLoading(true);
    try {
      const { data } = await api.post("/casino/limbo", { coin: g.coin, stake: g.stakeNum, target: targetNum });
      g.setBalances(data.balances);
      // animate count up
      const end = data.result;
      const steps = 22;
      let i = 0;
      const timer = setInterval(() => {
        i++;
        setDisplay(1 + (end - 1) * (i / steps));
        if (i >= steps) { clearInterval(timer); setDisplay(end); }
      }, 22);
      setLast(data);
      if (data.won) toast.success(`Won ${data.payout} ${g.coin}!`);
      else toast.error("Busted");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  const win = last?.won;
  const color = last == null ? "#F4F4F5" : win ? "#22C55E" : "#EF4444";

  return (
    <GameLayout title="Limbo" tag="House Game · provably fair"
      controls={
        <BetControls {...g} disabled={loading}>
          <div>
            <p className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 mb-1.5">Target multiplier</p>
            <div className="relative">
              <input data-testid="limbo-target-input" type="number" min="1.01" step="0.01" value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="w-full bg-[#090A0F] border border-[#2A2F45] rounded-lg px-3 py-2.5 font-mono text-sm focus:outline-none focus:border-emerald-500" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-sm">×</span>
            </div>
            <div className="flex justify-between mt-1.5 text-[11px] font-mono text-zinc-500">
              <span>Win chance</span>
              <span className="text-zinc-300">{targetNum >= 1.01 ? (99 / targetNum).toFixed(2) : "0"}%</span>
            </div>
            <div className="flex justify-between text-[11px] font-mono text-zinc-500">
              <span>Payout on win</span>
              <span className="text-emerald-400">{(g.stakeNum * targetNum).toFixed(4)} {g.coin}</span>
            </div>
          </div>
          <button data-testid="limbo-play-button" onClick={play} disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-3 rounded-lg transition-colors disabled:opacity-60">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />} Place Bet
          </button>
        </BetControls>
      }>
      <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 to-transparent" />
        <motion.div key={last?.result + "-" + Math.random()} data-testid="limbo-result"
          animate={{ scale: loading ? 0.9 : 1 }}
          className="font-mono font-black text-6xl sm:text-7xl tracking-tight relative z-10" style={{ color }}>
          {display.toFixed(2)}×
        </motion.div>
        {last && (
          <p className="mt-4 text-sm relative z-10" style={{ color }}>
            {win ? `Beat ${targetNum.toFixed(2)}× — you win!` : `Needed ${targetNum.toFixed(2)}× — busted`}
          </p>
        )}
      </div>
    </GameLayout>
  );
}
