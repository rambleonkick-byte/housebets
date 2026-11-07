import { useEffect, useState } from "react";
import { Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function VaultPanel({ onMoved }) {
  const { setBalances } = useAuth();
  const [state, setState] = useState(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get("/vault").then(({ data }) => setState(data)); }, []);

  const move = async (dir) => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter an amount"); return; }
    setBusy(true);
    try {
      const { data } = await api.post(`/vault/${dir}`, { amount: amt });
      setState(data); setBalances(data.balances); setAmount("");
      toast.success(dir === "deposit" ? `${money(amt)} locked in your vault` : `${money(amt)} moved to your balance`);
      onMoved?.();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    setBusy(false);
  };

  if (!state) return <div className="flex justify-center py-10"><Loader2 className="animate-spin text-zinc-500" size={18} /></div>;
  const bal = state.balances?.USD || 0;
  const max = (dir) => setAmount(String(Math.floor((dir === "deposit" ? bal : state.vault) * 100) / 100));
  return (
    <div className="space-y-3" data-testid="vault-panel">
      <div className="bg-gradient-to-br from-amber-500/10 to-transparent border border-amber-500/30 rounded-xl p-4 flex items-center gap-3">
        <div className="w-11 h-11 rounded-lg bg-amber-500/15 border border-amber-500/30 grid place-items-center"><Lock size={18} className="text-amber-300" /></div>
        <div className="mr-auto">
          <p className="text-[11px] font-mono uppercase tracking-wider text-amber-300">In your vault</p>
          <p className="font-mono text-2xl font-bold" data-testid="vault-balance">{money(state.vault)}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">Playable</p>
          <p className="font-mono text-sm text-zinc-200" data-testid="vault-playable-balance">{money(bal)}</p>
        </div>
      </div>
      <p className="text-[11px] text-zinc-500">Money in the vault can't be used for bets or games, so you can't spend it by accident. Move it back to your balance any time.</p>
      <input data-testid="vault-amount-input" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount in USD"
        className="w-full bg-[#071024] border border-[#1D3157] rounded-lg px-3 py-2.5 font-mono text-sm focus:outline-none focus:border-amber-400" />
      <div className="flex gap-2 text-[11px] font-mono">
        <button data-testid="vault-max-deposit" onClick={() => max("deposit")} className="text-zinc-500 hover:text-amber-300">Max from balance</button>
        <span className="text-zinc-700">·</span>
        <button data-testid="vault-max-withdraw" onClick={() => max("withdraw")} className="text-zinc-500 hover:text-amber-300">Max from vault</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button data-testid="vault-deposit-button" disabled={busy} onClick={() => move("deposit")}
          className="bg-amber-400 hover:bg-amber-300 text-black font-bold py-2.5 rounded-lg transition-colors disabled:opacity-60">Lock in vault</button>
        <button data-testid="vault-withdraw-button" disabled={busy} onClick={() => move("withdraw")}
          className="border border-[#1D3157] hover:border-amber-400 text-zinc-200 font-bold py-2.5 rounded-lg transition-colors disabled:opacity-60">Move to balance</button>
      </div>
    </div>
  );
}
