import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, Undo2, ExternalLink, HandCoins, LifeBuoy } from "lucide-react";
import { api, COIN_META, explorerUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { fmtCrypto } from "@/lib/format";
import { Usd } from "@/components/Usd";

export const WD_STAGE = {
  sent: { title: "Withdrawal sent", sub: "Approved & broadcast on-chain", Icon: ArrowUpFromLine, tone: "amber" },
  confirmed: { title: "Withdrawal confirmed", sub: "Delivered to your wallet", Icon: CheckCircle2, tone: "emerald" },
  refunded: { title: "Withdrawal refunded", sub: "Returned to your balance", Icon: Undo2, tone: "red" },
};
export const TONE = {
  emerald: { border: "border-emerald-500/40", glow: "rgba(16,185,129,0.5)", bg: "bg-emerald-500/15", text: "text-emerald-400" },
  amber: { border: "border-amber-500/40", glow: "rgba(245,158,11,0.45)", bg: "bg-amber-500/15", text: "text-amber-400" },
  sky: { border: "border-sky-500/40", glow: "rgba(14,165,233,0.45)", bg: "bg-sky-500/15", text: "text-sky-400" },
  red: { border: "border-red-500/40", glow: "rgba(239,68,68,0.45)", bg: "bg-red-500/15", text: "text-red-400" },
};

function AlertToast({ a, kind, title, sub, Icon, tone, sign }) {
  const url = explorerUrl(a.coin, a.tx_hash, a.net);
  const t = TONE[tone];
  return (
    <div data-testid={`${kind}-alert`} className={`w-[340px] bg-[#12141C] border ${t.border} rounded-xl p-4`}
      style={{ boxShadow: `0 10px 40px -10px ${t.glow}` }}>
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-full ${t.bg} flex items-center justify-center shrink-0`}>
          <Icon size={17} className={t.text} />
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-[11px] font-mono uppercase tracking-[0.2em] ${t.text}`} data-testid={`${kind}-alert-title`}>{title}</p>
          <p className="font-mono text-lg font-bold text-white" data-testid={`${kind}-alert-amount`}>
            {sign}{fmtCrypto(a.amount, a.coin)} <span style={{ color: COIN_META[a.coin]?.color }}>{a.coin}</span>
          </p>
          <Usd amount={a.amount} coin={a.coin} className="text-xs text-zinc-400" />
          {sub && <p className="text-[11px] text-zinc-500 mt-0.5">{sub}</p>}
          {url && (
            <a href={url} target="_blank" rel="noreferrer" data-testid={`${kind}-alert-tx-link`}
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
  const qc = useQueryClient();
  useEffect(() => {
    if (!user) return;
    const poll = async () => {
      try {
        const { data } = await api.get("/wallet/deposit-alerts");
        const wds = data.withdrawals || [];
        const cos = data.cashouts || [];
        const lbs = data.lossbacks || [];
        if (!data.alerts.length && !wds.length && !cos.length && !lbs.length) return;
        lbs.forEach((l) => toast.custom(() => (
          <AlertToast a={l} kind="lossback" title="10% lossback" sub={`You got ${fmtCrypto(l.amount, l.coin)} ${l.coin} back on your losing bet`} Icon={LifeBuoy} tone="emerald" sign="+" />
        ), { duration: 12000 }));
        cos.forEach((c) => toast.custom(() => (
          <AlertToast a={c} kind="cashout" title="Auto cash out" sub="Your target was hit — winnings added" Icon={HandCoins} tone="sky" sign="+" />
        ), { duration: 12000 }));
        if (data.balances) setBalances(data.balances);
        qc.invalidateQueries({ queryKey: ["notifications"] });
        data.alerts.forEach((a) => toast.custom(() => (
          <AlertToast a={a} kind="deposit" title="Deposit received" Icon={ArrowDownToLine} tone="emerald" sign="+" />
        ), { duration: 12000 }));
        wds.forEach((w) => toast.custom(() => (
          <AlertToast a={w} kind="withdrawal" {...WD_STAGE[w.stage]} sign={w.stage === "refunded" ? "+" : "-"} />
        ), { duration: 12000 }));
      } catch { /* retry next tick */ }
    };
    poll();
    const t = setInterval(poll, 15000);
    return () => clearInterval(t);
  }, [user?.id]);
  return null;
}
