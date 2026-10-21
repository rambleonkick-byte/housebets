import { useCallback, useEffect, useState } from "react";
import { Headphones, X, ArrowLeft, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { TicketThread, StatusPill, TOPICS } from "@/components/TicketThread";

function NewTicket({ onCreated }) {
  const [topic, setTopic] = useState(TOPICS[0]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { const { data } = await api.post("/tickets", { topic, message }); onCreated(data); toast.success("Ticket sent — we'll reply here"); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    setBusy(false);
  };
  return (
    <div className="p-4 space-y-3" data-testid="support-new-ticket">
      <p className="text-xs font-mono uppercase text-zinc-500">Topic</p>
      <div className="flex flex-wrap gap-1.5">
        {TOPICS.map((t) => (
          <button key={t} data-testid={`support-topic-${t.toLowerCase()}`} onClick={() => setTopic(t)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${topic === t ? "bg-emerald-500 text-black border-emerald-500 font-bold" : "border-[#2A2F45] text-zinc-300 hover:border-emerald-500/50"}`}>{t}</button>
        ))}
      </div>
      <textarea data-testid="support-new-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={6} maxLength={4000}
        placeholder="Describe your issue (bet ID, amount, coin…)"
        className="w-full resize-none bg-[#0B0D13] border border-[#2A2F45] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/60" />
      <button data-testid="support-new-submit" onClick={submit} disabled={busy || !message.trim()}
        className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm py-2.5 rounded-lg disabled:opacity-40">
        {busy ? <Loader2 size={16} className="animate-spin mx-auto" /> : "Send ticket"}
      </button>
    </div>
  );
}

function TicketList({ tickets, onOpen }) {
  if (!tickets.length) return <p className="p-6 text-sm text-zinc-500 text-center" data-testid="support-empty">No tickets yet. Start one and our team will reply here.</p>;
  return (
    <ul className="divide-y divide-[#1E2234]" data-testid="support-ticket-list">
      {tickets.map((t) => (
        <li key={t.id}>
          <button data-testid={`support-ticket-${t.id}`} onClick={() => onOpen(t.id)} className="w-full text-left p-4 hover:bg-white/[0.03] flex gap-3">
            <div className="flex-1 min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold">{t.topic} <StatusPill status={t.status} /></p>
              <p className="text-xs text-zinc-500 truncate mt-0.5">{t.last_from === "admin" ? "Support: " : "You: "}{t.last_message}</p>
            </div>
            {t.user_unread && <span className="w-2.5 h-2.5 rounded-full bg-red-500 mt-1.5" data-testid={`support-ticket-unread-${t.id}`} />}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function SupportButton() {
  const { user, setAuthOpen } = useAuth();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(null);
  const [view, setView] = useState("list");
  const [ticket, setTicket] = useState(null);

  const loadList = useCallback(() => api.get("/tickets").then(({ data }) => setList(data)).catch(() => {}), []);
  useEffect(() => {
    if (!user) { setList(null); return; }
    loadList();
    const iv = setInterval(loadList, 30000);
    return () => clearInterval(iv);
  }, [user, loadList]);

  const openTicket = async (id) => {
    const { data } = await api.get(`/tickets/${id}`);
    setTicket(data); setView("thread"); loadList();
  };
  useEffect(() => {
    if (view !== "thread" || !ticket) return;
    const iv = setInterval(() => api.get(`/tickets/${ticket.id}`).then(({ data }) => setTicket(data)).catch(() => {}), 10000);
    return () => clearInterval(iv);
  }, [view, ticket?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (text) => {
    try { const { data } = await api.post(`/tickets/${ticket.id}/messages`, { text }); setTicket(data); loadList(); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); throw e; }
  };

  const unread = list?.unread || 0;
  const title = view === "new" ? "New ticket" : view === "thread" ? ticket?.topic : "Support";

  return (
    <>
      <button data-testid="support-chat-button" onClick={() => (user ? setOpen(true) : setAuthOpen(true))} aria-label="Support" title="Support"
        className="fixed bottom-20 lg:bottom-5 right-4 z-[60] w-11 h-11 rounded-full bg-[#12141C] border border-[#2A2F45] text-emerald-400 flex items-center justify-center shadow-[0_8px_24px_-8px_rgba(16,185,129,0.6)] hover:border-emerald-500/60 hover:scale-105 transition-transform">
        <Headphones size={19} />
        {unread > 0 && <span data-testid="support-chat-unread" className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 ring-2 ring-[#0B0D13]" />}
      </button>
      {open && (
        <div className="fixed inset-0 z-[70] flex justify-end bg-black/50" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md h-full bg-[#12141C] border-l border-[#2A2F45] flex flex-col" onClick={(e) => e.stopPropagation()} data-testid="support-panel">
            <div className="p-4 border-b border-[#1E2234] flex items-center gap-2">
              {view !== "list" && <button data-testid="support-back" onClick={() => { setView("list"); setTicket(null); }} className="text-zinc-400 hover:text-white"><ArrowLeft size={18} /></button>}
              <p className="font-display text-lg font-bold flex-1 flex items-center gap-2">{title} {view === "thread" && ticket && <StatusPill status={ticket.status} />}</p>
              {view === "list" && <button data-testid="support-new-button" onClick={() => setView("new")} className="flex items-center gap-1 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-black px-3 py-1.5 rounded-lg"><Plus size={14} /> New ticket</button>}
              <button data-testid="support-close" onClick={() => setOpen(false)} className="text-zinc-500 hover:text-white"><X size={20} /></button>
            </div>
            <div className="flex-1 min-h-0 flex flex-col overflow-y-auto scrollbar-thin">
              {view === "list" && (list ? <TicketList tickets={list.tickets} onOpen={openTicket} /> : <Loader2 className="animate-spin text-emerald-400 m-auto" />)}
              {view === "new" && <NewTicket onCreated={(t) => { setTicket(t); setView("thread"); loadList(); }} />}
              {view === "thread" && ticket && <TicketThread ticket={ticket} me="user" onSend={send} testid="support-thread" />}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
