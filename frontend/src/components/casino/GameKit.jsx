import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, ShieldCheck, Volume2, VolumeX } from "lucide-react";
import { sfx } from "@/lib/sfx";
import { COIN_META } from "@/lib/api";
import { fmtCrypto } from "@/lib/format";
import { Usd } from "@/components/Usd";
import { useAuth } from "@/context/AuthContext";

const COINS = ["USDT", "BTC", "ETH", "SOL"];

// 3D bevelled tile states shared by Keno & Mines
export const TILE = {
  base: "relative rounded-xl font-mono font-bold flex items-center justify-center select-none transition-[transform,background-color,box-shadow,color] duration-150 border-t border-white/10 shadow-[0_5px_0_#0B0D14,0_8px_14px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.08)]",
  idle: "bg-gradient-to-b from-[#252A3A] to-[#1C2030] text-slate-300 hover:from-[#2D3346] hover:to-[#232839] hover:-translate-y-0.5 hover:text-white active:translate-y-1 active:shadow-[0_1px_0_#0B0D14]",
  picked: "bg-gradient-to-b from-[#7C3AED] to-[#5B21B6] text-white border-violet-300/40 shadow-[0_5px_0_#3B1478,0_0_18px_rgba(139,92,246,0.45),inset_0_1px_0_rgba(255,255,255,0.3)]",
  hit: "bg-gradient-to-br from-emerald-300 via-emerald-500 to-emerald-700 text-emerald-950 font-black border-emerald-200/60 shadow-[0_5px_0_#065F46,0_0_22px_rgba(16,185,129,0.65),inset_0_2px_3px_rgba(255,255,255,0.55)]",
  miss: "bg-[#14161F] text-red-400 shadow-[inset_0_2px_6px_rgba(0,0,0,0.8)] border-transparent",
  dim: "bg-[#14161F] text-slate-600 shadow-[inset_0_2px_6px_rgba(0,0,0,0.7)] border-transparent",
};

export const PILL_BTN = (active) =>
  `flex-1 text-xs font-semibold py-2 rounded-lg border transition-[background-color,border-color,color] disabled:opacity-50 ${
    active ? "border-emerald-500 bg-emerald-500/15 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.2)]" : "border-[#2A2F45] bg-[#1A1D28] text-slate-400 hover:text-white hover:bg-[#222637]"}`;

export function FieldLabel({ children, right }) {
  return (
    <div className="flex items-center justify-between mb-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{children}</p>
      {right}
    </div>
  );
}

export function PlayButton({ loading, icon, children, tone = "emerald", ...rest }) {
  const tones = {
    emerald: "bg-[#10B981] hover:bg-[#34D399] shadow-[0_4px_0_#047857,0_8px_24px_rgba(16,185,129,0.35)]",
    amber: "bg-amber-400 hover:bg-amber-300 shadow-[0_4px_0_#B45309,0_8px_24px_rgba(245,158,11,0.35)]",
  };
  return (
    <button {...rest} onClick={(e) => { sfx.bet(); rest.onClick?.(e); }} disabled={loading || rest.disabled}
      className={`w-full py-3.5 rounded-xl font-display font-black text-sm uppercase tracking-wider text-slate-950 flex items-center justify-center gap-2 transition-[transform,background-color,box-shadow] active:translate-y-1 active:shadow-none disabled:opacity-50 disabled:active:translate-y-0 ${tones[tone]}`}>
      {loading ? <Loader2 size={16} className="animate-spin" /> : icon}{children}
    </button>
  );
}

export function StatBox({ label, value, testId, accent }) {
  return (
    <div className="bg-[#090A0F] border border-[#2A2F45] rounded-xl px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p data-testid={testId} className={`font-mono text-sm font-bold ${accent ? "text-emerald-400" : "text-white"}`}>{value}</p>
    </div>
  );
}

