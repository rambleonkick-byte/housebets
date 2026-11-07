import { useEffect, useRef, useState } from "react";
import { Send, Loader2 } from "lucide-react";

export const TOPICS = ["Deposit", "Withdrawal", "Bet", "Account", "Other"];

export function TicketThread({ ticket, me, onSend, testid }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [ticket?.messages?.length]);

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { await onSend(text.trim()); setText(""); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col min-h-0 flex-1" data-testid={testid}>
      <div className="flex-1 overflow-y-auto scrollbar-thin space-y-2 p-3" data-testid={`${testid}-messages`}>
        {ticket.messages.map((m, i) => (
          <div key={i} className={`flex ${m.from === me ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${m.from === me ? "bg-emerald-500 text-black rounded-br-sm" : "bg-[#132544] text-zinc-100 rounded-bl-sm"}`}>
              <p className="text-[9px] font-mono uppercase opacity-60 mb-0.5">{m.from === "admin" ? "Support" : me === "admin" ? ticket.user_name || "Player" : "You"}</p>
              {m.text}
              <p className="text-[9px] opacity-50 mt-1 text-right">{new Date(m.at).toLocaleString()}</p>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="p-3 border-t border-[#162848] flex gap-2">
        <textarea data-testid={`${testid}-input`} value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={4000}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={ticket.status === "closed" ? "Reply to reopen this ticket" : "Type a message"}
          className="flex-1 resize-none bg-[#08122A] border border-[#1D3157] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/60" />
        <button data-testid={`${testid}-send`} onClick={send} disabled={busy || !text.trim()}
          className="self-end w-10 h-10 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black flex items-center justify-center disabled:opacity-40">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}

export function StatusPill({ status }) {
  return (
    <span className={`text-[9px] font-mono uppercase rounded px-1.5 py-0.5 border ${status === "open" ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10" : "text-zinc-400 border-zinc-600/40"}`}>{status}</span>
  );
}
