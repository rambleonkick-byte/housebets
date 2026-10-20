import { useState } from "react";
import { Target, X } from "lucide-react";
import { fmtCrypto } from "@/lib/format";

export function AutoCashout({ bet, value, onSave }) {
  const max = bet.potential_payout * 0.95;
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (t) => {
    setBusy(true);
    if (await onSave(bet, t)) setEditing(false);
    setBusy(false);
  };
  const tNum = parseFloat(target);
  const valid = tNum > 0 && tNum < max;

  if (bet.auto_cashout && !editing) {
    return (
      <div data-testid={`auto-cashout-active-${bet.id}`} className="mt-1.5 flex items-center justify-between text-[11px] text-sky-300/90 bg-sky-500/5 border border-sky-500/20 rounded-lg px-3 py-1.5">
        <span className="flex items-center gap-1.5"><Target size={12} /> Auto cash out at <span className="font-mono">{fmtCrypto(bet.auto_cashout, bet.coin)} {bet.coin}</span></span>
        <span className="flex items-center gap-2">
          <button data-testid={`auto-cashout-edit-${bet.id}`} onClick={() => { setTarget(String(bet.auto_cashout)); setEditing(true); }} className="hover:text-white">Edit</button>
          <button data-testid={`auto-cashout-clear-${bet.id}`} onClick={() => save(null)} disabled={busy} aria-label="Remove auto cash out" className="hover:text-red-400"><X size={12} /></button>
        </span>
      </div>
    );
  }
  if (!editing) {
    return (
      <button data-testid={`auto-cashout-set-${bet.id}`} onClick={() => { setTarget(value ? (Math.min(value * 1.25, max * 0.99)).toFixed(4) : ""); setEditing(true); }}
        className="mt-1.5 w-full flex items-center justify-center gap-1.5 text-[11px] text-zinc-400 hover:text-sky-300 py-1">
        <Target size={12} /> Set auto cash out
      </button>
    );
  }
  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex gap-1.5">
        <input data-testid={`auto-cashout-input-${bet.id}`} type="number" min="0" value={target} onChange={(e) => setTarget(e.target.value)}
          placeholder={`Target ${bet.coin}`}
          className="flex-1 min-w-0 bg-[#090A0F] border border-[#2A2F45] rounded-lg px-2.5 py-1.5 font-mono text-xs focus:outline-none focus:border-sky-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
        <button data-testid={`auto-cashout-save-${bet.id}`} onClick={() => save(tNum)} disabled={!valid || busy}
          className="px-3 text-[11px] font-semibold bg-sky-500 text-black rounded-lg disabled:opacity-40">Save</button>
        <button data-testid={`auto-cashout-cancel-${bet.id}`} onClick={() => setEditing(false)} className="px-2 text-zinc-500 hover:text-white"><X size={13} /></button>
      </div>
      <p className="text-[10px] text-zinc-500">
        Cashes out automatically once the offer reaches your target. Max {fmtCrypto(max, bet.coin)} {bet.coin}.
      </p>
    </div>
  );
}