export function BetControls({ coin, setCoin, stake, setStake, balance, disabled, children }) {
  return (
    <div className="space-y-4">
      <div>
        <FieldLabel>Currency</FieldLabel>
        <div className="flex gap-1.5">
          {COINS.map((c) => (
            <button key={c} data-testid={`game-coin-${c}`} disabled={disabled} onClick={() => { sfx.click(); setCoin(c); }}
              className={PILL_BTN(coin === c) + " font-mono"}
              style={coin === c ? { color: COIN_META[c].color, borderColor: COIN_META[c].color } : undefined}>{c}</button>
          ))}
        </div>
      </div>
      <div>
        <FieldLabel right={<Usd amount={stake} coin={coin} className="text-[11px] text-slate-500" />}>Bet amount</FieldLabel>
        <div className="flex items-stretch bg-[#090A0F] border border-[#2A2F45] rounded-xl focus-within:border-emerald-500 transition-colors overflow-hidden">
          <input data-testid="game-stake-input" type="number" min="0" value={stake} disabled={disabled}
            onChange={(e) => setStake(e.target.value)} placeholder="0.00"
            className="flex-1 min-w-0 bg-transparent px-3 py-2.5 font-mono text-sm text-white outline-none disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
          {[["½", "game-stake-half", () => (parseFloat(stake) || 0) / 2], ["2×", "game-stake-double", () => (parseFloat(stake) || 0) * 2], ["MAX", "game-stake-max", () => balance]].map(([l, id, f]) => (
            <button key={id} data-testid={id} disabled={disabled} onClick={() => { sfx.click(); setStake(String(f())); }}
              className={`px-3 text-[11px] font-mono font-bold border-l border-[#2A2F45] bg-[#1A1D28] hover:bg-[#252A3B] disabled:opacity-50 transition-colors ${l === "MAX" ? "text-emerald-400" : "text-slate-300"}`}>{l}</button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] font-mono text-slate-500">
          Balance <span style={{ color: COIN_META[coin].color }}>{fmtCrypto(balance, coin)} {coin}</span> <Usd amount={balance} coin={coin} prefix="· " />
        </p>
      </div>
      {children}
    </div>
  );
}

export function useGameBase() {
  const { user, setBalances, setAuthOpen } = useAuth();
  const [coin, setCoin] = useState("USDT");
  const [stake, setStake] = useState("10");
  const balance = user?.balances?.[coin] ?? 0;
  const stakeNum = parseFloat(stake) || 0;
  return { user, setBalances, setAuthOpen, coin, setCoin, stake, setStake, balance, stakeNum };
}

export function MuteToggle() {
  const [m, setM] = useState(sfx.isMuted());
  useEffect(() => sfx.subscribe(setM), []);
  return (
    <button data-testid="game-sound-toggle" onClick={() => sfx.setMuted(!m)} aria-label={m ? "Unmute sounds" : "Mute sounds"}
      className={`w-8 h-8 rounded-full flex items-center justify-center border transition-colors ${m ? "border-[#2A2F45] text-slate-500 hover:text-white" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"}`}>
      {m ? <VolumeX size={15} /> : <Volume2 size={15} />}
    </button>
  );
}

// Glowing win card over the board; auto-hides, click to dismiss.
export function BigWin({ win, onClose }) {
  useEffect(() => {
    if (!win) return;
    (win.multiplier >= 5 ? sfx.bigWin : sfx.win)();
    const t = setTimeout(onClose, 2600);
    return () => clearTimeout(t);
  }, [win, onClose]);
  return (
    <AnimatePresence>
      {win && (
        <motion.div data-testid="big-win-overlay" onClick={onClose}
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 backdrop-blur-[2px] cursor-pointer"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0 } }}>
          <motion.div initial={{ scale: 0.7, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0 } }}
            transition={{ type: "spring", damping: 14, stiffness: 260 }}
            className="relative min-w-[200px] text-center rounded-2xl border-2 border-emerald-400 bg-[#12141C]/95 px-8 py-5 shadow-[0_0_60px_rgba(16,185,129,0.45)] overflow-hidden">
            <div className="absolute -inset-10 bg-gradient-to-r from-emerald-500/20 via-teal-400/25 to-emerald-500/20 blur-2xl pointer-events-none" />
            <p data-testid="big-win-multiplier" className="relative font-mono font-black text-4xl text-emerald-400 drop-shadow-[0_0_14px_rgba(16,185,129,0.7)]">
              {Number(win.multiplier).toFixed(2)}×
            </p>
            <div className="relative h-px my-3 bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent" />
            <p data-testid="big-win-payout" className="relative font-mono text-base font-bold text-white">
              {fmtCrypto(win.payout, win.coin)} {win.coin}
            </p>
            <Usd amount={win.payout} coin={win.coin} prefix="" className="relative text-xs text-slate-400" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function GameLayout({ title, tag, controls, children, footer, win, onWinClose }) {
  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.25em] text-emerald-400">ApexOdds Originals · {tag}</p>
          <h1 className="font-display text-3xl sm:text-4xl font-black tracking-tight text-white">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-3 py-1">
            <ShieldCheck size={13} /> Provably fair
          </span>
          <MuteToggle />
        </div>
      </div>
      <div className="grid lg:grid-cols-[330px_1fr] gap-4 items-start">
        <div className="bg-[#12141C] border border-[#2A2F45] rounded-2xl p-5 shadow-xl order-2 lg:order-1">{controls}</div>
        <div className="order-1 lg:order-2 relative bg-[#0F1119] border border-[#2A2F45] rounded-2xl shadow-2xl overflow-hidden"
          style={{ backgroundImage: "radial-gradient(90% 60% at 50% 0%, rgba(16,185,129,0.08), transparent 70%)" }}>
          <div className="p-4 sm:p-6 min-h-[440px] flex">{children}</div>
          {footer && <div className="px-4 sm:px-6 pb-4 sm:pb-5">{footer}</div>}
          <BigWin win={win} onClose={onWinClose} />
        </div>
      </div>
    </div>
  );
}
