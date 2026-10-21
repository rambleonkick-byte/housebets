import { useCallback, useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "@/lib/api";
import { TicketThread, StatusPill } from "@/components/TicketThread";

const FILTERS = [["open", "Open"], ["closed", "Closed"], ["", "All"]];

export const AdminTickets = () => {
  const [filter, setFilter] = useState("open");
  const [data, setData] = useState(null);
  const [ticket, setTicket] = useState(null);

  const load = useCallback(() => api.get("/admin/tickets", { params: { status: filter || undefined } }).then(({ data }) => setData(data)).catch(() => {}), [filter]);
  useEffect(() => { load(); const iv = setInterval(load, 20000); return () => clearInterval(iv); }, [load]);
  useEffect(() => {
    if (!ticket) return;
    const iv = setInterval(() => api.get(`/admin/tickets/${ticket.id}`).then(({ data }) => setTicket(data)).catch(() => {}), 10000);
    return () => clearInterval(iv);
  }, [ticket?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (id) => { const { data } = await api.get(`/admin/tickets/${id}`); setTicket(data); load(); };
  const send = async (text) => {
    try { const { data } = await api.post(`/admin/tickets/${ticket.id}/messages`, { text }); setTicket(data); load(); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); throw e; }
  };
  const setStatus = async (status) => {
    const { data } = await api.post(`/admin/tickets/${ticket.id}/status`, { status });
    setTicket(data); load(); toast.success(status === "closed" ? "Ticket closed" : "Ticket reopened");
  };

  return (
    <div className="bg-[#12141C] border border-[#2A2F45] rounded-2xl" data-testid="admin-tickets">
      <div className="p-4 border-b border-[#1E2234] flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-bold">
          <MessageSquare size={16} className="text-emerald-400" /> Support tickets
          {data?.unread > 0 && <span className="text-[10px] font-mono bg-red-500 text-white rounded-full px-2 py-0.5" data-testid="admin-tickets-unread">{data.unread} new</span>}
        </p>
        <div className="flex gap-1">
          {FILTERS.map(([v, l]) => (
            <button key={l} data-testid={`admin-tickets-filter-${l.toLowerCase()}`} onClick={() => setFilter(v)}
              className={`text-xs px-3 py-1.5 rounded-lg border ${filter === v ? "border-emerald-500/60 text-emerald-300 bg-emerald-500/10" : "border-[#2A2F45] text-zinc-400"}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="grid md:grid-cols-[320px_1fr] h-[520px]">
        <ul className="border-r border-[#1E2234] overflow-y-auto scrollbar-thin divide-y divide-[#1E2234]" data-testid="admin-tickets-list">
          {data && !data.tickets.length && <li className="p-4 text-sm text-zinc-500" data-testid="admin-tickets-empty">No tickets.</li>}
          {data?.tickets.map((t) => (
            <li key={t.id}>
              <button data-testid={`admin-ticket-${t.id}`} onClick={() => open(t.id)} className={`w-full text-left p-3 hover:bg-white/[0.03] ${ticket?.id === t.id ? "bg-white/[0.04]" : ""}`}>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {t.admin_unread && <span className="w-2 h-2 rounded-full bg-red-500" />}{t.topic} <StatusPill status={t.status} />
                </p>
                <p className="text-xs text-zinc-400 truncate">{t.user_name} · {t.user_email}</p>
                <p className="text-xs text-zinc-500 truncate">{t.last_message}</p>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-col min-h-0">
          {!ticket ? <p className="m-auto text-sm text-zinc-500">Select a ticket to reply.</p> : (
            <>
              <div className="p-3 border-b border-[#1E2234] flex items-center justify-between gap-2" data-testid="admin-ticket-header">
                <div className="min-w-0">
                  <p className="text-sm font-semibold flex items-center gap-2">{ticket.topic} <StatusPill status={ticket.status} /></p>
                  <p className="text-xs text-zinc-500 truncate">{ticket.user_name} · {ticket.user_email}</p>
                </div>
                <button data-testid="admin-ticket-toggle-status" onClick={() => setStatus(ticket.status === "open" ? "closed" : "open")}
                  className="text-xs px-3 py-1.5 rounded-lg border border-[#2A2F45] hover:bg-white/5">{ticket.status === "open" ? "Close ticket" : "Reopen"}</button>
              </div>
              <TicketThread ticket={ticket} me="admin" onSend={send} testid="admin-ticket-thread" />
            </>
          )}
        </div>
      </div>
    </div>
  );
};
