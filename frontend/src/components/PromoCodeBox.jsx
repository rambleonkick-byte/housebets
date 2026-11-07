import { useState } from "react";
import { Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

export function PromoCodeBox({ onRedeemed }) {
  const { setBalances } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const redeem = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/promo/redeem", { code: code.trim() });
      setBalances(data.balances);
      toast.success(data.message);
      setCode("");
      onRedeemed?.();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    setBusy(false);
  };
  return (
    <div className="bg-[#0C1A36] border border-[#1D3157] rounded-2xl p-5" data-testid="promo-code-box">
      <p className="flex items-center gap-2 font-bold"><Gift size={16} className="text-emerald-400" /> Promo code</p>
      <p className="text-xs text-zinc-500 mt-1">Got a code? Enter it for bonus cash, a free bet or a deposit match.</p>
      <div className="flex gap-2 mt-3">
        <input data-testid="promo-code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={32}
          onKeyDown={(e) => e.key === "Enter" && code.trim().length > 1 && redeem()} placeholder="ENTER CODE"
          className="flex-1 min-w-0 bg-[#071024] border border-[#1D3157] rounded-lg px-3 py-2.5 font-mono text-sm tracking-widest uppercase focus:outline-none focus:border-emerald-500" />
        <button data-testid="promo-code-submit" onClick={redeem} disabled={busy || code.trim().length < 2}
          className="bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm px-5 rounded-lg disabled:opacity-40">
          {busy ? <Loader2 size={16} className="animate-spin" /> : "Redeem"}
        </button>
      </div>
    </div>
  );
}
