import { useRef, useEffect } from "react";
import { useBetSlip } from "@/context/BetSlipContext";
import { fmtOdds } from "@/lib/format";

function OddsButton({ sel, meta }) {
  const { addSelection, has } = useBetSlip();
  const active = has(sel);
  const ref = useRef(null);
  const prev = useRef(sel.odds);

  useEffect(() => {
    if (prev.current !== sel.odds && ref.current) {
      const cls = sel.odds > prev.current ? "flash-up" : "flash-down";
      ref.current.classList.add(cls);
      const t = setTimeout(() => ref.current && ref.current.classList.remove(cls), 700);
      prev.current = sel.odds;
      return () => clearTimeout(t);
    }
    prev.current = sel.odds;
  }, [sel.odds]);

  return (
    <button
      ref={ref}
      data-testid={`odds-button-${meta.event_id}-${sel.market}-${sel.side}`}
      onClick={() => addSelection({ ...meta, market: sel.market, side: sel.side, pick: sel.pick, line: sel.line, odds: sel.odds })}
      className={`flex flex-col items-center justify-center py-2 rounded-md border transition-all ${
        active
          ? "bg-emerald-500 border-emerald-400 text-black"
          : "bg-[#0E1017] border-[#2A2F45] hover:border-emerald-500/60 hover:bg-[#161922] text-zinc-200"
      }`}>
      <span className={`text-[10px] font-medium truncate max-w-full px-1 ${active ? "text-black/70" : "text-zinc-500"}`}>
        {sel.pick}
      </span>
      <span className="font-mono text-sm font-bold tracking-wide">{fmtOdds(sel.odds)}</span>
    </button>
  );
}

export function MatchCard({ ev }) {
  const live = ev.state === "in";
  const meta = {
    event_id: ev.event_id, league: ev.league, league_label: ev.league_label,
    home: ev.home.abbr, away: ev.away.abbr,
  };
  const moneyline = ev.markets.find((m) => m.market === "moneyline");
  const spread = ev.markets.find((m) => m.market === "spread");
  const total = ev.markets.find((m) => m.market === "total");

  return (
    <div data-testid={`match-card-${ev.event_id}`}
      className="bg-[#12141C] border border-[#2A2F45] rounded-lg overflow-hidden hover:border-[#374063] transition-colors">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#1E2234]">
        <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">{ev.league_label}</span>
        {live ? (
          <span className="flex items-center gap-1.5 text-[11px] font-mono text-red-400">
            <span className="live-dot w-1.5 h-1.5 rounded-full bg-red-500" /> LIVE · {ev.status_detail}
          </span>
        ) : ev.state === "post" ? (
          <span className="text-[11px] font-mono text-zinc-500">FINAL</span>
        ) : (
          <span className="text-[11px] font-mono text-zinc-500">{ev.status_detail || "Upcoming"}</span>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
        <div className="space-y-2 min-w-0">
          {[ev.away, ev.home].map((t, i) => (
            <div key={i} className="flex items-center gap-2.5">
              {t.logo ? (
                <img src={t.logo} alt="" className="w-6 h-6 object-contain" />
              ) : (
                <div className="w-6 h-6 rounded bg-[#222636]" />
              )}
              <span className="text-sm font-semibold truncate">{t.name}</span>
              {(live || ev.state === "post") && t.score != null && (
                <span className="ml-auto font-mono text-sm font-bold text-emerald-400">{t.score}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 pb-4 space-y-3">
        {moneyline && (
          <Market label="Moneyline" cols={moneyline.selections.length}>
            {moneyline.selections.map((s) => (
              <OddsButton key={s.side} sel={{ ...s, market: "moneyline" }} meta={meta} />
            ))}
          </Market>
        )}
        <div className="grid grid-cols-2 gap-3">
          {spread && (
            <Market label="Spread" cols={2}>
              {spread.selections.map((s) => (
                <OddsButton key={s.side} sel={{ ...s, market: "spread" }} meta={meta} />
              ))}
            </Market>
          )}
          {total && (
            <Market label="Total" cols={2}>
              {total.selections.map((s) => (
                <OddsButton key={s.side} sel={{ ...s, market: "total" }} meta={meta} />
              ))}
            </Market>
          )}
        </div>
      </div>
    </div>
  );
}

function Market({ label, cols, children }) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-600 mb-1.5">{label}</p>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
        {children}
      </div>
    </div>
  );
}
