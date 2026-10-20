import { useMemo, useState } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { SlidersHorizontal, Minus, Plus } from "lucide-react";
import { OddsButton } from "@/components/MatchCard";

const fmtLine = (n) => (n > 0 ? `+${n}` : `${n}`);

export function AltLineSlider({ ev, m, main, meta }) {
  const spread = m.market === "alt_spread";
  const rows = useMemo(() => {
    const map = new Map();
    for (const s of m.selections) {
      const key = spread ? (s.side === "home" ? s.line : -s.line) : s.line;
      const r = map.get(key) || { key };
      r[s.side] = s;
      map.set(key, r);
    }
    return [...map.values()].sort((a, b) => a.key - b.key);
  }, [m, spread]);
  const mainKey = main?.selections.find((s) => s.side === (spread ? "home" : "over"))?.line;
  const start = useMemo(() => {
    if (mainKey == null) return Math.floor(rows.length / 2);
    let best = 0;
    rows.forEach((r, i) => { if (Math.abs(r.key - mainKey) < Math.abs(rows[best].key - mainKey)) best = i; });
    return best;
  }, [rows, mainKey]);
  const [idx, setIdx] = useState(null);
  const i = Math.min(idx ?? start, rows.length - 1);
  const r = rows[i];
  const [a, b] = spread ? ["away", "home"] : ["over", "under"];
  const tid = `${ev.event_id}-${m.market}`;

  return (
    <div data-testid={`alt-slider-${tid}`} className="rounded-lg border border-[#1E2234] bg-[#0E1017]/60 p-3">
      <div className="flex items-center justify-between mb-2.5">
        <p className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
          <SlidersHorizontal size={11} /> {m.label}
        </p>
        <span data-testid={`alt-line-value-${tid}`} className="font-mono text-xs font-bold text-emerald-300">
          {spread ? `${ev.home.abbr} ${fmtLine(r.key)}` : `Total ${r.key}`}
        </span>
      </div>
      <div className="flex items-center gap-2">
      <button data-testid={`alt-step-down-${tid}`} aria-label="Previous line" onClick={() => setIdx(Math.max(0, i - 1))} disabled={i === 0}
        className="w-6 h-6 shrink-0 rounded-md border border-[#2A2F45] flex items-center justify-center text-zinc-400 hover:text-emerald-300 hover:border-emerald-500/50 disabled:opacity-30"><Minus size={12} /></button>
      <SliderPrimitive.Root data-testid={`alt-slider-input-${tid}`} min={0} max={rows.length - 1} step={1} value={[i]}
        onValueChange={([v]) => setIdx(v)} className="relative flex w-full touch-none select-none items-center h-5">
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-[#2A2F45]">
          <SliderPrimitive.Range className="absolute h-full bg-emerald-500/70" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb aria-label={`${m.label} line`}
          className="block h-5 w-5 rounded-full border-2 border-emerald-400 bg-[#090A0F] shadow-[0_0_12px_rgba(16,185,129,0.6)] transition-transform hover:scale-110 focus-visible:outline-none" />
      </SliderPrimitive.Root>
      <button data-testid={`alt-step-up-${tid}`} aria-label="Next line" onClick={() => setIdx(Math.min(rows.length - 1, i + 1))} disabled={i === rows.length - 1}
        className="w-6 h-6 shrink-0 rounded-md border border-[#2A2F45] flex items-center justify-center text-zinc-400 hover:text-emerald-300 hover:border-emerald-500/50 disabled:opacity-30"><Plus size={12} /></button>
      </div>
      <div className="flex justify-between text-[9px] font-mono text-zinc-600 mt-1 mb-2 px-8">
        <span>{spread ? fmtLine(rows[0].key) : rows[0].key}</span>
        <span>{rows.length} lines</span>
        <span>{spread ? fmtLine(rows[rows.length - 1].key) : rows[rows.length - 1].key}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {[a, b].map((side) => r[side]
          ? <OddsButton key={`${side}-${r.key}`} sel={{ ...r[side], market: m.market }} meta={meta} />
          : <div key={side} className="py-2 rounded-md border border-dashed border-[#2A2F45] text-center text-[10px] text-zinc-600">Not offered</div>)}
      </div>
    </div>
  );
}
