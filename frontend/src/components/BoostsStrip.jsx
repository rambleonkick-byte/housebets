import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Flame, ChevronsRight, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { fmtOdds } from "@/lib/format";
import { useBetSlip } from "@/context/BetSlipContext";

const TIER = {
  super: { pill: "bg-rose-500 text-white", arrow: "text-rose-400", glow: "hover:shadow-[0_10px_30px_-12px_rgba(244,63,94,0.6)]" },
  botd: { pill: "bg-emerald-500 text-black", arrow: "text-emerald-400", glow: "hover:shadow-[0_10px_30px_-12px_rgba(34,211,238,0.6)]" },
  golden: { pill: "bg-amber-400 text-black", arrow: "text-amber-400", glow: "hover:shadow-[0_10px_30px_-12px_rgba(251,191,36,0.6)]" },
  boosted: { pill: "bg-sky-500 text-white", arrow: "text-sky-400", glow: "hover:shadow-[0_10px_30px_-12px_rgba(14,165,233,0.6)]" },
};
const MARKET = { moneyline: "Match winner", total: "Total", spread: "Spread", prop: "Player prop" };

function useCountdown(iso) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = Math.max(0, new Date(iso).getTime() - now);
  const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000), s = Math.floor((left % 60000) / 1000);
  return { left, text: [h, m, s].map((v) => String(v).padStart(2, "0")).join(" : ") };
}

function BoostCard({ b, i }) {
  const { loadSlip, boost } = useBetSlip();
  const { left, text } = useCountdown(b.starts_at);
  const t = TIER[b.tier] || TIER.boosted;
  const d = new Date(b.starts_at);
  const when = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} · ${d.toTimeString().slice(0, 5)}`;
  const active = boost?.id === b.id;
  if (!b.live && left <= 5 * 60000) return null;
  return (
    <motion.div data-testid={`boost-card-${b.tier}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
      className={`w-[300px] sm:w-[320px] shrink-0 bg-[#16181F] border rounded-2xl p-4 flex flex-col transition-shadow ${t.glow} ${active ? "border-emerald-500/70" : "border-[#1B2F55]"}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-md border border-zinc-600 flex items-center justify-center text-[9px] font-black text-zinc-300">HB</span>
          <span data-testid={`boost-tier-${b.tier}`} className={`text-[11px] font-black uppercase tracking-wide rounded-md px-2 py-0.5 ${t.pill}`}>{b.label}</span>
        </div>
        <span data-testid={`boost-countdown-${b.tier}`} className={`font-mono text-[11px] font-bold rounded-md px-2 py-0.5 ${b.live ? "bg-red-500 text-white animate-pulse" : "bg-white text-black"}`}>{b.live ? "● LIVE" : text}</span>
      </div>
      <div className="flex items-center justify-between mt-4 text-[12px]">
        <span className="flex items-center gap-1.5 text-zinc-400 truncate"><Trophy size={13} /> {b.league_label}</span>
        <span className="font-semibold text-white shrink-0">{when}</span>
      </div>
      <p className="font-bold text-sm text-white mt-1 truncate" data-testid={`boost-matchup-${b.tier}`}>{b.away} vs {b.home}</p>
      <ul className="mt-2 space-y-1.5 flex-1">
        {b.legs.map((l, k) => (
          <li key={k} className="relative flex items-start gap-2.5 text-[12px] min-w-0">
            <span className="relative z-10 mt-[3px] w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0" />
            {k < b.legs.length - 1 && <span className="absolute left-[4px] top-3 h-[calc(100%+2px)] w-0.5 bg-emerald-400/70" />}
            <span className="line-clamp-2 leading-snug"><span className="font-semibold text-white">{l.pick}</span>{l.market !== "prop" && <span className="text-zinc-500"> - {MARKET[l.market] || l.market}</span>}</span>
          </li>
        ))}
      </ul>
      <button data-testid={`boost-add-${b.tier}`} onClick={() => loadSlip(b.legs, { id: b.id, pct: b.pct, label: b.label, fixed: b.fixed_odds })}
        className="mt-4 w-full flex items-center justify-center gap-4 bg-white hover:bg-zinc-200 text-black rounded-xl py-3 font-mono text-sm transition-colors active:scale-[0.98]">
        <span className="line-through text-zinc-500" data-testid={`boost-base-${b.tier}`}>{fmtOdds(b.base_odds)}</span>
        <ChevronsRight size={16} className={t.arrow} />
        <span className="font-bold" data-testid={`boost-odds-${b.tier}`}>{fmtOdds(b.boosted_odds)}</span>
      </button>
    </motion.div>
  );
}

export function BoostsStrip({ ready }) {
  const [boosts, setBoosts] = useState([]);
  useEffect(() => {
    if (!ready) return;
    const load = () => api.get("/boosts").then(({ data }) => setBoosts(data.boosts || [])).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [ready]);
  if (!boosts.length) return null;
  return (
    <section className="px-4 pt-1 pb-4" data-testid="boosts-strip">
      <div className="flex items-center gap-2 mb-3">
        <Flame size={18} className="text-amber-400" />
        <h2 className="font-display text-xl font-bold tracking-tight uppercase">Boosted Odds</h2>
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
        {boosts.map((b, i) => <BoostCard key={b.id} b={b} i={i} />)}
      </div>
    </section>
  );
}
