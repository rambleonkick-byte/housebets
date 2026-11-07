import { useState } from "react";
import { HandCoins, Loader2, Lock } from "lucide-react";
import { AutoCashout } from "@/components/AutoCashout";
import { fmtCrypto, fmtAmt } from "@/lib/format";
import { Usd } from "@/components/Usd";

export function CashoutButton({ bet, value, onCashout, onSetAuto }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  if (value === undefined) return null;
  const auto = <AutoCashout bet={bet} value={value} onSave={onSetAuto} />;
  if (!value) {
    return (
      <>
      <div data-testid={`cashout-suspended-${bet.id}`}
        className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-zinc-500 border border-dashed border-[#1D3157] rounded-lg py-2">
        <Lock size={12} /> Cash out unavailable right now
      </div>
      {auto}
      </>
    );
  }
  const go = async () => {
    if (!confirm) { setConfirm(true); setTimeout(() => setConfirm(false), 4000); return; }
    setBusy(true);
    await onCashout(bet);
    setBusy(false);
    setConfirm(false);
  };
  return (
    <>
    <button data-testid={`cashout-button-${bet.id}`} onClick={go} disabled={busy}
      className={`mt-2 w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-60 ${
        confirm ? "bg-sky-500 text-black" : "bg-sky-500/10 border border-sky-500/30 text-sky-300 hover:bg-sky-500/20"}`}>
      <span className="flex items-center gap-1.5">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <HandCoins size={13} />}
        {confirm ? "Tap again to confirm" : "Cash out"}
      </span>
      <span className="font-mono" data-testid={`cashout-value-${bet.id}`}>
        {fmtAmt(value, bet.coin)}{" "}
        {bet.coin !== "USD" && <><Usd amount={value} coin={bet.coin} prefix="(" className={confirm ? "text-black/60" : "text-sky-300/60"} />)</>}
      </span>
    </button>
    {auto}
    </>
  );
}
