import { useCallback, useEffect, useState } from "react";
import { Gift, Crown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "@/lib/api";

const inp = "bg-[#071024] border border-[#1D3157] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500";
const L = ({ t, children, className = "" }) => <label className={`flex flex-col gap-1 text-[10px] font-mono uppercase text-zinc-500 ${className}`}>{t}{children}</label>;
const EMPTY = { code: "", type: "cash", amount: "", pct: "", max_bonus: "", wager_mult: "1", max_uses: "", expires_at: "" };

function PromoForm({ onCreated }) {
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    setBusy(true);
    try {
      await api.post("/admin/promos", {
        code: f.code, type: f.type, amount: +f.amount || 0, pct: +f.pct || 0, max_bonus: +f.max_bonus || 0,
        wager_mult: f.wager_mult === "" ? 1 : +f.wager_mult, max_uses: parseInt(f.max_uses) || 0,
        expires_at: f.expires_at ? new Date(f.expires_at + "T23:59:59").toISOString() : null,
      });
      toast.success(`Code ${f.code.toUpperCase()} created`);
      setF(EMPTY); onCreated();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    setBusy(false);
  };
  const match = f.type === "deposit_match";
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-4 border-b border-[#162848]" data-testid="admin-promo-form">
      <L t="Code"><input data-testid="admin-promo-code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="WELCOME25" className={`${inp} font-mono`} /></L>
      <L t="Reward type"><select data-testid="admin-promo-type" value={f.type} onChange={set("type")} className={inp}>
        <option value="cash">Free cash</option><option value="free_bet">Free bet</option><option value="deposit_match">Deposit match</option>
      </select></L>
      {match ? (
        <>
          <L t="Match %"><input data-testid="admin-promo-pct" type="number" min="0" value={f.pct} onChange={set("pct")} placeholder="50" className={inp} /></L>
          <L t="Max bonus $"><input data-testid="admin-promo-max" type="number" min="0" value={f.max_bonus} onChange={set("max_bonus")} placeholder="100" className={inp} /></L>
        </>
      ) : <L t="Amount $" className="md:col-span-2"><input data-testid="admin-promo-amount" type="number" min="0" value={f.amount} onChange={set("amount")} placeholder="25" className={inp} /></L>}
      {f.type !== "free_bet" && <L t="Wagering (× bonus)"><input data-testid="admin-promo-wager" type="number" min="0" value={f.wager_mult} onChange={set("wager_mult")} placeholder="Wager x" title="Times the bonus must be wagered" className={inp} /></L>}
      <L t="Max uses"><input data-testid="admin-promo-uses" type="number" min="0" value={f.max_uses} onChange={set("max_uses")} placeholder="Unlimited" className={inp} /></L>
      <L t="Expires (optional)"><input data-testid="admin-promo-expiry" type="date" value={f.expires_at} onChange={set("expires_at")} className={inp} /></L>
      <button data-testid="admin-promo-create" onClick={submit} disabled={busy || f.code.length < 3}
        className="self-end bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm rounded-lg py-2 disabled:opacity-40">{busy ? <Loader2 size={15} className="animate-spin mx-auto" /> : "Create code"}</button>
    </div>
  );
}

function VipBonusEditor() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get("/admin/vip-bonuses").then(({ data }) => setD(data)); }, []);
  const save = async () => {
    try { const { data } = await api.put("/admin/vip-bonuses", { amounts: d.amounts }); setD({ ...d, amounts: data.amounts }); toast.success("Level-up bonuses saved"); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };
  if (!d) return null;
  return (
    <div className="p-4 space-y-3" data-testid="admin-vip-bonuses">
      <p className="flex items-center gap-2 text-sm font-bold"><Crown size={15} className="text-amber-300" /> Level-up cash bonus per rank (wagered 1x before withdrawal)</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {d.tiers.slice(1).map((t) => (
          <label key={t.name} className="text-[11px] text-zinc-400">{t.name}
            <input data-testid={`admin-vip-bonus-${t.name.replace(/\s+/g, "-").toLowerCase()}`} type="number" min="0" value={d.amounts[t.name]}
              onChange={(e) => setD({ ...d, amounts: { ...d.amounts, [t.name]: e.target.value } })} className={`${inp} w-full mt-1 font-mono`} />
          </label>
        ))}
      </div>
      <button data-testid="admin-vip-bonus-save" onClick={save} className="border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 text-sm font-bold px-4 py-2 rounded-lg">Save bonuses</button>
    </div>
  );
}

export const AdminPromos = () => {
  const [list, setList] = useState(null);
  const load = useCallback(() => api.get("/admin/promos").then(({ data }) => setList(data.promos)), []);
  useEffect(() => { load(); }, [load]);
  const toggle = async (p) => { await api.post(`/admin/promos/${p.code}/active`, { active: !p.active }); load(); };

  return (
    <div className="bg-[#0C1A36] border border-[#1D3157] rounded-2xl" data-testid="admin-promos">
      <p className="p-4 border-b border-[#162848] flex items-center gap-2 font-bold"><Gift size={16} className="text-emerald-400" /> Promo codes & VIP rewards</p>
      <PromoForm onCreated={load} />
      <div className="overflow-x-auto scrollbar-thin border-b border-[#162848]">
        <table className="w-full text-sm" data-testid="admin-promos-table">
          <thead><tr className="text-[10px] font-mono uppercase text-zinc-500 text-left">{["Code", "Reward", "Wager", "Used", "Expires", ""].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {list?.length === 0 && <tr><td colSpan={6} className="px-4 py-4 text-zinc-500">No promo codes yet.</td></tr>}
            {list?.map((p) => (
              <tr key={p.code} className="border-t border-[#162848]" data-testid={`admin-promo-row-${p.code}`}>
                <td className="px-4 py-2 font-mono font-bold">{p.code}</td>
                <td className="px-4 py-2">{p.desc}</td>
                <td className="px-4 py-2 font-mono text-xs">{p.type === "free_bet" ? "—" : `${p.wager_mult}x`}</td>
                <td className="px-4 py-2 font-mono text-xs">{p.uses}{p.max_uses ? ` / ${p.max_uses}` : ""}</td>
                <td className="px-4 py-2 text-xs text-zinc-400">{p.expires_at ? new Date(p.expires_at).toLocaleDateString() : "Never"}</td>
                <td className="px-4 py-2 text-right">
                  <button data-testid={`admin-promo-toggle-${p.code}`} onClick={() => toggle(p)}
                    className={`text-xs px-3 py-1 rounded-lg border ${p.active ? "border-emerald-500/40 text-emerald-300" : "border-zinc-600 text-zinc-400"}`}>{p.active ? "Active" : "Disabled"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <VipBonusEditor />
    </div>
  );
};
