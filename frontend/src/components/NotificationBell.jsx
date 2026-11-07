import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ArrowDownToLine, ExternalLink, HandCoins, LifeBuoy } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { api, COIN_META, explorerUrl } from "@/lib/api";
import { fmtCrypto, fmtAmt } from "@/lib/format";
import { WD_STAGE, TONE } from "@/components/DepositAlerts";

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function NotificationRow({ n }) {
  const dep = n.kind === "deposit" || n.kind === "cashout" || n.kind === "lossback";
  const meta = n.kind === "cashout" ? { title: "Auto cash out", Icon: HandCoins, tone: "sky" }
    : n.kind === "lossback" ? { title: "10% lossback", Icon: LifeBuoy, tone: "emerald" }
    : n.kind === "deposit" ? { title: "Deposit received", Icon: ArrowDownToLine, tone: "emerald" } : WD_STAGE[n.stage] || WD_STAGE.sent;
  const t = TONE[meta.tone];
  const url = explorerUrl(n.coin, n.tx_hash, n.net);
  const sign = dep || n.stage === "refunded" ? "+" : "-";
  return (
    <div data-testid={`notification-item-${n.id}`}
      className={`flex items-start gap-3 px-4 py-3 border-b border-[#162848] last:border-0 ${n.read ? "" : "bg-emerald-500/[0.04]"}`}>
      <div className={`w-8 h-8 rounded-full ${t.bg} flex items-center justify-center shrink-0`}>
        <meta.Icon size={15} className={t.text} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className={`text-[10px] font-mono uppercase tracking-[0.15em] ${t.text}`}>{meta.title}</p>
          <span className="text-[10px] text-zinc-500 shrink-0">{timeAgo(n.created_at)}</span>
        </div>
        <p className="font-mono text-sm font-bold text-white">
          {sign}{n.amount_usd != null ? fmtAmt(n.amount_usd, "USD") : fmtAmt(n.amount, n.coin)}{n.amount_usd != null && n.coin !== "USD" && <span className="text-[10px] text-zinc-500 ml-1" style={{ color: COIN_META[n.coin]?.color }}>{fmtCrypto(n.amount, n.coin)} {n.coin}</span>}
        </p>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" data-testid={`notification-tx-link-${n.id}`}
            className="flex items-center gap-1 text-[11px] font-mono text-zinc-400 hover:text-emerald-300">
            {n.tx_hash.slice(0, 10)}…{n.tx_hash.slice(-6)} <ExternalLink size={11} />
          </a>
        )}
      </div>
      {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />}
    </div>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await api.get("/notifications")).data,
    refetchInterval: 60_000,
  });
  const unread = data?.unread || 0;
  const items = data?.items || [];

  const markRead = async () => {
    await api.post("/notifications/read-all");
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  const onOpenChange = (v) => {
    setOpen(v);
    if (!v && unread) markRead();
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button data-testid="header-notifications-button" aria-label="Notifications"
          className="relative text-zinc-300 hover:text-white p-2 transition-colors">
          <Bell size={18} />
          {unread > 0 && (
            <span data-testid="notifications-unread-badge"
              className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-emerald-500 text-black text-[10px] font-bold font-mono flex items-center justify-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} data-testid="notifications-panel"
        className="z-[60] w-[360px] p-0 bg-[#0C1A36] border-[#1D3157] rounded-xl overflow-hidden text-zinc-100">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1D3157]">
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400">Notifications</p>
          {unread > 0 && (
            <button data-testid="notifications-mark-read" onClick={markRead}
              className="text-[11px] text-zinc-400 hover:text-emerald-300">Mark all read</button>
          )}
        </div>
        <div className="max-h-[420px] overflow-y-auto scrollbar-thin">
          {items.length === 0 ? (
            <div data-testid="notifications-empty" className="py-12 text-center">
              <Bell size={22} className="mx-auto text-zinc-600 mb-2" />
              <p className="text-sm text-zinc-500">No notifications yet.</p>
            </div>
          ) : items.map((n) => <NotificationRow key={n.id} n={n} />)}
        </div>
      </PopoverContent>
    </Popover>
  );
}
