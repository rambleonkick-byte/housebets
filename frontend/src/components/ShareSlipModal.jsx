import { BrandLogo } from "@/components/BrandLogo";
import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Link2, Download, Share2, Check } from "lucide-react";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import { fmtOdds } from "@/lib/format";
import { slipLink } from "@/lib/slips";

function ShareCard({ cardRef, groups, oddsLabel, oddsValue, count, by }) {
  return (
    <div ref={cardRef} data-testid="share-slip-card"
      className="w-full bg-[#09142D] border border-[#162848] rounded-3xl p-5 space-y-3"
      style={{ backgroundImage: "radial-gradient(120% 60% at 100% 0%, rgba(34,211,238,0.14), transparent 60%)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BrandLogo className="h-6" testid="share-slip-brand-logo" />
        </div>
        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{by}'s slip</span>
      </div>
      {groups.map((legs) => (
        <div key={legs[0].event_id} className="bg-[#10203E] border border-[#1A2D50] rounded-2xl p-3.5">
          <p className="font-semibold text-sm text-white truncate">{legs[0].away_name || legs[0].away} vs {legs[0].home_name || legs[0].home}</p>
          <p className="text-[11px] text-zinc-500 truncate">{legs[0].league_label}{legs[0].status_detail ? ` · ${legs[0].status_detail}` : ""}</p>
          {legs.map((s) => (
            <div key={`${s.market}:${s.side}`} className="flex items-center justify-between gap-2 mt-2">
              <span className="truncate text-xs font-semibold text-emerald-300 bg-emerald-400/10 border border-emerald-400/25 rounded-full px-3 py-1">{s.pick}</span>
              <span className="font-mono font-bold text-white">{fmtOdds(s.odds)}</span>
            </div>
          ))}
        </div>
      ))}
      <div className="bg-[#10203E] border border-[#1A2D50] rounded-2xl px-4 py-3 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-zinc-400">{oddsLabel} · {count} selection{count > 1 ? "s" : ""}</span>
        <span data-testid="share-slip-odds" className="font-mono text-2xl font-bold text-emerald-400">{oddsValue}</span>
      </div>
    </div>
  );
}

export function ShareSlipModal({ share, onClose }) {
  const cardRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const link = share ? slipLink(share.code) : "";

  const copy = async () => {
    await navigator.clipboard?.writeText(link);
    setCopied(true);
    toast.success("Slip link copied");
    setTimeout(() => setCopied(false), 1800);
  };
  const toImage = () => toPng(cardRef.current, { pixelRatio: 2, cacheBust: true, backgroundColor: "#071024" });
  const download = async () => {
    setBusy(true);
    try {
      const a = document.createElement("a");
      a.href = await toImage();
      a.download = `housebets-slip-${share.code}.png`;
      a.click();
    } catch { toast.error("Couldn't create image"); } finally { setBusy(false); }
  };
  const nativeShare = async () => {
    try {
      const blob = await (await fetch(await toImage())).blob();
      const file = new File([blob], `housebets-slip-${share.code}.png`, { type: "image/png" });
      const data = { title: "My Housebets slip", text: "Tail my slip on Housebets", url: link };
      await navigator.share(navigator.canShare?.({ files: [file] }) ? { ...data, files: [file] } : data);
    } catch { /* user cancelled */ }
  };

  return (
    <AnimatePresence>
      {share && (
        <motion.div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} data-testid="share-slip-modal">
          <motion.div className="w-[400px] max-w-full bg-[#0C1A36] border border-[#1D3157] rounded-2xl p-5 max-h-[92vh] overflow-y-auto scrollbar-thin"
            initial={{ scale: 0.96, y: 15 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 15 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400">Share your slip</p>
              <button data-testid="share-slip-close" onClick={onClose} className="text-zinc-500 hover:text-white"><X size={18} /></button>
            </div>
            <ShareCard cardRef={cardRef} {...share} />
            <div className="mt-4 flex items-center gap-2 bg-[#071024] border border-[#1D3157] rounded-xl pl-3 pr-1 py-1">
              <code data-testid="share-slip-link" className="flex-1 truncate text-xs font-mono text-zinc-300">{link}</code>
              <button data-testid="share-slip-copy" onClick={copy}
                className="flex items-center gap-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-black rounded-lg px-3 py-2">
                {copied ? <Check size={13} /> : <Link2 size={13} />}{copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <div className="mt-2 flex gap-2">
              <button data-testid="share-slip-download" onClick={download} disabled={busy}
                className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold border border-[#1D3157] hover:border-emerald-500/60 rounded-xl py-2.5 disabled:opacity-60">
                <Download size={14} /> Save image
              </button>
              {typeof navigator !== "undefined" && navigator.share && (
                <button data-testid="share-slip-native" onClick={nativeShare}
                  className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold border border-[#1D3157] hover:border-emerald-500/60 rounded-xl py-2.5">
                  <Share2 size={14} /> Share
                </button>
              )}
            </div>
            <p className="mt-3 text-[11px] text-zinc-500 text-center">Friends who open the link get these picks loaded into their slip at the latest odds.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
