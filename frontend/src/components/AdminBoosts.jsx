import { useEffect, useState } from "react";
import { Zap, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "@/lib/api";

export function AdminBoosts() {
  const [list, setList] = useState([]);
  const load = () => api.get("/admin/boosts").then(({ data }) => setList(data.boosts || [])).catch(() => {});
  useEffect(() => { load(); }, []);
  const remove = async (id) => {
    try { await api.delete(`/admin/boosts/${id}`); toast.success("Boost removed"); load(); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };
  if (!list.length) return null;
  return (
    <div className="bg-[#12141C] border border-[#2A2F45] rounded-2xl p-4 space-y-2" data-testid="admin-boosts">
      <p className="flex items-center gap-2 font-bold"><Zap size={16} className="text-rose-400" /> Super Boosts</p>
      {list.map((b) => (
        <div key={b.id} data-testid={`admin-boost-${b.id}`} className="flex items-center gap-3 text-sm bg-[#090A0F] border border-[#2A2F45] rounded-lg px-3 py-2">
          <span className="mr-auto">
            {b.card ? <><b>{b.card.legs[0].pick}</b> <span className="text-zinc-500">· {b.card.away} @ {b.card.home}</span></> : <span className="text-zinc-500">Game started or not listed</span>}
          </span>
          <span className="font-mono">{b.card && <span className="line-through text-zinc-600 mr-2">{b.card.base_odds.toFixed(2)}</span>}<b className="text-rose-300">{b.odds.toFixed(2)}</b></span>
          <button data-testid={`admin-boost-remove-${b.id}`} onClick={() => remove(b.id)} className="text-zinc-500 hover:text-red-400"><Trash2 size={15} /></button>
        </div>
      ))}
    </div>
  );
}
