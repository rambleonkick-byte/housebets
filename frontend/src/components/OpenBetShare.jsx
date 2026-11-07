import { BrandLogo } from "@/components/BrandLogo";
import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Download, Share2, Link2, Check, CheckCircle2, XCircle, CircleDot } from "lucide-react";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import { fmtOdds, fmtAmt } from "@/lib/format";

export function BrandMark({ size = "sm" }) {
  const big = size === "lg";
  return (
    <div className="flex items-center gap-1.5" data-testid="apex-brand-mark">
      <BrandLogo className={big ? "h-6" : "h-4"} testid="open-bet-brand-logo" />
    </div>
  );
}

const MARK = { won: [CheckCircle2, "text-emerald-400"], winning: [CircleDot, "text-emerald-400"], losing: [CircleDot, "text-red-400"], lost: [XCircle, "text-red-400"] };

function ShareCard({ cardRef, bet, legs, by }) {
  const winner = bet.status === "won";
  const toWin = winner ? bet.payout : bet.potential_payout - (bet.free_bet ? bet.stake : 0);
  const profit = winner ? bet.payout - (bet.free_bet ? 0 : bet.stake) : 0;
  return (
    <div ref={cardRef} data-testid="open-bet-share-card" className={`relative overflow-hidden w-full bg-[#09142D] border rounded-3xl p-5 space-y-3 ${winner ? "border-emerald-500/50" : "border-[#162848]"}`}
      style={{ backgroundImage: winner ? "radial-gradient(120% 70% at 50% 0%, rgba(34,211,238,0.30), transparent 65%)" : "radial-gradient(120% 60% at 100% 0%, rgba(34,211,238,0.16), transparent 60%)" }}>
      <div className="flex items-center justify-between">
        <BrandMark size="lg" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{by}'s {bet.bet_type === "parlay" ? `${bet.selections.length}-leg parlay` : "bet"}</span>
      </div>
      {winner && (
        <div className="flex justify-center py-1">
          <div data-testid="share-winner-stamp" className="rotate-[-6deg] border-[3px] border-emerald-400 text-emerald-400 rounded-xl px-5 py-1 font-display font-black text-4xl tracking-[0.14em] shadow-[0_0_30px_rgba(34,211,238,0.45)]">
            WINNER
          </div>
        </div>
      )}
      {bet.selections.map((s, i) => {
        const l = legs?.[i];
        const [Icon, cls] = winner ? [CheckCircle2, "text-emerald-400"] : (l && l.state !== "pre" && MARK[l.status]) || [];
        return (
          <div key={i} className="bg-[#10203E] border border-[#1A2D50] rounded-2xl p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 min-w-0 text-sm font-bold text-white truncate">{Icon && <Icon size={14} className={cls} />}{s.pick}</span>
              <span className="font-mono font-bold text-white">{fmtOdds(s.odds)}</span>
            </div>
            <p className="text-[11px] text-zinc-500 truncate mt-0.5">
              {l && l.state !== "pre" ? `${l.state === "in" ? "LIVE" : "FINAL"} · ${s.away} ${l.away_score ?? "-"} – ${l.home_score ?? "-"} ${s.home}` : `${s.away} @ ${s.home}`} · {s.league_label}
            </p>
          </div>
        );
      })}
      <div className="grid grid-cols-3 gap-2 text-center">
        {[["Odds", fmtOdds(bet.total_odds), "text-white"], ["Stake", fmtAmt(bet.stake, bet.coin), "text-white"], [winner ? "Paid" : "To win", fmtAmt(toWin, bet.coin), "text-emerald-400"]].map(([k, v, c]) => (
          <div key={k} className="bg-[#10203E] border border-[#1A2D50] rounded-2xl py-2.5">
            <p className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">{k}</p>
            <p className={`font-mono text-base font-bold ${c}`} data-testid={`open-bet-share-${k.replace(" ", "-").toLowerCase()}`}>{v}</p>
          </div>
        ))}
      </div>
      {winner && (
        <div data-testid="share-winner-profit" className="text-center bg-emerald-500 text-black rounded-2xl py-2.5 font-display font-black text-xl tracking-tight">
          +{fmtAmt(profit, bet.coin)} PROFIT
        </div>
      )}
      <p className="text-center text-[10px] font-mono uppercase tracking-[0.25em] text-zinc-500">{window.location.host}</p>
    </div>
  );
}

export function OpenBetShareModal({ share, onClose }) {
  const cardRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const site = window.location.origin;
  const name = share ? `housebets-bet-${share.bet.id.slice(0, 8)}.png` : "";
  const toImage = () => toPng(cardRef.current, { pixelRatio: 2, cacheBust: true, backgroundColor: "#071024" });

  const download = async () => {
    setBusy(true);
    try { const a = document.createElement("a"); a.href = await toImage(); a.download = name; a.click(); }
    catch { toast.error("Couldn't create image"); } finally { setBusy(false); }
  };
  const nativeShare = async () => {
    try {
      const file = new File([await (await fetch(await toImage())).blob()], name, { type: "image/png" });
      const data = share.bet.status === "won"
        ? { title: "I won on Housebets", text: `Cashed a winner on Housebets 💰`, url: site }
        : { title: "My Housebets bet", text: "Riding this one on Housebets", url: site };
      await navigator.share(navigator.canShare?.({ files: [file] }) ? { ...data, files: [file] } : data);
    } catch { /* cancelled */ }
  };
  const copy = async () => {
    await navigator.clipboard?.writeText(site);
    setCopied(true); toast.success("Link copied"); setTimeout(() => setCopied(false), 1800);
  };

  return (
    <AnimatePresence>
      {share && (
        <motion.div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} data-testid="open-bet-share-modal">
          <motion.div className="w-[400px] max-w-full bg-[#0C1A36] border border-[#1D3157] rounded-2xl p-5 max-h-[92vh] overflow-y-auto scrollbar-thin"
            initial={{ scale: 0.96, y: 15 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 15 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400">{share?.bet.status === "won" ? "Share your win" : "Share your bet"}</p>
              <button data-testid="open-bet-share-close" onClick={onClose} className="text-zinc-500 hover:text-white"><X size={18} /></button>
            </div>
            <ShareCard cardRef={cardRef} {...share} />
            <div className="mt-4 flex gap-2">
              <button data-testid="open-bet-share-download" onClick={download} disabled={busy}
                className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl py-2.5 disabled:opacity-60">
                <Download size={14} /> Save image
              </button>
              {navigator.share && (
                <button data-testid="open-bet-share-native" onClick={nativeShare}
                  className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold border border-[#1D3157] hover:border-emerald-500/60 rounded-xl py-2.5">
                  <Share2 size={14} /> Share
                </button>
              )}
              <button data-testid="open-bet-share-copy" onClick={copy}
                className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold border border-[#1D3157] hover:border-emerald-500/60 rounded-xl py-2.5">
                {copied ? <Check size={14} /> : <Link2 size={14} />} {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <p className="mt-3 text-[11px] text-zinc-500 text-center">Save the image and post it on X, Instagram or Discord.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
