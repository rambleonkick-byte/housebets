import { useCallback, useEffect, useState } from "react";
import { Loader2, TrendingUp, TrendingDown, ArrowDownToLine, ArrowUpFromLine, Trophy, Dices, Ticket, Lock } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { fmtUsd } from "@/lib/prices";
import { VipCard } from "@/components/VipCard";
import { PromoCodeBox } from "@/components/PromoCodeBox";
import { TierBadge } from "@/components/TierBadge";

function Stat({ icon: Icon, label, value, sub, tone, testid }) {
  return (
    <div className="bg-[#12141C] border border-[#2A2F45] rounded-2xl p-4" data-testid={testid}>
      <p className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-zinc-500"><Icon size={14} /> {label}</p>
      <p className={`font-display text-2xl font-black mt-1 ${tone || ""}`}>{value}</p>
      {sub && <p className="text-[11px] text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  );
}

const pnlTone = (v) => (v > 0 ? "text-emerald-400" : v < 0 ? "text-red-400" : "");
const signed = (v) => `${v > 0 ? "+" : ""}${fmtUsd(v)}`;

function Breakdown({ title, icon: Icon, rows, testid }) {
  return (
    <div className="bg-[#12141C] border border-[#2A2F45] rounded-2xl p-5" data-testid={testid}>
      <p className="flex items-center gap-2 font-bold mb-3"><Icon size={16} className="text-emerald-400" /> {title}</p>
      <dl className="space-y-2 text-sm">
        {rows.map(([k, v, tone]) => (
          <div key={k} className="flex justify-between"><dt className="text-zinc-500">{k}</dt><dd className={`font-mono font-semibold ${tone || ""}`}>{v}</dd></div>
        ))}
      </dl>
    </div>
  );
}

function Bonuses({ p }) {
  const w = p.wagering;
  const pct = w.target > 0 ? Math.min(100, ((w.target - w.remaining) / w.target) * 100) : 100;
  return (
    <div className="bg-[#12141C] border border-[#2A2F45] rounded-2xl p-5 space-y-4" data-testid="bonus-status">
      <p className="flex items-center gap-2 font-bold"><Ticket size={16} className="text-emerald-400" /> My bonuses</p>
      {w.remaining > 0 ? (
        <div data-testid="wagering-locked">
          <p className="text-sm flex items-center gap-1.5 text-amber-300"><Lock size={13} /> Wager {fmtUsd(w.remaining)} more to unlock withdrawals</p>
          <div className="h-2 rounded-full bg-[#090A0F] mt-2 overflow-hidden"><div className="h-full bg-amber-400" style={{ width: `${pct}%` }} /></div>
        </div>
      ) : <p className="text-sm text-zinc-400" data-testid="wagering-clear">No wagering requirement — withdrawals unlocked.</p>}
      {p.pending_match && <p className="text-sm text-sky-300" data-testid="pending-match">{p.pending_match.pct}% deposit match (up to {fmtUsd(p.pending_match.max_bonus)}) waiting for your next deposit</p>}
      <div>
        <p className="text-xs font-mono uppercase text-zinc-500 mb-1.5">Free bets</p>
        {p.free_bets.length ? (
          <ul className="flex flex-wrap gap-2" data-testid="free-bets-list">
            {p.free_bets.map((f) => <li key={f.id} className="text-xs font-mono font-bold text-emerald-300 border border-emerald-500/40 bg-emerald-500/10 rounded-full px-3 py-1">{fmtUsd(f.amount)} · {f.code}</li>)}
          </ul>
        ) : <p className="text-xs text-zinc-500">None right now.</p>}
      </div>
    </div>
  );
}

export default function Profile() {
  const { user, setAuthOpen } = useAuth();
  const [p, setP] = useState(null);
  const load = useCallback(() => api.get("/profile").then(({ data }) => setP(data)).catch(() => {}), []);
  useEffect(() => { if (user) load(); }, [user, load]);

  if (!user) return (
    <div className="text-center py-32" data-testid="profile-signin">
      <p className="text-zinc-400 mb-4">Sign in to see your profile.</p>
      <button onClick={() => setAuthOpen(true)} className="bg-emerald-500 text-black font-bold px-5 py-2 rounded-lg">Sign in</button>
    </div>
  );
  if (!p) return <Loader2 className="animate-spin text-emerald-400 mx-auto mt-32" />;
  const s = p.sports, c = p.casino;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6" data-testid="profile-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400">Player profile</p>
          <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tight flex items-center gap-3 flex-wrap" data-testid="profile-name">
            {p.name} <TierBadge name={p.vip.tier} size="lg" />
          </h1>
          <p className="text-xs text-zinc-500 mt-1">Member since {p.joined ? new Date(p.joined).toLocaleDateString() : "—"}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={p.pnl >= 0 ? TrendingUp : TrendingDown} label="Net P&L" value={signed(p.pnl)} tone={pnlTone(p.pnl)} sub="Sports + casino" testid="profile-pnl" />
        <Stat icon={ArrowDownToLine} label="Deposited" value={fmtUsd(p.deposits.total)} sub={`${p.deposits.count} deposits`} testid="profile-deposits" />
        <Stat icon={ArrowUpFromLine} label="Withdrawn" value={fmtUsd(p.withdrawals)} testid="profile-withdrawals" />
        <Stat icon={Trophy} label="Total wagered" value={fmtUsd(p.wagered)} sub={`Bonuses received ${fmtUsd(p.bonuses)}`} testid="profile-wagered" />
      </div>
      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
        <VipCard vip={p.vip} />
        <div className="space-y-6">
          <PromoCodeBox onRedeemed={load} />
          <Bonuses p={p} />
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <Breakdown title="Sportsbook" icon={Trophy} testid="profile-sports" rows={[
          ["Settled bets", s.bets], ["Open bets", s.open], ["Win rate", `${s.win_rate}%`], ["Staked", fmtUsd(s.staked)],
          ["Returned", fmtUsd(s.returned)], ["Biggest win", fmtUsd(s.biggest_win)], ["P&L", signed(s.pnl), pnlTone(s.pnl)]]} />
        <Breakdown title="Casino" icon={Dices} testid="profile-casino" rows={[
          ["Games played", c.games], ["Staked", fmtUsd(c.staked)], ["Returned", fmtUsd(c.returned)],
          ["Biggest win", fmtUsd(c.biggest_win)], ["P&L", signed(c.pnl), pnlTone(c.pnl)]]} />
      </div>
    </div>
  );
}
