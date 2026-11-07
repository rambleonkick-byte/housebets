import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Dices } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { BetControls, useGameBase, GameLayout, PlayButton, PlayArea, PILL_BTN, FieldLabel, StatBox } from "@/components/casino/GameKit";
import { toast } from "sonner";
import { sfx } from "@/lib/sfx";

function Track({ target, direction, last }) {
  const winLeft = direction === "over" ? target : 0;
  const winWidth = direction === "over" ? 100 - target : target;
  return (
    <div className="relative">
      <div className="relative h-4 rounded-full bg-gradient-to-r from-red-600 to-rose-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)] overflow-hidden">
        <div className="absolute inset-y-0 bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_0_15px_rgba(34,211,238,0.5)] transition-[left,width] duration-150"
          style={{ left: `${winLeft}%`, width: `${winWidth}%` }} />
      </div>
      <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-lg bg-white border-4 border-[#14274A] shadow-[0_0_12px_rgba(255,255,255,0.6)] transition-[left] duration-150"
        style={{ left: `${target}%` }} />
      {last && (
        <motion.div key={last.nonce ?? last.roll} initial={{ left: "50%", opacity: 0, y: -6 }}
          animate={{ left: `${Math.min(100, Math.max(0, last.roll))}%`, opacity: 1, y: 0 }} transition={{ type: "spring", damping: 16 }}
          className="absolute -top-14 -translate-x-1/2" data-testid="dice-roll-marker">
          <div className={`font-mono text-base font-black px-3 py-1.5 rounded-xl border-t border-white/20 ${last.won ? "bg-emerald-500 text-emerald-950 shadow-[0_0_20px_rgba(34,211,238,0.6)]" : "bg-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.5)]"}`}>
            {last.roll.toFixed(2)}
          </div>
          <div className={`w-3 h-3 rotate-45 mx-auto -mt-1.5 ${last.won ? "bg-emerald-500" : "bg-red-500"}`} />
        </motion.div>
      )}
      <div className="flex justify-between mt-4 font-mono text-xs text-slate-500">
        {[0, 25, 50, 75, 100].map((n) => <span key={n}>{n}</span>)}
      </div>
    </div>
  );
}

export function Dice() {
  const g = useGameBase();
  const [target, setTarget] = useState(50);
  const [direction, setDirection] = useState("over");
  const [loading, setLoading] = useState(false);
  const [autoOn, setAutoOn] = useState(false);
  const [last, setLast] = useState(null);
  const [win, setWin] = useState(null);
  const closeWin = useCallback(() => setWin(null), []);

  const chance = direction === "over" ? 100 - target : target;
  const mult = chance > 0 ? (0.99 * 100) / chance : 0;

  const play = async () => {
    setWin(null);
    if (!g.user) { g.setAuthOpen(true); return null; }
    if (g.stakeNum <= 0) { toast.error("Enter a bet amount"); return null; }
    if (g.stakeNum > g.balance) { toast.error("Insufficient balance"); return null; }
    setLoading(true);
    try {
      const { data } = await api.post("/casino/dice", { coin: g.coin, stake: g.stakeNum, target, direction });
      g.setBalances(data.balances);
      setLast({ ...data, nonce: Date.now() });
      if (!data.won) setTimeout(sfx.lose, 350);
      if (data.won) setTimeout(() => setWin({ multiplier: data.payout / g.stakeNum, payout: data.payout, coin: g.coin }), 450);
      await new Promise((r) => setTimeout(r, 450));
      return { payout: data.payout, stake: g.stakeNum };
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
      return null;
    } finally {
      setLoading(false);
    }
  };

  return (
    <GameLayout title="Dice" tag="roll over / under" win={win} onWinClose={closeWin}
      controls={
        <BetControls {...g} disabled={loading || autoOn}>
          <div>
            <FieldLabel>Direction</FieldLabel>
            <div className="flex gap-1.5">
              {["under", "over"].map((d) => (
                <button key={d} data-testid={`dice-direction-${d}`} disabled={loading || autoOn} onClick={() => { sfx.click(); setDirection(d); }}
                  className={PILL_BTN(direction === d) + " capitalize"}>Roll {d} {d === "over" ? "▲" : "▼"}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <StatBox label={direction === "over" ? "Over" : "Under"} value={target} testId="dice-target-value" />
            <StatBox label="Chance" value={`${chance.toFixed(2)}%`} testId="dice-chance" />
            <StatBox label="Payout" value={`${mult.toFixed(4)}×`} testId="dice-multiplier" accent />
          </div>
          <PlayArea g={g} play={play} onRunning={setAutoOn}
            manual={<PlayButton data-testid="dice-play-button" onClick={play} loading={loading} icon={<Dices size={16} />}>Roll dice</PlayButton>} />
        </BetControls>
      }>
      <div className="flex-1 flex flex-col justify-center px-2 sm:px-8">
        <div className="bg-[#0C1A36] border border-[#1D3157] rounded-2xl px-5 pt-20 pb-5">
          <div className="relative">
            <Track target={target} direction={direction} last={last} />
            <input data-testid="dice-target-slider" type="range" min="2" max="98" step="1" value={target} disabled={loading || autoOn}
              onChange={(e) => { const v = parseInt(e.target.value, 10); if (v % 4 === 0) sfx.tick(v / 100); setTarget(v); }} aria-label="Dice target"
              className="absolute inset-x-0 top-0 h-4 w-full opacity-0 cursor-pointer" />
          </div>
        </div>
        <p className="text-center mt-6 font-mono text-sm text-slate-400 min-h-[20px]" data-testid="dice-result">
          {last && <>Rolled <span className={last.won ? "text-emerald-400" : "text-red-400"}>{last.roll.toFixed(2)}</span> · need {direction} {target} · {last.won ? `won ${last.payout} ${g.coin}` : "no win"}</>}
        </p>
      </div>
    </GameLayout>
  );
}
