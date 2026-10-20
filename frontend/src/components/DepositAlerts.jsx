import { useEffect } from "react";
import { toast } from "sonner";
import { ArrowDownToLine, ExternalLink } from "lucide-react";
import { api, COIN_META, explorerUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { fmtCrypto } from "@/lib/format";
import { Usd } from "@/components/Usd";

function DepositToast({ a }) {
  const url = explorerUrl(a.coin, a.tx_hash, a.net);
  return (
    <div data-testid="deposit-alert" className="w-[340px] bg-[#12141C] border border-emerald-500/40 rounded-xl p-4 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.5)]">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
          <ArrowDownToLine size={17} className="text-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-emerald-400">Deposit received</p>
          <p className="font-mono text-lg font-bold text-white" data-testid="deposit-alert-amount">
            +{fmtCrypto(a.amount, a.coin)} <span style={{ color: COIN_META[a.coin]?.color }}>{a.coin}</span>
          </p>
          <Usd amount={a.amount} coin={a.coin} className="text-xs text-zinc-400" />
          {url && (
            <a href={url} target="_blank" rel="noreferrer" data-testid="deposit-alert-tx-link"
              className="mt-2 flex items-center gap-1.5 text-xs font-mono text-emerald-300 hover:text-emerald-200">
              <span className="truncate">{a.tx_hash.slice(0, 10)}…{a.tx_hash.slice(-6)}</span>
              <ExternalLink size={12} className="shrink-0" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export function DepositAlerts() {
  const { user, setBalances } = useAuth();
  useEffect(() => {
    if (!user) return;
    const poll = async () => {
      try {
        const { data } = await api.get("/wallet/deposit-alerts");
        if (!data.alerts.length) return;
        if (data.balances) setBalances(data.balances);
        data.alerts.forEach((a) => toast.custom(() => <DepositToast a={a} />, { duration: 12000 }));
      } catch { /* retry next tick */ }
    };
    poll();
    const t = setInterval(poll, 15000);
    return () => clearInterval(t);
  }, [user?.id]);
  return null;
}
