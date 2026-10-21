import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Copy, Users, Coins, TrendingUp, Gift, Pencil, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail, COIN_META } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { usePrices, fmtUsd } from "@/lib/prices";
import { usdValue, fmtCrypto, fmtAmt } from "@/lib/format";
import { AffiliateChart } from "@/components/AffiliateChart";

const copy = (text, what) => navigator.clipboard.writeText(text).then(() => toast.success(`${what} copied`));

function Stat({ icon: Icon, label, value, sub, testid, accent = "text-white" }) {
  return (
    <div className="bg-[#12141C] border border-[#2A2F45] rounded-2xl p-5" data-testid={testid}>
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-zinc-500"><Icon size={14} /> {label}</div>
      <p className={`font-display text-3xl font-black mt-2 ${accent}`}>{value}</p>
      {sub && <p className="text-[11px] text-zinc-500 mt-1">{sub}</p>}
    </div>
  );
}

function CoinList({ amounts }) {
  const entries = Object.entries(amounts || {}).filter(([, v]) => v > 0);
  if (!entries.length) return <span className="text-zinc-600">—</span>;
  return entries.map(([c, v]) => (
    <span key={c} className="block font-mono text-xs" style={{ color: COIN_META[c]?.color }}>{fmtAmt(v, c)}</span>
  ));
}

function CodeCard({ data, onSaved }) {
  const [edit, setEdit] = useState(false);
  const [code, setCode] = useState(data.code);
  const link = `${window.location.origin}/?ref=${data.code}`;
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await api.put("/affiliate/code", { code }); toast.success("Code updated"); setEdit(false); onSaved(); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };
  return (
    <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-[#0F1F1A] to-[#12141C] p-6">
      <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-emerald-500/10 blur-3xl" />
      <p className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400">Your affiliate code</p>
      <div className="flex flex-wrap items-center gap-3 mt-3">
        {edit ? (
          <input data-testid="aff-code-input" value={code} maxLength={16} onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="bg-[#090A0F] border border-emerald-500/50 rounded-xl px-4 py-2 font-mono text-2xl font-bold tracking-widest w-60 focus:outline-none" />
        ) : (
          <span data-testid="aff-code" className="font-mono text-3xl font-black tracking-widest">{data.code}</span>
        )}
        {edit ? (
          <button data-testid="aff-code-save" onClick={save} disabled={saving}
            className="flex items-center gap-1.5 bg-emerald-500 text-black font-semibold text-sm px-3 py-2 rounded-xl">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
          </button>
        ) : (
          <>
            <button data-testid="aff-copy-code" onClick={() => copy(data.code, "Code")}
              className="flex items-center gap-1.5 text-sm text-zinc-300 border border-[#2A2F45] hover:border-emerald-500/60 px-3 py-2 rounded-xl transition-colors"><Copy size={14} /> Copy</button>
            <button data-testid="aff-edit-code" onClick={() => { setCode(data.code); setEdit(true); }}
              className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white px-2 py-2 transition-colors"><Pencil size={14} /> Customize</button>
          </>
        )}
      </div>
      {!edit && (
        <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="aff-link-box">
          <span data-testid="aff-link" className="font-mono text-xs sm:text-sm text-emerald-200 bg-[#090A0F] border border-emerald-500/30 rounded-xl px-3 py-2 break-all">{link}</span>
          <button data-testid="aff-copy-link" onClick={() => copy(link, "Link")}
            className="flex items-center gap-1.5 text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 text-black px-3 py-2 rounded-xl transition-colors"><Copy size={14} /> Copy link</button>
        </div>
      )}
      <p className="mt-3 text-xs text-zinc-400" data-testid="aff-code-hint">Share your link, or have players enter your code at sign-up. Old codes keep working after you customize.</p>
    </div>
  );
}

