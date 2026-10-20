import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { api, formatApiErrorDetail } from "@/lib/api";
import { BetControls, useGameBase, GameLayout, PlayButton, PlayArea, PILL_BTN, FieldLabel } from "@/components/casino/GameKit";
import { toast } from "sonner";
import { sfx } from "@/lib/sfx";

const RISKS = ["low", "medium", "high"];
const ROWS = [8, 12, 16];
const PLINKO_MULT = {
  8: { low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6], medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13], high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29] },
  12: { low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10], medium: [24, 5, 3, 1.6, 1, 0.5, 0.3, 0.5, 1, 1.6, 3, 5, 24], high: [58, 8, 3, 2, 0.5, 0.2, 0.2, 0.2, 0.5, 2, 3, 8, 58] },
  16: { low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16], medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110], high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000] },
};
// warm heat-map from centre (yellow) to edges (red)
const bucketColor = (i, n) => {
  const d = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);
  const hue = 50 - d * 50;
  return { bg: `hsl(${hue} 95% 55%)`, shadow: `hsl(${hue} 90% 32%)` };
};
const DROP_MS = 1400;

// random left/right path that lands in `bucket` after `rows` pegs
function pathTo(bucket, rows) {
  const moves = Array.from({ length: rows }, (_, i) => (i < bucket ? 1 : 0)).sort(() => Math.random() - 0.5);
  const xs = [0];
  moves.forEach((m) => xs.push(xs[xs.length - 1] + (m ? 0.5 : -0.5)));
  return xs;
}

export function Plinko() {
  const g = useGameBase();
  const [risk, setRisk] = useState("medium");
  const [rows, setRows] = useState(12);
  const [loading, setLoading] = useState(false);
  const [autoOn, setAutoOn] = useState(false);
  const [ball, setBall] = useState(null);
  const [landed, setLanded] = useState(null);
  const [win, setWin] = useState(null);
  const closeWin = useCallback(() => setWin(null), []);
  const mults = PLINKO_MULT[rows][risk];

  const play = async () => {
    setWin(null);
    if (!g.user) { g.setAuthOpen(true); return null; }
    if (g.stakeNum <= 0) { toast.error("Enter a bet amount"); return null; }
    if (g.stakeNum > g.balance) { toast.error("Insufficient balance"); return null; }
    setLoading(true); setLanded(null);
    try {
      const { data } = await api.post("/casino/plinko", { coin: g.coin, stake: g.stakeNum, risk, rows });
      setBall({ id: Date.now(), xs: pathTo(data.bucket, rows) });
      // peg ticks accelerate with the ease-in fall
      for (let r = 1; r <= rows; r++) setTimeout(sfx.peg, DROP_MS * Math.sqrt(r / (rows + 1)));
      await new Promise((r) => setTimeout(r, DROP_MS));
      {
        g.setBalances(data.balances); setLanded(data.bucket);
        if (data.multiplier > 1) setWin({ multiplier: data.multiplier, payout: data.payout, coin: g.coin });
        else { (data.multiplier >= 1 ? sfx.draw : sfx.lose)(); toast(`${data.multiplier}× — ${data.payout} ${g.coin}`); }
        setLoading(false);
      }
      return { payout: data.payout, stake: g.stakeNum };
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
      setLoading(false);
      return null;
    }
  };

  const gap = rows === 16 ? 22 : rows === 12 ? 28 : 38;
  return (
    <GameLayout title="Plinko" tag="drop & win" win={win} onWinClose={closeWin}
      controls={
        <BetControls {...g} disabled={loading || autoOn}>
          <div>
            <FieldLabel>Risk</FieldLabel>
            <div className="flex gap-1.5">
              {RISKS.map((r) => (
                <button key={r} data-testid={`plinko-risk-${r}`} disabled={loading || autoOn} onClick={() => { sfx.click(); setRisk(r); }} className={PILL_BTN(risk === r) + " capitalize"}>{r}</button>
              ))}
            </div>
          </div>
          <div>
            <FieldLabel>Rows</FieldLabel>
            <div className="flex gap-1.5">
              {ROWS.map((r) => (
                <button key={r} data-testid={`plinko-rows-${r}`} disabled={loading || autoOn} onClick={() => { sfx.click(); setRows(r); }} className={PILL_BTN(rows === r) + " font-mono"}>{r}</button>
              ))}
            </div>
          </div>
          <PlayArea g={g} play={play} onRunning={setAutoOn}
            manual={<PlayButton data-testid="plinko-play-button" onClick={play} loading={loading}>Drop ball</PlayButton>} />
        </BetControls>
      }>
      <div className="flex-1 flex flex-col items-center justify-end gap-3" data-testid="plinko-board">
        <div className="relative" style={{ width: gap * (rows + 2), height: gap * rows }}>
          {Array.from({ length: rows }).map((_, r) => (
            <div key={r} className="absolute left-1/2 -translate-x-1/2 flex" style={{ top: r * gap + gap / 2, gap: gap - 8 }}>
              {Array.from({ length: r + 3 }).map((_, c) => (
                <span key={c} className="w-2 h-2 rounded-full bg-slate-200 shadow-[0_0_6px_rgba(255,255,255,0.7)]" />
              ))}
            </div>
          ))}
          {ball && (
            <motion.span key={ball.id} data-testid="plinko-ball"
              className="absolute w-3.5 h-3.5 -ml-[7px] rounded-full bg-gradient-to-br from-yellow-200 to-amber-500 shadow-[0_0_14px_rgba(251,191,36,0.9)] z-10"
              style={{ left: "50%" }}
              initial={{ x: 0, y: 0 }}
              animate={{ x: ball.xs.map((x) => x * gap), y: ball.xs.map((_, i) => i * gap + gap / 2 - 10) }}
              transition={{ duration: DROP_MS / 1000, ease: "easeIn" }} />
          )}
        </div>
        <div className="flex justify-center" style={{ gap: 4, width: gap * (rows + 1) }}>
          {mults.map((m, i) => {
            const c = bucketColor(i, mults.length);
            return (
              <motion.div key={`${rows}-${risk}-${i}`} data-testid={`plinko-bucket-${i}`}
                animate={landed === i ? { y: [0, 6, 0] } : { y: 0 }} transition={{ duration: 0.35 }}
                className="flex-1 text-center py-1.5 rounded-md font-mono text-[9px] sm:text-[11px] font-black text-slate-950"
                style={{ background: c.bg, boxShadow: `0 4px 0 ${c.shadow}${landed === i ? `, 0 0 18px ${c.bg}` : ""}` }}>
                {m}×
              </motion.div>
            );
          })}
        </div>
      </div>
    </GameLayout>
  );
}
