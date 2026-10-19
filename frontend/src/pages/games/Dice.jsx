import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Dices } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { BetControls, useGameBase, GameLayout } from "@/components/casino/GameKit";
import { toast } from "sonner";

export function Dice() {
  const g = useGameBase();
  const [target, setTarget] = useState(50);
  const [direction, setDirection] = useState("over");
  const [loading, setLoading] = useState(false);
  const [last, setLast] = useState(null);

  const chance = direction === "over" ? 100 - target : target;
  const mult = chance > 0 ? (0.99 * 100) / chance : 0;

  const play = async () => {
    if (!g.user) return g.setAuthOpen(true);
    if (g.stakeNum <= 0) return toast.error("Enter a bet amount");
    if (g.stakeNum > g.balance) return toast.error("Insufficient balance");
    setLoading(true);
    try {
      const { data } = await api.post("/casino/dice", { coin: g.coin, stake: g.stakeNum, target, direction });
      g.setBalances(data.balances);
      setLast(data);
      if (data.won) toast.success(`Rolled ${data.roll} · won ${data.payout} ${g.coin}`);
      else toast.error(`Rolled ${data.roll} · lost`);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  const rollPct = last ? Math.min(100, Math.max(0, last.roll)) : null;

  return (
    <GameLayout title="Dice" tag="House Game · roll over / under"
      controls={
        <BetControls {...g} disabled={loading}>
          <div>
            <p className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 mb-1.5">Direction</p>
            <div className="flex gap-1.5">
              {["under", "over"].map((d) => (
                <button key={d} data-testid={`dice-direction-${d}`} disabled={loading} onClick={() => setDirection(d)}
                  className={`flex-1 text-xs font-medium py-2 rounded-md capitalize border transition-colors disabled:opacity-50 ${
                    direction === d ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-[#2A2F45] text-zinc-400"
                  }`}>
                  Roll {d} {d === "over" ? "▲" : "▼"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                {direction === "over" ? "Roll over" : "Roll under"}
              </p>
              <span className="font-mono text-sm font-bold text-emerald-400" data-testid="dice-target-value">{target}</span>
            </div>
            <input data-testid="dice-target-slider" type="range" min="2" max="98" step="1" value={target} disabled={loading}
              onChange={(e) => setTarget(parseInt(e.target.value, 10))}
              className="w-full accent-emerald-500 cursor-pointer" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[#0E1017] border border-[#2A2F45] rounded-lg px-3 py-2">
              <p className="text-[10px] font-mono uppercase text-zinc-500">Win chance</p>
              <p className="font-mono text-sm font-bold" data-testid="dice-chance">{chance.toFixed(2)}%</p>
            </div>
            <div className="bg-[#0E1017] border border-[#2A2F45] rounded-lg px-3 py-2">
              <p className="text-[10px] font-mono uppercase text-zinc-500">Multiplier</p>
              <p className="font-mono text-sm font-bold text-emerald-400" data-testid="dice-multiplier">{mult.toFixed(4)}×</p>
            </div>
          </div>
          <button data-testid="dice-play-button" onClick={play} disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-3 rounded-lg transition-colors disabled:opacity-60">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Dices size={16} />} Roll Dice
          </button>
        </BetControls>
      }>
      <div className="flex-1 flex flex-col justify-center px-2 sm:px-6">
        <div className="relative h-3 rounded-full bg-gradient-to-r from-red-500/60 via-amber-500/50 to-emerald-500/60">
          {/* target marker */}
          <div className="absolute -top-1.5 w-0.5 h-6 bg-white/80" style={{ left: `${target}%` }} />
          {/* roll marker */}
          {rollPct != null && (
            <motion.div key={last.roll + "-" + Math.random()} initial={{ left: "50%", opacity: 0 }}
              animate={{ left: `${rollPct}%`, opacity: 1 }} transition={{ type: "spring", damping: 18 }}
              className="absolute -top-9" style={{ transform: "translateX(-50%)" }} data-testid="dice-roll-marker">
              <div className={`font-mono text-sm font-bold px-2 py-1 rounded-md ${last.won ? "bg-emerald-500 text-black" : "bg-red-500 text-white"}`}>
                {last.roll.toFixed(2)}
              </div>
              <div className={`w-2 h-2 rotate-45 mx-auto -mt-1 ${last.won ? "bg-emerald-500" : "bg-red-500"}`} />
            </motion.div>
          )}
        </div>
        <div className="flex justify-between mt-3 font-mono text-xs text-zinc-500">
          <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
        </div>
        {last && (
          <p className="text-center mt-8 font-mono text-sm" data-testid="dice-result">
            Rolled <span className={last.won ? "text-emerald-400" : "text-red-400"}>{last.roll.toFixed(2)}</span>
            {" · "}need {direction} {target} · {last.won ? `won ${last.payout} ${g.coin}` : "no win"}
          </p>
        )}
      </div>
    </GameLayout>
  );
}
