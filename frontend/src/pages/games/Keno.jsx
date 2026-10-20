import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Eraser, Shuffle, Gem } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { BetControls, useGameBase, GameLayout, PlayButton, TILE, StatBox } from "@/components/casino/GameKit";
import { toast } from "sonner";
import { sfx } from "@/lib/sfx";

const KENO_TABLE = {
  1: [0, 1.9], 2: [0, 0, 4.5], 3: [0, 0, 1.4, 8], 4: [0, 0, 0, 2.2, 13],
  5: [0, 0, 0, 1.5, 4, 30], 6: [0, 0, 0, 1, 2, 8, 50],
  7: [0, 0, 0, 0.5, 1.5, 4, 15, 80], 8: [0, 0, 0, 0.5, 1, 2.5, 8, 30, 100],
  9: [0, 0, 0, 0, 1, 2, 5, 12, 45, 150], 10: [0, 0, 0, 0, 0.6, 1.5, 3, 8, 20, 60, 200],
};

function PayoutBar({ picks, hits }) {
  const row = KENO_TABLE[picks];
  if (!row) return <p className="text-center text-xs text-slate-500 py-3">Pick 1–10 numbers to see payouts</p>;
  return (
    <div data-testid="keno-payout-table" className="bg-[#12141C] border border-[#2A2F45] rounded-xl p-1.5 flex gap-1 overflow-x-auto">
      {row.map((m, h) => {
        const on = hits === h;
        return (
          <div key={h} data-testid={`keno-payout-${h}`}
            className={`flex-1 min-w-[44px] rounded-lg py-1.5 text-center border transition-[transform,background-color] ${on ? "bg-emerald-500/20 border-emerald-400 scale-105 shadow-[0_0_12px_rgba(16,185,129,0.35)]" : "bg-[#1A1D28] border-transparent"}`}>
            <p className={`font-mono text-[11px] font-bold ${on ? "text-emerald-300" : m > 0 ? "text-white" : "text-slate-500"}`}>{m}×</p>
            <p className="flex items-center justify-center gap-0.5 font-mono text-[10px] text-slate-500">{h}<Gem size={9} className="text-emerald-400" /></p>
          </div>
        );
      })}
    </div>
  );
}

export function Keno() {
  const g = useGameBase();
  const [picks, setPicks] = useState([]);
  const [drawn, setDrawn] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [win, setWin] = useState(null);
  const closeWin = useCallback(() => setWin(null), []);

  const toggle = (n) => {
    if (loading) return;
    if (picks.includes(n)) sfx.unpick(); else if (picks.length < 10) sfx.pick();
    setPicks((p) => p.includes(n) ? p.filter((x) => x !== n) : p.length >= 10 ? p : [...p, n]);
    setDrawn([]); setResult(null);
  };
  const clear = () => { setPicks([]); setDrawn([]); setResult(null); };
  const auto = () => {
    const picked = [];
    while (picked.length < 8) {
      const x = 1 + Math.floor(Math.random() * 40);
      if (!picked.includes(x)) picked.push(x);
    }
    sfx.pick();
    setPicks(picked); setDrawn([]); setResult(null);
  };

  const play = async () => {
    if (!g.user) return g.setAuthOpen(true);
    if (picks.length === 0) return toast.error("Pick 1–10 numbers");
    if (g.stakeNum <= 0) return toast.error("Enter a bet amount");
    if (g.stakeNum > g.balance) return toast.error("Insufficient balance");
    setLoading(true); setDrawn([]); setResult(null);
    try {
      const { data } = await api.post("/casino/keno", { coin: g.coin, stake: g.stakeNum, picks });
      data.drawn.forEach((n, i) => setTimeout(() => { (picks.includes(n) ? sfx.hit : sfx.draw)(); setDrawn((d) => [...d, n]); }, i * 110));
      setTimeout(() => {
        g.setBalances(data.balances); setResult(data);
        if (data.multiplier > 1) setWin({ multiplier: data.multiplier, payout: data.payout, coin: g.coin });
        else { sfx.lose(); toast(`${data.hits} hits · ${data.multiplier}×`); }
        setLoading(false);
      }, data.drawn.length * 110 + 250);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
      setLoading(false);
    }
  };

  return (
    <GameLayout title="Keno" tag="pick your numbers" win={win} onWinClose={closeWin}
      footer={<PayoutBar picks={picks.length} hits={result ? result.hits : -1} />}
      controls={
        <BetControls {...g} disabled={loading}>
          <div className="grid grid-cols-2 gap-2">
            <StatBox label="Selected" value={`${picks.length}/10`} testId="keno-selected-count" accent />
            <StatBox label="Hits" value={result ? `${result.hits} · ${result.multiplier}×` : "—"} testId="keno-hits" />
          </div>
          <div className="flex gap-2">
            <button data-testid="keno-auto" onClick={auto} disabled={loading}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-300 bg-[#1A1D28] border border-[#2A2F45] rounded-lg py-2 hover:text-white hover:border-violet-400/50 disabled:opacity-50 transition-colors">
              <Shuffle size={13} /> Auto pick
            </button>
            <button data-testid="keno-clear" onClick={clear} disabled={loading}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-300 bg-[#1A1D28] border border-[#2A2F45] rounded-lg py-2 hover:text-white hover:border-red-400/50 disabled:opacity-50 transition-colors">
              <Eraser size={13} /> Clear
            </button>
          </div>
          <PlayButton data-testid="keno-play-button" onClick={play} loading={loading}>Play Keno</PlayButton>
        </BetControls>
      }>
      <div className="flex-1 flex items-center justify-center">
        <div className="grid grid-cols-8 gap-2 sm:gap-2.5 w-full max-w-xl" data-testid="keno-grid">
          {Array.from({ length: 40 }).map((_, idx) => {
            const n = idx + 1;
            const picked = picks.includes(n);
            const hit = drawn.includes(n);
            const state = hit && picked ? TILE.hit : hit ? TILE.miss : picked ? TILE.picked : drawn.length && !loading ? TILE.dim : TILE.idle;
            return (
              <motion.button key={n} data-testid={`keno-cell-${n}`} onClick={() => toggle(n)} disabled={loading}
                animate={hit ? { scale: [1.18, 1], rotate: picked ? [0, -4, 0] : 0 } : { scale: 1 }}
                className={`aspect-square text-sm sm:text-base ${TILE.base} ${state}`}>
                {hit && picked ? <span className="flex flex-col items-center leading-none"><Gem size={16} /><span className="text-[10px] mt-0.5">{n}</span></span> : n}
              </motion.button>
            );
          })}
        </div>
      </div>
    </GameLayout>
  );
}
