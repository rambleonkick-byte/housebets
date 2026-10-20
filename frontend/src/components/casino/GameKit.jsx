import { useState } from "react";
import { COIN_META } from "@/lib/api";
import { fmtCrypto } from "@/lib/format";
import { Usd } from "@/components/Usd";
import { useAuth } from "@/context/AuthContext";

const COINS = ["USDT", "BTC", "ETH", "SOL"];

export function BetControls({ coin, setCoin, stake, setStake, balance, disabled, children }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 mb-1.5">Currency</p>
        <div className="flex gap-1.5">
          {COINS.map((c) => (
            <button key={c} data-testid={`game-coin-${c}`} disabled={disabled} onClick={() => setCoin(c)}
              className={`flex-1 text-xs font-mono font-semibold py-2 rounded-md border transition-colors disabled:opacity-50 ${
                coin === c ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-[#2A2F45] text-zinc-400"
              }`}>{c}</button>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">Bet amount</p>
          <span className="text-[11px] font-mono text-zinc-500">
            Bal: <span style={{ color: COIN_META[coin].color }}>{fmtCrypto(balance, coin)} {coin}</span> <Usd amount={balance} coin={coin} prefix="(" />{")"}
          </span>
        </div>
        <input data-testid="game-stake-input" type="number" min="0" value={stake} disabled={disabled}
          onChange={(e) => setStake(e.target.value)} placeholder="0.00"
          className="w-full bg-[#090A0F] border border-[#2A2F45] rounded-lg px-3 py-2.5 font-mono text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-50" />
        <div className="flex gap-1.5 mt-1.5">
          <button data-testid="game-stake-half" disabled={disabled} onClick={() => setStake(String((parseFloat(stake) || 0) / 2))}
            className="flex-1 text-[11px] font-mono text-zinc-400 border border-[#2A2F45] rounded py-1 hover:border-emerald-500/60 disabled:opacity-50">½</button>
          <button data-testid="game-stake-double" disabled={disabled} onClick={() => setStake(String((parseFloat(stake) || 0) * 2))}
            className="flex-1 text-[11px] font-mono text-zinc-400 border border-[#2A2F45] rounded py-1 hover:border-emerald-500/60 disabled:opacity-50">2×</button>
          <button data-testid="game-stake-max" disabled={disabled} onClick={() => setStake(String(balance))}
            className="flex-1 text-[11px] font-mono text-emerald-400 border border-emerald-500/40 rounded py-1 hover:bg-emerald-500/10 disabled:opacity-50">MAX</button>
        </div>
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

export function GameLayout({ title, tag, controls, children }) {
  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="mb-4">
        <p className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400">{tag}</p>
        <h1 className="font-display text-3xl sm:text-4xl font-black tracking-tight">{title}</h1>
      </div>
      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        <div className="bg-[#12141C] border border-[#2A2F45] rounded-xl p-4 h-fit order-2 lg:order-1">{controls}</div>
        <div className="bg-[#12141C] border border-[#2A2F45] rounded-xl p-4 min-h-[380px] flex order-1 lg:order-2">{children}</div>
      </div>
    </div>
  );
}
