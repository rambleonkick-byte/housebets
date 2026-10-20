import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { BarChart3 } from "lucide-react";
import { api } from "@/lib/api";
import { usdValue } from "@/lib/format";
import { fmtUsd } from "@/lib/prices";

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#090A0F] border border-[#2A2F45] rounded-lg px-3 py-2 text-xs font-mono">
      <p className="text-zinc-400 mb-1">{label}</p>
      <p className="text-emerald-400">Commission {fmtUsd(d.usd)}</p>
      <p className="text-sky-400">New sign-ups {d.signups}</p>
    </div>
  );
}

export function AffiliateChart({ rates, refreshKey }) {
  const [days, setDays] = useState(null);
  useEffect(() => { api.get("/affiliate/daily").then(({ data }) => setDays(data.days)).catch(() => setDays([])); }, [refreshKey]);
  const rows = useMemo(() => (days || []).map((d) => ({
    label: new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    usd: usdValue(d.commission, rates), signups: d.signups,
  })), [days, rates]);
  const totalUsd = rows.reduce((s, r) => s + r.usd, 0);
  const totalSignups = rows.reduce((s, r) => s + r.signups, 0);

  return (
    <div className="bg-[#12141C] border border-[#2A2F45] rounded-2xl p-5" data-testid="aff-chart">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display text-lg font-bold uppercase tracking-tight flex items-center gap-2"><BarChart3 size={18} className="text-emerald-400" /> Last 30 days</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Daily commission and new referred players</p>
        </div>
        <div className="flex gap-5 text-right">
          <div><p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Earned</p><p className="font-mono font-bold text-emerald-400" data-testid="aff-chart-total-usd">{fmtUsd(totalUsd)}</p></div>
          <div><p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Sign-ups</p><p className="font-mono font-bold text-sky-400" data-testid="aff-chart-total-signups">{totalSignups}</p></div>
        </div>
      </div>
      <div className="h-64">
        {days === null ? (
          <div className="h-full rounded-xl bg-[#090A0F] animate-pulse" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 5, right: 0, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="#1E2234" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} interval={4} />
              <YAxis yAxisId="usd" tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
              <YAxis yAxisId="n" orientation="right" allowDecimals={false} tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(16,185,129,0.06)" }} />
              <Bar yAxisId="usd" dataKey="usd" fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={18} />
              <Line yAxisId="n" type="monotone" dataKey="signups" stroke="#38BDF8" strokeWidth={2} dot={{ r: 2, fill: "#38BDF8" }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="flex gap-4 mt-3 text-[11px] text-zinc-400">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Commission (USD)</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-sky-400" /> New sign-ups</span>
      </div>
    </div>
  );
}
