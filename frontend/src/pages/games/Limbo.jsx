import { useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Rocket } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { BetControls, useGameBase, GameLayout, PlayButton, PlayArea, FieldLabel, StatBox } from "@/components/casino/GameKit";
import { toast } from "sonner";
import { sfx } from "@/lib/sfx";

export function Limbo() {
  const g = useGameBase();
  const [target, setTarget] = useState("2.00");
  const [loading, setLoading] = useState(false);
  const [autoOn, setAutoOn] = useState(false);
  const [last, setLast] = useState(null);
  const [display, setDisplay] = useState(1);
  const [history, setHistory] = useState([]);
  const [win, setWin] = useState(null);
  const closeWin = useCallback(() => setWin(null), []);
  const timer = useRef(null);
  const targetNum = parseFloat(target) || 0;

  const play = async () => {
    setWin(null);
    if (!g.user) { g.setAuthOpen(true); return null; }
    if (g.stakeNum <= 0) { toast.error("Enter a bet amount"); return null; }
    if (g.stakeNum > g.balance) { toast.error("Insufficient balance"); return null; }
    if (targetNum < 1.01) { toast.error("Target must be ≥ 1.01"); return null; }
    setLoading(true);
    try {
      const { data } = await api.post("/casino/limbo", { coin: g.coin, stake: g.stakeNum, target: targetNum });
      g.setBalances(data.balances);
      setLast(null);
      const end = data.result;
      const steps = 26;
      let i = 0;
      clearInterval(timer.current);
      await new Promise((resolve) => { timer.current = setInterval(() => {
        i++;
        setDisplay(1 + (end - 1) * Math.pow(i / steps, 2));
        if (i % 2 === 0) sfx.tick(i / steps);
        if (i >= steps) {
          clearInterval(timer.current); setDisplay(end); setLast(data);
          setHistory((h) => [{ v: end, won: data.won }, ...h].slice(0, 8));
          if (!data.won) sfx.lose();
          if (data.won) setWin({ multiplier: targetNum, payout: data.payout, coin: g.coin });
          resolve();
        }
      }, 20); });
      return { payout: data.payout, stake: g.stakeNum };
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
      return null;
    } finally {
      setLoading(false);
    }
  };

  const win_ = last?.won;
  const tone = last == null ? "from-white via-slate-100 to-slate-400" : win_ ? "from-emerald-200 via-emerald-400 to-emerald-600" : "from-red-300 via-red-500 to-red-700";

  return (
    <GameLayout title="Limbo" tag="1% edge" win={win} onWinClose={closeWin}
      controls={
        <BetControls {...g} disabled={loading || autoOn}>
          <div>
            <FieldLabel>Target multiplier</FieldLabel>
            <div className="relative">
              <input data-testid="limbo-target-input" type="number" min="1.01" step="0.01" value={target} disabled={autoOn}
                onChange={(e) => setTarget(e.target.value)}
                className="w-full bg-[#071024] border border-[#1D3157] rounded-xl px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-emerald-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 font-mono text-sm">×</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <StatBox label="Win chance" value={`${targetNum >= 1.01 ? (99 / targetNum).toFixed(2) : "0"}%`} testId="limbo-chance" />
            <StatBox label="Payout" value={`${(g.stakeNum * targetNum).toFixed(4)}`} testId="limbo-payout" accent />
          </div>
          <PlayArea g={g} play={play} onRunning={setAutoOn}
            manual={<PlayButton data-testid="limbo-play-button" onClick={play} loading={loading} icon={<Rocket size={16} />}>Place bet</PlayButton>} />
        </BetControls>
      }>
      <div className="flex-1 flex flex-col">
        <div className="flex gap-1.5 justify-end min-h-[26px]" data-testid="limbo-history">
          {history.map((h, i) => (
            <span key={i} className={`font-mono text-[11px] font-bold px-2 py-1 rounded-lg ${h.won ? "bg-emerald-500/15 text-emerald-300" : "bg-[#132543] text-slate-400"}`}>{h.v.toFixed(2)}×</span>
          ))}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center">
          <motion.div data-testid="limbo-result" animate={{ scale: last ? [1.08, 1] : 1 }}
            className={`font-mono font-black text-7xl sm:text-8xl tracking-tighter bg-gradient-to-b ${tone} bg-clip-text text-transparent drop-shadow-[0_4px_25px_rgba(34,211,238,0.25)]`}>
            {display.toFixed(2)}×
          </motion.div>
          <div className="mt-6 flex gap-3">
            <div className="bg-[#132543] border border-[#1D3157] rounded-xl px-4 py-2 text-center">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Target</p>
              <p className="font-mono font-bold text-white">{targetNum.toFixed(2)}×</p>
            </div>
            {last && (
              <div className={`rounded-xl px-4 py-2 text-center border ${win_ ? "bg-emerald-500/10 border-emerald-500/40" : "bg-red-500/10 border-red-500/40"}`}>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Result</p>
                <p className={`font-mono font-bold ${win_ ? "text-emerald-400" : "text-red-400"}`}>{win_ ? "Win" : "Bust"}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </GameLayout>
  );
}
