import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Gem, Bomb } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { BetControls, useGameBase, GameLayout, PlayButton, TILE, PILL_BTN, FieldLabel, StatBox } from "@/components/casino/GameKit";
import { toast } from "sonner";
import { sfx } from "@/lib/sfx";

const MINE = "bg-gradient-to-br from-red-400 via-rose-600 to-red-900 text-white border-red-300/40 shadow-[0_5px_0_#7F1D1D,0_0_22px_rgba(239,68,68,0.6),inset_0_2px_3px_rgba(255,255,255,0.35)]";

export function Mines() {
  const g = useGameBase();
  const [mineCount, setMineCount] = useState(3);
  const [game, setGame] = useState(null);
  const [revealed, setRevealed] = useState([]);
  const [mines, setMines] = useState([]);
  const [mult, setMult] = useState(1);
  const [nextMult, setNextMult] = useState(1);
  const [cashValue, setCashValue] = useState(0);
  const [status, setStatus] = useState("idle");
  const [loading, setLoading] = useState(false);
  const [win, setWin] = useState(null);
  const closeWin = useCallback(() => setWin(null), []);

  const start = async () => {
    setWin(null);
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
        sfx.bomb();
        setMines(data.mines); setStatus("lost"); g.setBalances(data.balances);
        toast.error("Boom! You hit a mine");
      } else {
        sfx.gem();
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
      setWin({ multiplier: data.multiplier, payout: data.payout, coin: g.coin });
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally { setLoading(false); }
  };

  const active = status === "active";
  const over = status === "lost" || status === "won";

  return (
    <GameLayout title="Mines" tag="reveal the gems" win={win} onWinClose={closeWin}
      controls={
        <BetControls {...g} disabled={active || loading}>
          <div>
            <FieldLabel>Mines</FieldLabel>
            <div className="flex gap-1.5">
              {[1, 3, 5, 10, 24].map((m) => (
                <button key={m} data-testid={`mines-count-${m}`} disabled={active || loading} onClick={() => { sfx.click(); setMineCount(m); }}
                  className={PILL_BTN(mineCount === m) + " font-mono"}>{m}</button>
              ))}
            </div>
          </div>
          {active && (
            <div className="grid grid-cols-2 gap-2">
              <StatBox label="Current" value={`${mult.toFixed(2)}×`} testId="mines-multiplier" accent />
              <StatBox label="Next tile" value={nextMult > 0 ? `${nextMult.toFixed(2)}×` : "—"} testId="mines-next" />
            </div>
          )}
          {active ? (
            <PlayButton data-testid="mines-cashout-button" tone="amber" onClick={cashout} loading={loading} disabled={revealed.length === 0}>
              Cash out {revealed.length > 0 ? `${cashValue.toFixed(4)} ${g.coin}` : ""}
            </PlayButton>
          ) : (
            <PlayButton data-testid="mines-start-button" onClick={start} loading={loading}>Start game</PlayButton>
          )}
        </BetControls>
      }>
      <div className="flex-1 flex items-center justify-center">
        <div className="grid grid-cols-5 gap-2.5 sm:gap-3 w-full max-w-md" data-testid="mines-grid">
          {Array.from({ length: 25 }).map((_, i) => {
            const isRevealed = revealed.includes(i);
            const showMine = over && mines.includes(i);
            const state = isRevealed ? TILE.hit : showMine ? MINE : over ? TILE.dim : TILE.idle;
            return (
              <motion.button key={i} data-testid={`mines-tile-${i}`} disabled={!active || loading || isRevealed}
                onClick={() => reveal(i)}
                animate={isRevealed || showMine ? { scale: [0.85, 1.08, 1], rotateY: [90, 0] } : { scale: 1 }}
                transition={{ duration: 0.35 }}
                className={`aspect-square ${TILE.base} ${state} ${active && !isRevealed ? "cursor-pointer" : ""}`}>
                {isRevealed && <Gem size={26} strokeWidth={2.2} />}
                {showMine && !isRevealed && <Bomb size={26} strokeWidth={2.2} />}
              </motion.button>
            );
          })}
        </div>
      </div>
    </GameLayout>
  );
}
