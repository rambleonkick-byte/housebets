import { motion } from "framer-motion";
import { Check, Lock } from "lucide-react";
import { TierBadge, tierStyle } from "@/components/TierBadge";
import { fmtUsd } from "@/lib/prices";

const pts = (n) => (n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}K` : `${n}`);

export function VipCard({ vip }) {
  const { color } = tierStyle(vip.tier);
  return (
    <div className="bg-[#12141C] border border-[#2A2F45] rounded-2xl p-5 space-y-5" data-testid="vip-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-500">VIP rank</p>
          <div className="mt-2"><TierBadge name={vip.tier} size="lg" testid="vip-current-tier" /></div>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-mono uppercase text-zinc-500">Rank points</p>
          <p className="font-mono text-xl font-bold" data-testid="vip-points">{Math.floor(vip.points).toLocaleString()}</p>
        </div>
      </div>
      <div>
        <div className="h-2.5 rounded-full bg-[#090A0F] overflow-hidden">
          <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(100, vip.progress)}%` }} transition={{ duration: 0.9, ease: "easeOut" }}
            className="h-full rounded-full" style={{ background: color }} data-testid="vip-progress-bar" />
        </div>
        <p className="text-xs text-zinc-400 mt-2" data-testid="vip-next">
          {vip.next_tier ? <>{Math.ceil(vip.next_points - vip.points).toLocaleString()} points to <b className="text-white">{vip.next_tier}</b></> : "Top rank reached"}
        </p>
        <p className="text-[11px] text-zinc-500 mt-1">Every $1 on sports = {vip.sports_mult} points</p>
      </div>
      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="vip-ladder">
        {vip.tiers.map((t) => (
          <li key={t.name} data-testid={`vip-tier-${t.name.replace(/\s+/g, "-").toLowerCase()}`}
            className={`rounded-xl border p-2.5 ${t.name === vip.tier ? "border-emerald-500/60 bg-emerald-500/5" : "border-[#1E2234]"} ${t.reached ? "" : "opacity-60"}`}>
            <div className="flex items-center justify-between"><TierBadge name={t.name} />{t.reached ? <Check size={13} className="text-emerald-400" /> : <Lock size={12} className="text-zinc-600" />}</div>
            <p className="text-[10px] font-mono text-zinc-500 mt-1.5">{pts(t.points)} pts</p>
            {t.bonus > 0 && <p className="text-[11px] font-semibold text-emerald-300">{fmtUsd(t.bonus)} level-up</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
