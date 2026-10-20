import { useEffect, useState } from "react";
import { Headphones } from "lucide-react";

export function SupportButton() {
  const [ready, setReady] = useState(() => !!window.__tawkReady);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const onReady = () => setReady(true);
    const onUnread = (e) => setUnread(e.detail || 0);
    window.addEventListener("tawk-ready", onReady);
    window.addEventListener("tawk-unread", onUnread);
    return () => { window.removeEventListener("tawk-ready", onReady); window.removeEventListener("tawk-unread", onUnread); };
  }, []);
  if (!ready) return null;
  const open = () => { window.Tawk_API.showWidget(); window.Tawk_API.maximize(); setUnread(0); };
  return (
    <button data-testid="support-chat-button" onClick={open} aria-label="Live support" title="Live support"
      className="fixed bottom-20 lg:bottom-5 right-4 z-[60] w-11 h-11 rounded-full bg-[#12141C] border border-[#2A2F45] text-emerald-400 flex items-center justify-center shadow-[0_8px_24px_-8px_rgba(16,185,129,0.6)] hover:border-emerald-500/60 hover:scale-105 transition-transform">
      <Headphones size={19} />
      {unread > 0 && (
        <span data-testid="support-chat-unread" className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{unread}</span>
      )}
    </button>
  );
}
