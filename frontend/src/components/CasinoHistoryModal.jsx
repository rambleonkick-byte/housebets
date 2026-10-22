import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ShieldCheck, RefreshCw, Copy, Check, Loader2 } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { fmtCrypto, fmtAmt } from "@/lib/format";
import { verifyGame, sha256Hex } from "@/lib/fairness";
import { Usd } from "@/components/Usd";
import { toast } from "sonner";

const GAME_COLORS = { limbo: "#10B981", dice: "#627EEA", plinko: "#8B5CF6", keno: "#22C55E", mines: "#F59E0B", blackjack: "#14B8A6" };

export function CasinoHistoryModal({ open, onClose }) {
  const [tab, setTab] = useState("history");
  const [games, setGames] = useState([]);
  const [seed, setSeed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [clientSeedInput, setClientSeedInput] = useState("");
  const [verifs, setVerifs] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: h }, { data: s }] = await Promise.all([
        api.get("/casino/history"), api.get("/casino/seed"),
      ]);
      setGames(h.games);
      setSeed(s);
      setClientSeedInput(s.client_seed);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { if (open) { load(); setVerifs({}); } }, [open]);

  const revealedByHash = useMemo(() => {
    const m = {};
    (seed?.revealed || []).forEach((r) => { m[r.server_seed_hash] = r.server_seed; });
    return m;
  }, [seed]);

  const saveClientSeed = async () => {
    try {
      const { data } = await api.post("/casino/seed/client", { client_seed: clientSeedInput });
      toast.success("Client seed updated");
      setSeed((s) => ({ ...s, client_seed: data.client_seed }));
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };

  const rotate = async () => {
    try {
      const { data } = await api.post("/casino/seed/rotate");
      toast.success("Server seed rotated & revealed");
      // verify the revealed seed hashes to the previously shown hash
      const ok = (await sha256Hex(data.revealed_server_seed)) === data.revealed_server_seed_hash;
      if (ok) toast.success("Revealed seed matches its original hash ✓");
      load();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };

  const doVerify = async (gme) => {
    const ss = revealedByHash[gme.server_seed_hash];
    if (!ss) {
      toast("Rotate your server seed first to reveal & verify this bet");
      return;
    }
    const hashOk = (await sha256Hex(ss)) === gme.server_seed_hash;
    const res = await verifyGame(gme.game, ss, gme.client_seed, gme.nonce, gme.detail);
    setVerifs((v) => ({ ...v, [gme.id]: { ...res, hashOk } }));
    if (hashOk && res.matches) toast.success("Verified — result is provably fair ✓");
    else toast.error("Verification mismatch!");
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} data-testid="casino-history-modal">
          <motion.div className="w-full max-w-xl bg-[#12141C] border border-[#2A2F45] rounded-xl overflow-hidden max-h-[88vh] flex flex-col"
            initial={{ scale: 0.96, y: 15 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 15 }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#2A2F45]">
              <div className="flex items-center gap-2">
                <ShieldCheck size={18} className="text-emerald-400" />
                <span className="font-display text-lg font-bold tracking-tight">Casino · History & Fairness</span>
              </div>
              <button data-testid="casino-history-close" onClick={onClose} className="text-zinc-500 hover:text-white"><X size={20} /></button>
            </div>

            <div className="flex gap-1 p-3 border-b border-[#2A2F45]">
              {["history", "fairness"].map((t) => (
                <button key={t} data-testid={`casino-tab-${t}`} onClick={() => setTab(t)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md capitalize transition-colors ${
                    tab === t ? "bg-emerald-500 text-black" : "text-zinc-400 hover:text-white"
                  }`}>{t}</button>
              ))}
            </div>

            <div className="overflow-y-auto scrollbar-thin p-3">
              {loading ? (
                <p className="text-center text-sm text-zinc-500 py-12"><Loader2 size={18} className="animate-spin inline" /></p>
              ) : tab === "history" ? (
                games.length === 0 ? (
                  <p className="text-center text-sm text-zinc-500 py-12" data-testid="casino-history-empty">No games played yet.</p>
                ) : (
                  <div className="space-y-2">
                    {games.map((gme) => {
                      const v = verifs[gme.id];
                      return (
                        <div key={gme.id} data-testid={`casino-history-row-${gme.id}`} className="bg-[#0E1017] border border-[#2A2F45] rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full" style={{ background: GAME_COLORS[gme.game] || "#A1A1AA" }} />
                              <span className="text-sm font-semibold capitalize">{gme.game}</span>
                              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${gme.won ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-700/40 text-zinc-400"}`}>
                                {gme.multiplier}×
                              </span>
                            </div>
                            <div className="text-right">
                              <p className="font-mono text-xs text-zinc-400">{fmtAmt(gme.stake, gme.coin)}</p>
                              <p className={`font-mono text-xs ${gme.won ? "text-emerald-400" : "text-zinc-500"}`}>
                                {gme.won ? "+" : ""}{fmtCrypto(gme.payout, gme.coin)}
                              </p>
                              <Usd amount={gme.won ? gme.payout : gme.stake} coin={gme.coin} prefix={gme.won ? "+" : "-"} className="text-[10px] text-zinc-500" />
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#1E2234]">
                            <span className="font-mono text-[10px] text-zinc-600 truncate">nonce {gme.nonce ?? "—"} · {(gme.server_seed_hash || "").slice(0, 12)}…</span>
                            <button data-testid={`casino-verify-${gme.id}`} onClick={() => doVerify(gme)}
                              className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300 shrink-0 ml-2">
                              Verify
                            </button>
                          </div>
                          {v && (
                            <div className={`mt-2 text-[11px] font-mono rounded px-2 py-1 ${v.hashOk && v.matches ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}
                              data-testid={`casino-verify-result-${gme.id}`}>
                              {v.hashOk && v.matches ? "✓ Verified" : "✗ Mismatch"} · {v.computed} · hash {v.hashOk ? "ok" : "bad"}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              ) : (
                <FairnessPanel seed={seed} clientSeedInput={clientSeedInput} setClientSeedInput={setClientSeedInput}
                  onSave={saveClientSeed} onRotate={rotate} />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function FairnessPanel({ seed, clientSeedInput, setClientSeedInput, onSave, onRotate }) {
  const [copied, setCopied] = useState(false);
  if (!seed) return null;
  const copy = () => { navigator.clipboard?.writeText(seed.server_seed_hash); setCopied(true); setTimeout(() => setCopied(false), 1200); };
  return (
    <div className="space-y-4">
      <div className="bg-[#0E1017] border border-[#2A2F45] rounded-lg p-3">
        <p className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 mb-1">Active server seed hash</p>
        <div className="flex items-center gap-2">
          <code className="font-mono text-xs text-emerald-300 break-all flex-1" data-testid="fairness-server-hash">{seed.server_seed_hash}</code>
          <button onClick={copy} className="text-zinc-500 hover:text-emerald-400 shrink-0">{copied ? <Check size={14} /> : <Copy size={14} />}</button>
        </div>
        <p className="text-[11px] text-zinc-500 mt-2">The server seed is committed via this SHA-256 hash <span className="text-zinc-300">before</span> you bet. Rotate to reveal it and verify past results.</p>
      </div>

      <div>
        <p className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 mb-1.5">Client seed</p>
        <div className="flex gap-2">
          <input data-testid="fairness-client-seed-input" value={clientSeedInput} onChange={(e) => setClientSeedInput(e.target.value)}
            className="flex-1 bg-[#090A0F] border border-[#2A2F45] rounded-lg px-3 py-2 font-mono text-xs focus:outline-none focus:border-emerald-500" />
          <button data-testid="fairness-save-client-seed" onClick={onSave}
            className="text-xs bg-[#222636] hover:bg-[#2b3047] text-zinc-200 font-semibold px-4 rounded-lg">Save</button>
        </div>
        <p className="text-[11px] text-zinc-500 mt-1">You control this value — it mixes into every result.</p>
      </div>

      <div className="flex items-center justify-between bg-[#0E1017] border border-[#2A2F45] rounded-lg p-3">
        <div>
          <p className="text-sm font-semibold">Rotate server seed</p>
          <p className="text-[11px] text-zinc-500">Reveals the current seed so past bets become verifiable.</p>
        </div>
        <button data-testid="fairness-rotate-button" onClick={onRotate}
          className="flex items-center gap-1.5 text-xs bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-3 py-2 rounded-lg shrink-0">
          <RefreshCw size={13} /> Rotate
        </button>
      </div>

      {seed.revealed?.length > 0 && (
        <div>
          <p className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 mb-1.5">Revealed seeds ({seed.revealed.length})</p>
          <div className="space-y-1.5" data-testid="fairness-revealed-list">
            {seed.revealed.map((r, i) => (
              <div key={i} className="bg-[#0E1017] border border-[#2A2F45] rounded px-2 py-1.5">
                <p className="font-mono text-[10px] text-zinc-500 break-all">hash {r.server_seed_hash.slice(0, 20)}…</p>
                <p className="font-mono text-[10px] text-emerald-300/80 break-all">seed {r.server_seed.slice(0, 20)}…</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