function PlayersTable({ players, rates }) {
  if (!players.length) {
    return <p data-testid="aff-no-players" className="text-sm text-zinc-500 py-10 text-center">No referred players yet. Share your code to start earning.</p>;
  }
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm" data-testid="aff-players-table">
        <thead>
          <tr className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 text-left">
            <th className="py-2 pr-4">Player</th><th className="py-2 pr-4">Joined</th><th className="py-2 pr-4">NGR</th><th className="py-2">Your commission</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p, i) => {
            const ngr = Object.values(p.ngr).length ? usdValue(p.ngr, rates) : 0;
            return (
              <tr key={i} className="border-t border-[#1E2234]" data-testid={`aff-player-row-${i}`}>
                <td className="py-3 pr-4 font-semibold">{p.name}</td>
                <td className="py-3 pr-4 text-zinc-500 text-xs">{p.joined ? new Date(p.joined).toLocaleDateString() : "—"}</td>
                <td className={`py-3 pr-4 font-mono text-xs ${ngr < 0 ? "text-red-400" : "text-zinc-300"}`}>{fmtUsd(ngr)}</td>
                <td className="py-3"><CoinList amounts={p.commission} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Affiliate() {
  const { user, setAuthOpen, setBalances } = useAuth();
  const { rates } = usePrices();
  const [data, setData] = useState(null);
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(() => api.get("/affiliate").then(({ data }) => setData(data)).catch(() => {}), []);
  useEffect(() => { if (user) load(); }, [user, load]);

  const claim = async () => {
    setClaiming(true);
    try {
      const { data: r } = await api.post("/affiliate/claim");
      setBalances(r.balances);
      toast.success("Commission moved to your wallet");
      load();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    finally { setClaiming(false); }
  };

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center" data-testid="aff-signed-out">
        <Gift size={40} className="mx-auto text-emerald-400 mb-4" />
        <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tight">Earn 10% of every player you bring</h1>
        <p className="text-zinc-400 mt-3">Sign in to get your affiliate code.</p>
        <button data-testid="aff-signin" onClick={() => setAuthOpen(true)} className="mt-6 bg-emerald-500 hover:bg-emerald-400 text-black font-bold px-6 py-3 rounded-full">Sign in</button>
      </div>
    );
  }
  if (!data) return <div className="flex justify-center py-32"><Loader2 className="animate-spin text-emerald-400" /></div>;

  const availUsd = usdValue(data.available, rates);
  const lifeUsd = usdValue(data.lifetime, rates);
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-6xl mx-auto px-4 py-8 space-y-6" data-testid="affiliate-page">
      <div>
        <p className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400">Affiliate program</p>
        <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tight mt-1">Earn <span className="text-emerald-400">10%</span> of NGR. Forever.</h1>
        <p className="text-sm text-zinc-400 mt-2 max-w-2xl">You earn 10% of the house's net gaming revenue (stakes minus winnings) from every player who signs up with your code, on sports and house games.</p>
      </div>
      <CodeCard data={data} onSaved={load} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat icon={Users} label="Referred players" value={data.referrals} testid="aff-stat-referrals" />
        <div className="bg-[#12141C] border border-emerald-500/40 rounded-2xl p-5" data-testid="aff-stat-available">
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-zinc-500"><Coins size={14} /> Ready to claim</div>
          <p className="font-display text-3xl font-black mt-2 text-emerald-400" data-testid="aff-available-usd">{fmtUsd(availUsd)}</p>
          <div className="mt-1"><CoinList amounts={data.available} /></div>
          <button data-testid="aff-claim-button" onClick={claim} disabled={claiming || !Object.keys(data.available).length}
            className="mt-3 w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-2.5 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {claiming && <Loader2 size={14} className="animate-spin" />} Claim to wallet
          </button>
        </div>
        <Stat icon={TrendingUp} label="Lifetime earned" value={fmtUsd(lifeUsd)} testid="aff-stat-lifetime" sub="If a player is up overall, commission resumes once the house is back in profit." />
      </div>
      <AffiliateChart rates={rates} refreshKey={data.referrals} />
      <div className="bg-[#12141C] border border-[#2A2F45] rounded-2xl p-5">
        <h2 className="font-display text-lg font-bold uppercase tracking-tight mb-2">Your players</h2>
        <PlayersTable players={data.players} rates={rates} />
      </div>
    </motion.div>
  );
}
