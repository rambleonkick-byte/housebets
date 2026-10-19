import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { BetControls, useGameBase, GameLayout } from "@/components/casino/GameKit";
import { toast } from "sonner";

const RISKS = ["low", "medium", "high"];
const ROWS = [8, 12, 16];
const MULT_COLOR = (m) => (m >= 10 ? "#F59E0B" : m >= 2 ? "#22C55E" : m >= 1 ? "#10B981" : "#EF4444");

export function Plinko() {
  const g = useGameBase();
  const [risk, setRisk] = useState("medium");
  const [rows, setRows] = useState(12);
  const [loading, setLoading] = useState(false);
  const [buckets, setBuckets] = useState([]);
  const [ballCol, setBallCol] = useState(null);
  const [hits, setHits] = useState({});

  const play = async () => {
    if (!g.user) return g.setAuthOpen(true);
    if (g.stakeNum <= 0) return toast.error("Enter a bet amount");
    if (g.stakeNum > g.balance) return toast.error("Insufficient balance");
    setLoading(true);
    try {
      const { data } = await api.post("/casino/plinko", { coin: g.coin, stake: g.stakeNum, risk, rows });
      setBallCol(data.bucket);
      setTimeout(() => {
        g.setBalances(data.balances);
        setHits((h) => ({ ...h, [data.bucket]: (h[data.bucket] || 0) + 1, t: Date.now() }));
        if (data.multiplier >= 1) toast.success(`${data.multiplier}× — ${data.payout} ${g.coin}`);
        else toast.error(`${data.multiplier}× — ${data.payout} ${g.coin}`);
        setLoading(false);
      }, 900);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
      setLoading(false);
    }
  };

  // local multiplier labels (visual only; payout from server)
  const PLINKO_MULT = {
    8: { low: [5.6,2.1,1.1,1,0.5,1,1.1,2.1,5.6], medium:[13,3,1.3,0.7,0.4,0.7,1.3,3,13], high:[29,4,1.5,0.3,0.2,0.3,1.5,4,29] },
    12:{ low:[10,3,1.6,1.4,1.1,1,0.5,1,1.1,1.4,1.6,3,10], medium:[24,5,3,1.6,1,0.5,0.3,0.5,1,1.6,3,5,24], high:[58,8,3,2,0.5,0.2,0.2,0.2,0.5,2,3,8,58] },
    16:{ low:[16,9,2,1.4,1.4,1.2,1.1,1,0.5,1,1.1,1.2,1.4,1.4,2,9,16], medium:[110,41,10,5,3,1.5,1,0.5,0.3,0.5,1,1.5,3,5,10,41,110], high:[1000,130,26,9,4,2,0.2,0.2,0.2,0.2,0.2,2,4,9,26,130,1000] },
  };
  const mults = PLINKO_MULT[rows][risk];

  return (
    <GameLayout title="Plinko" tag="House Game · drop & win"
      controls={
        <BetControls {...g} disabled={loading}>
          <div>
            <p className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 mb-1.5">Risk</p>
            <div className="flex gap-1.5">
              {RISKS.map((r) => (
                <button key={r} data-testid={`plinko-risk-${r}`} disabled={loading} onClick={() => setRisk(r)}
                  className={`flex-1 text-xs font-medium py-2 rounded-md capitalize border transition-colors disabled:opacity-50 ${
                    risk === r ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-[#2A2F45] text-zinc-400"
                  }`}>{r}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 mb-1.5">Rows</p>
            <div className="flex gap-1.5">
              {ROWS.map((r) => (
                <button key={r} data-testid={`plinko-rows-${r}`} disabled={loading} onClick={() => setRows(r)}
                  className={`flex-1 text-xs font-mono py-2 rounded-md border transition-colors disabled:opacity-50 ${
                    rows === r ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-[#2A2F45] text-zinc-400"
                  }`}>{r}</button>
              ))}
            </div>
          </div>
          <button data-testid="plinko-play-button" onClick={play} disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-3 rounded-lg transition-colors disabled:opacity-60">
            {loading && <Loader2 size={16} className="animate-spin" />} Drop Ball
          </button>
        </BetControls>
      }>
      <div className="flex-1 flex flex-col justify-between" data-testid="plinko-board">
        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-4">
          {Array.from({ length: rows }).map((_, r) => (
            <div key={r} className="flex gap-2 sm:gap-2.5">
              {Array.from({ length: r + 3 }).map((_, c) => (
                <span key={c} className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
              ))}
            </div>
          ))}
        </div>
        <div className="flex gap-1 justify-center flex-wrap">
          {mults.map((m, i) => (
            <motion.div key={i} data-testid={`plinko-bucket-${i}`}
              animate={ballCol === i && loading ? { y: [-6, 0], scale: [1.15, 1] } : {}}
              className="flex-1 min-w-[26px] text-center py-1 rounded font-mono text-[10px] sm:text-xs font-bold"
              style={{ background: `${MULT_COLOR(m)}22`, color: MULT_COLOR(m) }}>
              {m}×
            </motion.div>
          ))}
        </div>
      </div>
    </GameLayout>
  );
}
