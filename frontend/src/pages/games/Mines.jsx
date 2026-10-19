import { useState } from "react";
import { motion } from "framer-motion";
import { Gem, Bomb, Loader2 } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { BetControls, useGameBase, GameLayout } from "@/components/casino/GameKit";
import { toast } from "sonner";

export function Mines() {
  const g = useGameBase();
  const [mineCount, setMineCount] = useState(3);
  const [game, setGame] = useState(null); // {game_id}
  const [revealed, setRevealed] = useState([]);
  const [mines, setMines] = useState([]);
  const [mult, setMult] = useState(1);
  const [nextMult, setNextMult] = useState(1);
  const [cashValue, setCashValue] = useState(0);
  const [status, setStatus] = useState("idle"); // idle | active | lost | won
  const [loading, setLoading] = useState(false);

  const start = async () => {
    if (!g.user) return g.setAuthOpen(true);
    if (g.stakeNum <= 0) return toast.error("Enter a bet amount");
    if (g.stakeNum > g.balance) return toast.error("Insufficient balance");
    setLoading(true);
    try {
      const { data } = await api.post("/casino/mines/start", { coin: g.coin, stake: g.stakeNum, mines: mineCount });
      g.setBalances(data.balances);
      setGame(data); setRevealed([]); setMines([]); setMult(1); setCashValue(g.stakeNum);
      setNextMult(0); setStatus("active");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally { setLoading(false); }
  };

  const reveal = async (tile) => {
    if (status !== "active" || revealed.includes(tile) || loading) return;
    setLoading(true);
    try {
      const { data } = await api.post("/casino/mines/reveal", { game_id: game.game_id, tile });
      if (data.hit) {
        setMines(data.mines); setStatus("lost"); g.setBalances(data.balances);
        toast.error("Boom! You hit a mine");
      } else {
        setRevealed(data.revealed); setMult(data.multiplier);
        setNextMult(data.next_multiplier); setCashValue(data.cashout_value);
      }
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally { setLoading(false); }
  };

  const cashout = async () => {
    setLoading(true);
    try {
      const { data } = await api.post("/casino/mines/cashout", { game_id: game.game_id });
      g.setBalances(data.balances); setMines(data.mines); setStatus("won");
      toast.success(`Cashed out ${data.payout} ${g.coin} at ${data.multiplier}×`);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally { setLoading(false); }
  };

  const active = status === "active";
  const over = status === "lost" || status === "won";

  return (
    <GameLayout title="Mines" tag="House Game · reveal the gems"
      controls={
        <BetControls {...g} disabled={active || loading}>
          <div>
            <p className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 mb-1.5">Mines (1–24)</p>
            <div className="flex gap-1.5 flex-wrap">
              {[1, 3, 5, 10, 24].map((m) => (
                <button key={m} data-testid={`mines-count-${m}`} disabled={active || loading} onClick={() => setMineCount(m)}
                  className={`flex-1 text-xs font-mono py-2 rounded-md border transition-colors disabled:opacity-50 ${
                    mineCount === m ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-[#2A2F45] text-zinc-400"
                  }`}>{m}</button>
              ))}
            </div>
          </div>
          {active && (
            <div className="flex items-center justify-between text-sm bg-[#0E1017] rounded-lg px-3 py-2 border border-[#2A2F45]">
              <span className="text-zinc-400 text-xs">Current</span>
              <span className="font-mono font-bold text-emerald-400" data-testid="mines-multiplier">{mult.toFixed(2)}×</span>
            </div>
          )}
          {active ? (
            <button data-testid="mines-cashout-button" onClick={cashout} disabled={loading || revealed.length === 0}
              className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold py-3 rounded-lg transition-colors disabled:opacity-50">
              {loading && <Loader2 size={16} className="animate-spin" />}
              Cash Out {revealed.length > 0 ? `${cashValue.toFixed(4)} ${g.coin}` : ""}
            </button>
          ) : (
            <button data-testid="mines-start-button" onClick={start} disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-3 rounded-lg transition-colors disabled:opacity-60">
              {loading && <Loader2 size={16} className="animate-spin" />} Start Game
            </button>
          )}
          {active && nextMult > 0 && (
            <p className="text-[11px] font-mono text-zinc-500 text-center">Next tile → {nextMult.toFixed(2)}×</p>
          )}
        </BetControls>
      }>
      <div className="flex-1 flex items-center justify-center">
        <div className="grid grid-cols-5 gap-2 sm:gap-2.5 w-full max-w-sm" data-testid="mines-grid">
          {Array.from({ length: 25 }).map((_, i) => {
            const isRevealed = revealed.includes(i);
            const isMine = mines.includes(i);
            const showMine = over && isMine;
            return (
              <motion.button key={i} data-testid={`mines-tile-${i}`} disabled={!active || loading || isRevealed}
                onClick={() => reveal(i)} whileHover={active && !isRevealed ? { scale: 1.05 } : {}}
                whileTap={active ? { scale: 0.95 } : {}}
                className={`aspect-square rounded-lg flex items-center justify-center border transition-colors ${
                  isRevealed ? "bg-emerald-500/20 border-emerald-500/60"
                  : showMine ? "bg-red-500/20 border-red-500/60"
                  : "bg-[#0E1017] border-[#2A2F45] hover:border-emerald-500/40"
                }`}>
                {isRevealed && <Gem size={20} className="text-emerald-400" />}
                {showMine && !isRevealed && <Bomb size={20} className="text-red-400" />}
              </motion.button>
            );
          })}
        </div>
      </div>
    </GameLayout>
  );
}
