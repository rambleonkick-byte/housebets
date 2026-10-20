import { useRef, useEffect, useState } from "react";
import { AltLineSlider } from "@/components/AltLineSlider";
import { ChevronDown } from "lucide-react";
import { useBetSlip } from "@/context/BetSlipContext";
import { fmtOdds } from "@/lib/format";

function TeamLogo({ team }) {
  const [err, setErr] = useState(false);
  if (team.logo && !err) {
    return <img src={team.logo} alt="" className="w-6 h-6 object-contain" onError={() => setErr(true)} />;
  }
  return (
    <div className="w-6 h-6 rounded-md bg-[#222636] flex items-center justify-center text-[9px] font-bold text-zinc-300 shrink-0">
      {(team.abbr || "").slice(0, 3)}
    </div>
  );
}

export function OddsButton({ sel, meta }) {
  const { addSelection, has } = useBetSlip();
  const active = has({ ...sel, event_id: meta.event_id });
  const closed = meta.state === "post";
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
      disabled={closed}
      onClick={() => addSelection({ ...meta, market: sel.market, side: sel.side, pick: sel.pick, line: sel.line, odds: sel.odds })}
      className={`flex flex-col items-center justify-center py-2 rounded-md border transition-all ${
        active
          ? "bg-emerald-500 border-emerald-400 text-black"
          : "bg-[#0E1017] border-[#2A2F45] hover:border-emerald-500/60 hover:bg-[#161922] text-zinc-200"
      }`}>
      <span className={`text-[10px] font-medium truncate max-w-full px-1 ${active ? "text-black/70" : "text-zinc-500"}`}>
        {sel.label || sel.pick}
      </span>
      <span className="font-mono text-sm font-bold tracking-wide">{fmtOdds(sel.odds)}</span>
    </button>
  );
}

export const buildMeta = (ev) => ({
  event_id: ev.event_id, league: ev.league, league_label: ev.league_label,
  home: ev.home.abbr, away: ev.away.abbr,
  home_name: ev.home.name, away_name: ev.away.name, status_detail: ev.status_detail, live: ev.state === "in", state: ev.state,
});

export function MatchCard({ ev }) {
  const live = ev.state === "in";
  const meta = buildMeta(ev);
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

      {ev.book && (
        <div className="flex items-center gap-1.5 px-4 pt-2">
          <span className="text-[9px] font-mono uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-1.5 py-0.5">
            Live Odds · {ev.book}
          </span>
        </div>
      )}

      <div className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
        <div className="space-y-2 min-w-0">
          {[ev.away, ev.home].map((t, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <TeamLogo team={t} />
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
        {["alt_spread", "alt_total"].map((k) => {
          const m = ev.markets.find((x) => x.market === k);
          return m && <AltLineSlider key={k} ev={ev} m={m} main={k === "alt_spread" ? spread : total} meta={meta} />;
        })}
        {ev.markets.filter((m) => !["moneyline", "spread", "total", "alt_spread", "alt_total"].includes(m.market)).map((m) => (
          <Market key={m.market} label={m.label} cols={m.selections.length}>
            {m.selections.map((s) => (
              <OddsButton key={s.side} sel={{ ...s, market: m.market }} meta={meta} />
            ))}
          </Market>
        ))}
      </div>
      {ev.props && ev.props.length > 0 && <PropsSection ev={ev} meta={meta} />}
    </div>
  );
}

function PropsSection({ ev, meta }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-4 pb-4 border-t border-[#1E2234] pt-3">
      <button data-testid={`props-toggle-${ev.event_id}`} onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-zinc-400 hover:text-emerald-300 transition-colors">
        <span>Player Props ({ev.props.length})</span>
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-1.5 max-h-72 overflow-y-auto scrollbar-thin pr-1" data-testid={`props-list-${ev.event_id}`}>
          {ev.props.map((p, i) => (
            <div key={i} className="grid gap-1.5 items-center" style={{ gridTemplateColumns: "1fr 4.25rem 4.25rem" }}>
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate">{p.player}</p>
                <p className="text-[10px] text-zinc-500">{p.label} · {p.line}</p>
              </div>
              {p.over != null ? (
                <OddsButton meta={meta} sel={{ market: "prop", side: `${p.stat}:${p.player_id}:over`, label: "Over",
                  pick: `${p.player} O${p.line} ${p.label}`, line: p.line, odds: p.over }} />
              ) : <div />}
              {p.under != null ? (
                <OddsButton meta={meta} sel={{ market: "prop", side: `${p.stat}:${p.player_id}:under`, label: "Under",
                  pick: `${p.player} U${p.line} ${p.label}`, line: p.line, odds: p.under }} />
              ) : <div />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Market({ label, cols, children }) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-600 mb-1.5">{label}</p>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
        {children}
      </div>
    </div>
  );
}
