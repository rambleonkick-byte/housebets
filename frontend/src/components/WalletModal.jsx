import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowDownToLine, ArrowUpFromLine, Loader2, Settings, Copy } from "lucide-react";
import { api, formatApiErrorDetail, COIN_META } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { fmtCrypto, usdValue } from "@/lib/format";
import { toast } from "sonner";

const COINS = ["BTC", "ETH", "USDT", "SOL"];

export function WalletModal({ open, onClose }) {
  const { user, setBalances } = useAuth();
  const [tab, setTab] = useState("deposit");
  const [coin, setCoin] = useState("USDT");
  const [amount, setAmount] = useState("");
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [showCfg, setShowCfg] = useState(false);

  const load = async () => {
    const [{ data: w }, { data: c }] = await Promise.all([api.get("/wallet"), api.get("/payment/config")]);
    setWallet(w);
    setCfg(c);
  };
  useEffect(() => { if (open) load(); }, [open]);

  const act = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter an amount"); return; }
    setLoading(true);
    try {
      const { data } = await api.post(`/wallet/${tab}`, { coin, amount: amt });
      setBalances(data.balances);
      toast.success(`${tab === "deposit" ? "Deposited" : "Withdrew"} ${amt} ${coin}`);
      setAmount("");
      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  const total = wallet ? usdValue(wallet.balances, wallet.usd_rates) : 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} data-testid="wallet-modal">
          <motion.div className="w-full max-w-lg bg-[#12141C] border border-[#2A2F45] rounded-xl overflow-hidden max-h-[90vh] flex flex-col"
            initial={{ scale: 0.96, y: 15 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 15 }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#2A2F45]">
              <div>
                <p className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400">Crypto Wallet</p>
                <p className="font-mono text-2xl font-bold">${total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
              </div>
              <button data-testid="wallet-close" onClick={onClose} className="text-zinc-500 hover:text-white"><X size={20} /></button>
            </div>

            <div className="overflow-y-auto scrollbar-thin">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-4">
                {wallet && COINS.map((c) => (
                  <div key={c} data-testid={`wallet-balance-${c}`} className="bg-[#0E1017] border border-[#2A2F45] rounded-lg p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="w-2 h-2 rounded-full" style={{ background: COIN_META[c].color }} />
                      <span className="text-xs font-mono text-zinc-400">{c}</span>
                    </div>
                    <p className="font-mono text-sm font-bold">{fmtCrypto(wallet.balances[c], c)}</p>
                  </div>
                ))}
              </div>

              <div className="px-4">
                <div className="flex gap-1 bg-[#0E1017] p-1 rounded-lg">
                  {["deposit", "withdraw"].map((t) => (
                    <button key={t} data-testid={`wallet-tab-${t}`} onClick={() => setTab(t)}
                      className={`flex-1 flex items-center justify-center gap-1.5 text-sm font-medium py-2 rounded-md capitalize transition-colors ${
                        tab === t ? "bg-emerald-500 text-black" : "text-zinc-400"
                      }`}>
                      {t === "deposit" ? <ArrowDownToLine size={15} /> : <ArrowUpFromLine size={15} />}{t}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4 space-y-3">
                <div className="flex gap-1.5">
                  {COINS.map((c) => (
                    <button key={c} data-testid={`wallet-coin-${c}`} onClick={() => setCoin(c)}
                      className={`flex-1 text-xs font-mono font-semibold py-2 rounded-md border transition-colors ${
                        coin === c ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-[#2A2F45] text-zinc-400"
                      }`}>{c}</button>
                  ))}
                </div>
                {tab === "deposit" && (
                  <div className="bg-[#0E1017] border border-dashed border-[#2A2F45] rounded-lg p-3 flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-[11px] text-zinc-500">Deposit address ({coin})</p>
                      <p className="font-mono text-xs truncate text-zinc-300">0x{coin.toLowerCase()}7f3c9a1e8b4d2f60a5c7</p>
                    </div>
                    <button onClick={() => { navigator.clipboard?.writeText("0x" + coin + "demo"); toast("Address copied"); }}
                      className="text-zinc-500 hover:text-emerald-400"><Copy size={15} /></button>
                  </div>
                )}
                <input data-testid="wallet-amount-input" type="number" min="0" value={amount}
                  onChange={(e) => setAmount(e.target.value)} placeholder={`Amount in ${coin}`}
                  className="w-full bg-[#090A0F] border border-[#2A2F45] rounded-lg px-3 py-2.5 font-mono text-sm focus:outline-none focus:border-emerald-500" />
                <button data-testid="wallet-submit-button" onClick={act} disabled={loading}
                  className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-2.5 rounded-lg transition-colors disabled:opacity-60">
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  {tab === "deposit" ? "Simulate Deposit" : "Withdraw"}
                </button>
              </div>

              {/* Pluggable payment config */}
              <div className="px-4 pb-4">
                <button data-testid="payment-config-toggle" onClick={() => setShowCfg((v) => !v)}
                  className="w-full flex items-center justify-between text-xs text-zinc-500 hover:text-zinc-300 py-2 border-t border-[#2A2F45]">
                  <span className="flex items-center gap-1.5"><Settings size={13} /> Payment API (pluggable)</span>
                  <span>{cfg?.mode === "live" ? "LIVE" : "MOCK"}</span>
                </button>
                {showCfg && cfg && <PaymentConfig cfg={cfg} onSaved={load} />}
              </div>

              {wallet?.transactions?.length > 0 && (
                <div className="px-4 pb-5">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-zinc-600 mb-2">Recent activity</p>
                  <div className="space-y-1.5" data-testid="wallet-transactions">
                    {wallet.transactions.slice(0, 8).map((t) => (
                      <div key={t.id} className="flex items-center justify-between text-sm bg-[#0E1017] rounded-md px-3 py-2">
                        <span className="capitalize text-zinc-300">{t.type}</span>
                        <span className={`font-mono text-xs ${t.type === "payout" || t.type === "deposit" ? "text-emerald-400" : "text-zinc-400"}`}>
                          {t.type === "payout" || t.type === "deposit" ? "+" : "-"}{fmtCrypto(t.amount, t.coin)} {t.coin}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PaymentConfig({ cfg, onSaved }) {
  const [provider, setProvider] = useState(cfg.provider || "");
  const [apiBase, setApiBase] = useState(cfg.api_base || "");
  const [apiKey, setApiKey] = useState("");
  const [mode, setMode] = useState(cfg.mode || "mock");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/payment/config", { provider, api_base: apiBase, api_key: apiKey || cfg.api_key, mode });
      toast.success("Payment config saved");
      onSaved();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-[#0E1017] border border-[#2A2F45] rounded-lg p-3 space-y-2 mt-1">
      <p className="text-[11px] text-zinc-500">Plug in your own crypto payment gateway. In mock mode deposits are simulated.</p>
      <input data-testid="payment-provider-input" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Provider name (e.g. NOWPayments)"
        className="w-full bg-[#090A0F] border border-[#2A2F45] rounded px-2.5 py-2 text-xs focus:outline-none focus:border-emerald-500" />
      <input data-testid="payment-apibase-input" value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="API base URL"
        className="w-full bg-[#090A0F] border border-[#2A2F45] rounded px-2.5 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500" />
      <input data-testid="payment-apikey-input" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={cfg.api_key || "API key"}
        className="w-full bg-[#090A0F] border border-[#2A2F45] rounded px-2.5 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500" />
      <div className="flex items-center gap-2">
        <div className="flex gap-1 flex-1">
          {["mock", "live"].map((m) => (
            <button key={m} data-testid={`payment-mode-${m}`} onClick={() => setMode(m)}
              className={`flex-1 text-xs py-1.5 rounded border uppercase font-mono ${mode === m ? "border-emerald-500 text-emerald-300" : "border-[#2A2F45] text-zinc-500"}`}>{m}</button>
          ))}
        </div>
        <button data-testid="payment-save-button" onClick={save} disabled={saving}
          className="text-xs bg-emerald-500 text-black font-semibold px-4 py-1.5 rounded">{saving ? "..." : "Save"}</button>
      </div>
    </div>
  );
}
