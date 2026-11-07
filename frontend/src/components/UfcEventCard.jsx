import { useState } from "react";
import { ChevronDown, Swords } from "lucide-react";
import { OddsButton, Market, buildMeta } from "@/components/MatchCard";

const initials = (n) => (n || "").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

function Headshot({ f, size }) {
  const [err, setErr] = useState(false);
  if (f.photo && !err) {
    return <img src={f.photo} alt={f.name} onError={() => setErr(true)}
      className={`${size} object-cover object-top rounded-full bg-[#132545] border border-[#1D3157]`} />;
  }
  return (
    <div className={`${size} rounded-full bg-[#132545] border border-[#1D3157] flex items-center justify-center font-display font-black text-zinc-400`}>
      {initials(f.name)}
    </div>
  );
}

function Record({ f, testid }) {
  return (
    <span data-testid={testid} className="inline-flex items-center gap-1.5 text-[11px] font-mono text-zinc-400">
      {f.flag && <img src={f.flag} alt={f.country} title={f.country} className="w-4 h-3 object-cover rounded-[2px]" />}
      {f.record || "Record N/A"}
    </span>
  );
}

function ExtraMarkets({ ev, meta }) {
  const [open, setOpen] = useState(false);
  const extra = ev.markets.filter((m) => m.market !== "moneyline" && !m.market.startsWith("alt_"));
  if (!extra.length) return null;
  return (
    <div className="mt-2">
      <button data-testid={`ufc-more-${ev.event_id}`} onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500 hover:text-emerald-300 transition-colors">
        {open ? "Hide" : "More"} markets ({extra.length})
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-2.5" data-testid={`ufc-markets-${ev.event_id}`}>
          {extra.map((m) => (
            <Market key={m.market} label={m.label || m.market} cols={Math.min(m.selections.length, 4)}>
              {m.selections.map((s) => <OddsButton key={s.side} sel={{ ...s, market: m.market }} meta={meta} />)}
            </Market>
          ))}
        </div>
      )}
    </div>
  );
}

function fighterOdds(ev, side) {
  const ml = ev.markets.find((m) => m.market === "moneyline");
  return ml?.selections.find((s) => s.side === side);
}

function MainEvent({ ev }) {
  const meta = buildMeta(ev);
  return (
    <div data-testid={`ufc-main-event-${ev.event_id}`}
      className="relative rounded-lg border border-[#1D3157] bg-gradient-to-b from-[#1A1220] to-[#0C1A36] p-5 overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-500/70 to-transparent" />
      <div className="flex items-center justify-center gap-2 mb-4">
        <span data-testid={`ufc-headline-label-${ev.event_id}`} className={`text-[10px] font-mono uppercase tracking-[0.25em] rounded px-2 py-0.5 border ${ev.main_event ? "text-red-400 bg-red-500/10 border-red-500/30" : "text-amber-300 bg-amber-500/10 border-amber-500/30"}`}>
          {ev.main_event ? "Main Event" : "Featured Bout"}
        </span>
        {ev.weight_class && <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{ev.weight_class}</span>}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
        {["away", "home"].map((side, i) => {
          const f = ev[side];
          const sel = fighterOdds(ev, side);
          return (
            <div key={side} className={`flex flex-col items-center text-center gap-2 ${i === 1 ? "order-3" : ""}`}>
              <Headshot f={f} size="w-24 h-24 sm:w-28 sm:h-28" />
              <p className="font-display text-base sm:text-lg font-black tracking-tight leading-tight min-h-[2.5rem] sm:min-h-0 flex items-center" data-testid={`ufc-fighter-${ev.event_id}-${side}`}>{f.name}</p>
              <Record f={f} testid={`ufc-record-${ev.event_id}-${side}`} />
              {sel && <div className="w-full max-w-[9rem] [&>button]:w-full"><OddsButton sel={{ ...sel, market: "moneyline" }} meta={meta} /></div>}
            </div>
          );
        })}
        <div className="order-2 self-start mt-10 sm:mt-12 font-display text-2xl font-black italic text-zinc-600">VS</div>
      </div>
      <div className="text-center text-[11px] font-mono text-zinc-500 mt-3">{ev.state === "in" ? "LIVE" : ev.status_detail}</div>
      <ExtraMarkets ev={ev} meta={meta} />
    </div>
  );
}

function BoutRow({ ev }) {
  const meta = buildMeta(ev);
  return (
    <div data-testid={`ufc-bout-${ev.event_id}`} className="py-3 border-t border-[#162848] first:border-t-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{ev.weight_class || "Bout"}</span>
        <span className="text-[10px] font-mono text-zinc-600">{ev.state === "in" ? "LIVE" : ev.status_detail}</span>
      </div>
      <div className="space-y-2">
        {["away", "home"].map((side) => {
          const f = ev[side];
          const sel = fighterOdds(ev, side);
          return (
            <div key={side} className="flex items-center gap-2.5 min-w-0">
              <Headshot f={f} size="w-10 h-10 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate" data-testid={`ufc-fighter-${ev.event_id}-${side}`}>{f.name}</p>
                <Record f={f} testid={`ufc-record-${ev.event_id}-${side}`} />
              </div>
              {sel && <div className="w-24 shrink-0 [&>button]:w-full"><OddsButton sel={{ ...sel, market: "moneyline", label: "To Win" }} meta={meta} /></div>}
            </div>
          );
        })}
      </div>
      <ExtraMarkets ev={ev} meta={meta} />
    </div>
  );
}

export function UfcEventCard({ name, fights }) {
  const sorted = [...fights].sort((a, b) => (b.bout_order ?? -1) - (a.bout_order ?? -1));
  const main = sorted.find((f) => f.main_event) || sorted[0];
  const rest = sorted.filter((f) => f !== main);
  return (
    <section data-testid={`ufc-event-card-${name}`} className="col-span-full bg-[#0C1A36] border border-[#1D3157] rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#162848]">
        <Swords size={16} className="text-red-400" />
        <h3 className="font-display text-sm sm:text-base font-bold tracking-tight uppercase" data-testid="ufc-event-name">{name}</h3>
        <span className="ml-auto text-[11px] font-mono text-zinc-500">{fights.length} fights</span>
      </div>
      <div className="p-4 space-y-4">
        <MainEvent ev={main} />
        {rest.length > 0 && (
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-500 mb-1">Fight Card</p>
            {rest.map((ev) => <BoutRow key={ev.event_id} ev={ev} />)}
          </div>
        )}
      </div>
    </section>
  );
}
