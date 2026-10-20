import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Gem, Bomb } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { BetControls, useGameBase, GameLayout, PlayButton, PlayArea, TILE, PILL_BTN, FieldLabel, StatBox } from "@/components/casino/GameKit";
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
  const [autoOn, setAutoOn] = useState(false);
  const [mode, setMode] = useState("manual");
  const [pattern, setPattern] = useState([]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

  const togglePattern = (i) => {
    if (autoOn) return;
    if (over) { setRevealed([]); setMines([]); setStatus("idle"); }
    setPattern((p) => {
      if (p.includes(i)) { sfx.unpick(); return p.filter((x) => x !== i); }
      if (p.length >= 25 - mineCount) return p;
      sfx.pick(); return [...p, i];
    });
  };

  // One automatic round: start, reveal the saved pattern in order, cash out if all safe.
  const autoRound = async () => {
    setWin(null);
    if (!g.user) { g.setAuthOpen(true); return null; }
    if (!pattern.length) { toast.error("Pick the tiles to reveal first"); return null; }
    if (pattern.length > 25 - mineCount) { toast.error("Too many tiles for this mine count"); return null; }
    if (g.stakeNum <= 0) { toast.error("Enter a bet amount"); return null; }
    if (g.stakeNum > g.balance) { toast.error("Insufficient balance"); return null; }
    const stake = g.stakeNum;
    setLoading(true);
    try {
      const { data: st } = await api.post("/casino/mines/start", { coin: g.coin, stake, mines: mineCount });
      g.setBalances(st.balances);
      setRevealed([]); setMines([]); setMult(1); setStatus("active");
      for (const tile of pattern) {
        await sleep(160);
        const { data } = await api.post("/casino/mines/reveal", { game_id: st.game_id, tile });
        if (data.hit) {
          sfx.bomb(); setMines(data.mines); setStatus("lost"); g.setBalances(data.balances);
          await sleep(500);
          return { payout: 0, stake };
        }
        sfx.gem(); setRevealed(data.revealed); setMult(data.multiplier);
      }
      const { data: co } = await api.post("/casino/mines/cashout", { game_id: st.game_id });
      g.setBalances(co.balances); setMines(co.mines); setStatus("won");
      setWin({ multiplier: co.multiplier, payout: co.payout, coin: g.coin });
      await sleep(700);
      return { payout: co.payout, stake };
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
      return null;
    } finally { setLoading(false); }
  };

  const active = status === "active";
  const over = status === "lost" || status === "won";

  return (
    <GameLayout title="Mines" tag="reveal the gems" win={win} onWinClose={closeWin}
      controls={
        <BetControls {...g} disabled={active || loading || autoOn}>
          <div>
            <FieldLabel>Mines</FieldLabel>
            <div className="flex gap-1.5">
              {[1, 3, 5, 10, 24].map((m) => (
                <button key={m} data-testid={`mines-count-${m}`} disabled={active || loading || autoOn} onClick={() => { sfx.click(); setMineCount(m); setPattern((p) => p.slice(0, 25 - m)); }}
                  className={PILL_BTN(mineCount === m) + " font-mono"}>{m}</button>
              ))}
            </div>
          </div>
          {active && mode === "manual" && (
            <div className="grid grid-cols-2 gap-2">
              <StatBox label="Current" value={`${mult.toFixed(2)}×`} testId="mines-multiplier" accent />
              <StatBox label="Next tile" value={nextMult > 0 ? `${nextMult.toFixed(2)}×` : "—"} testId="mines-next" />
            </div>
          )}
          {mode === "auto" && (
            <div className="flex items-center justify-between text-[11px] bg-violet-500/10 border border-violet-500/30 rounded-xl px-3 py-2" data-testid="mines-pattern-info">
              <span className="text-violet-200">{pattern.length ? `${pattern.length} tile${pattern.length > 1 ? "s" : ""} picked — replayed each round` : "Tap tiles on the board to pick your pattern"}</span>
              {pattern.length > 0 && !autoOn && (
                <button data-testid="mines-pattern-clear" onClick={() => setPattern([])} className="text-slate-400 hover:text-white">Clear</button>
              )}
            </div>
          )}
          <PlayArea g={g} play={autoRound} onRunning={setAutoOn} onMode={(m) => { setMode(m); if (m === "auto" && status !== "active") setStatus("idle"); }}
            manual={active ? (
              <PlayButton data-testid="mines-cashout-button" tone="amber" onClick={cashout} loading={loading} disabled={revealed.length === 0}>
                Cash out {revealed.length > 0 ? `${cashValue.toFixed(4)} ${g.coin}` : ""}
              </PlayButton>
            ) : (
              <PlayButton data-testid="mines-start-button" onClick={start} loading={loading}>Start game</PlayButton>
            )} />
        </BetControls>
      }>
      <div className="flex-1 flex items-center justify-center">
        <div className="grid grid-cols-5 gap-2.5 sm:gap-3 w-full max-w-md" data-testid="mines-grid">
          {Array.from({ length: 25 }).map((_, i) => {
            const isRevealed = revealed.includes(i);
            const showMine = over && mines.includes(i);
            const inPattern = mode === "auto" && pattern.includes(i);
            const picking = mode === "auto" && !autoOn && !active;
            const state = isRevealed ? TILE.hit : showMine ? MINE : inPattern && !over ? TILE.picked : over ? TILE.dim : TILE.idle;
            return (
              <motion.button key={i} data-testid={`mines-tile-${i}`}
                disabled={picking ? false : mode === "auto" || !active || loading || isRevealed}
                onClick={() => (picking ? togglePattern(i) : reveal(i))}
                animate={isRevealed || showMine ? { scale: [0.85, 1.08, 1], rotateY: [90, 0] } : { scale: 1 }}
                transition={{ duration: 0.35 }}
                className={`aspect-square ${TILE.base} ${state} ${active && !isRevealed ? "cursor-pointer" : ""}`}>
                {isRevealed && <Gem size={26} strokeWidth={2.2} />}
                {inPattern && !isRevealed && !showMine && !over && <span className="font-mono text-sm">{pattern.indexOf(i) + 1}</span>}
                {showMine && !isRevealed && <Bomb size={26} strokeWidth={2.2} />}
              </motion.button>
            );
          })}
        </div>
      </div>
    </GameLayout>
  );
}
