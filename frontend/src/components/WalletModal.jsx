import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowDownToLine, ArrowUpFromLine, Loader2, Settings, Copy, ExternalLink, ShieldCheck } from "lucide-react";
import { api, formatApiErrorDetail, COIN_META, COIN_NETWORK } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { fmtCrypto, usdValue } from "@/lib/format";
import { Usd } from "@/components/Usd";
import { usePrices } from "@/lib/prices";
import { toast } from "sonner";

const COINS = ["BTC", "ETH", "USDT", "SOL"];

const EXPLORER = {
  BTC: (h) => `https://blockchair.com/bitcoin/transaction/${h}`,
  ETH: (h) => `https://etherscan.io/tx/${h}`,
  USDT: (h) => `https://etherscan.io/tx/${h}`,
  SOL: (h) => `https://solscan.io/tx/${h}`,
};
const PAYOUT_TERMINAL = ["confirmed", "failed", "rejected", "canceled", "cancelled"];

function payoutBadge(status, refunded) {
  const s = (status || "").toLowerCase();
  if (refunded || ["failed", "rejected", "canceled", "cancelled"].includes(s))
    return { label: refunded ? "Refunded" : s, cls: "text-red-300 bg-red-500/10 border-red-500/30" };
  if (s === "confirmed") return { label: "Confirmed", cls: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30" };
  if (s === "pending_approval") return { label: "Pending approval", cls: "text-sky-300 bg-sky-500/10 border-sky-500/30" };
  if (s === "approving") return { label: "Approving", cls: "text-sky-300 bg-sky-500/10 border-sky-500/30" };
  return { label: s || "processing", cls: "text-amber-300 bg-amber-500/10 border-amber-500/30" };
}

export function WalletModal({ open, onClose }) {
  const { user, setBalances } = useAuth();
  const [tab, setTab] = useState("deposit");
  const [coin, setCoin] = useState("USDT");
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [showCfg, setShowCfg] = useState(false);
  const [deposit, setDeposit] = useState(null);     // generated address payload
  const [oxaPolling, setOxaPolling] = useState(false);
  const pollRef = (typeof window !== "undefined") ? WalletModal._pollRef || (WalletModal._pollRef = { t: null }) : { t: null };
  const payoutRef = (typeof window !== "undefined") ? WalletModal._payoutRef || (WalletModal._payoutRef = { t: null }) : { t: null };

  const load = async () => {
    const [{ data: w }, { data: c }] = await Promise.all([api.get("/wallet"), api.get("/payment/config")]);
    setWallet(w);
    setCfg(c);
  };
  useEffect(() => { if (open) load(); }, [open]);
  useEffect(() => () => { if (pollRef.t) clearInterval(pollRef.t); if (payoutRef.t) clearInterval(payoutRef.t); }, []);
  useEffect(() => { setDeposit(null); }, [coin, tab]);

  // keep pending withdrawals up to date (admin approval, on-chain status, tx hash)
  useEffect(() => {
    if (payoutRef.t) { clearInterval(payoutRef.t); payoutRef.t = null; }
    if (!open || !wallet) return;
    const pending = (wallet.transactions || [])
      .filter((t) => t.payout && !t.payout.refunded && !PAYOUT_TERMINAL.includes((t.payout.status || "").toLowerCase()));
    if (pending.length === 0) return;
    const poll = async () => {
      const trackIds = pending.map((t) => t.payout.track_id).filter(Boolean);
      for (const id of trackIds) {
        try { await api.get(`/wallet/payout/status/${id}`); } catch { /* keep polling */ }
      }
      load(); // refresh to reflect admin approvals + on-chain updates
    };
    payoutRef.t = setInterval(poll, 12000);
    return () => { if (payoutRef.t) clearInterval(payoutRef.t); };
  }, [open, wallet]);

  // permanent per-coin deposit address; poll for confirmed on-chain deposits
  useEffect(() => {
    if (!open || tab !== "deposit") return;
    let alive = true;
    setLoading(true);
    api.get(`/wallet/deposit-address/${coin}`)
      .then(({ data }) => { if (alive) setDeposit(data); })
      .catch((e) => alive && toast.error(formatApiErrorDetail(e.response?.data?.detail)))
      .finally(() => alive && setLoading(false));
    setOxaPolling(true);
    pollRef.t = setInterval(async () => {
      try {
        const { data: st } = await api.post(`/wallet/deposit-address/${coin}/check`);
        if (st.credited > 0) {
          setBalances(st.balances);
          toast.success(`Deposit confirmed — ${st.credited} ${coin} credited`);
          load();
        }
      } catch { /* address not ready yet */ }
    }, 10000);
    return () => { alive = false; clearInterval(pollRef.t); setOxaPolling(false); };
  }, [open, tab, coin]);

  const act = async () => {
    // withdraw only (deposits use permanent addresses)
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter an amount"); return; }
    if (!address || address.trim().length < 10) { toast.error("Enter a valid wallet address"); return; }
    setLoading(true);
    try {
      const { data } = await api.post(`/wallet/withdraw`, { coin, amount: amt, address: address.trim() });
      setBalances(data.balances);
      toast.success(`Withdrawal requested — pending admin approval`);
      setAmount("");
      setAddress("");
      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  const { rates, live } = usePrices();
  const total = wallet ? usdValue(wallet.balances, rates) : 0;

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
                <p data-testid="wallet-total-usd" className="font-mono text-2xl font-bold">${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                <p data-testid="wallet-price-status" className="text-[10px] font-mono text-zinc-500 flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`} />{live ? "Live market prices" : "Estimated prices"}</p>
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
                    <Usd amount={wallet.balances[c]} coin={c} prefix="" className="text-[11px] text-zinc-500" testId={`wallet-balance-usd-${c}`} />
                    <p className="text-[10px] font-mono text-zinc-600">@ ${Number(rates[c] || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
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

                {tab === "deposit" && !deposit && (
                  <div className="flex items-center justify-center gap-2 text-sm text-zinc-400 py-10" data-testid="deposit-loading">
                    {loading ? <><Loader2 size={16} className="animate-spin" /> Loading your {coin} address…</> : "Deposit address unavailable — try again shortly"}
                  </div>
                )}

                {tab === "deposit" && deposit && (
                  <div className="space-y-3" data-testid="deposit-address-panel">
                    <div className="flex justify-center py-2">
                      <div className="relative p-2.5 bg-white rounded-xl shadow-[0_0_0_1px_#2A2F45,0_8px_30px_-8px_rgba(16,185,129,0.35)]">
                        <img src={deposit.qr_code} alt="Deposit QR" data-testid="deposit-qr"
                          className="w-40 h-40 object-contain block [image-rendering:pixelated]" />
                        <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-[#12141C] border"
                          style={{ color: COIN_META[coin].color, borderColor: COIN_META[coin].color }}>{coin}</span>
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-[11px] font-mono uppercase tracking-wider text-emerald-400" data-testid="deposit-permanent-label">Your permanent {coin} address</p>
                      <p className="text-[11px] text-zinc-500 mt-0.5">Network: <span className="text-zinc-300">{deposit.network}</span></p>
                      <p className="text-[11px] text-zinc-500 mt-1">Send any amount, anytime — it never expires. Only send {coin} on this network.</p>
                    </div>
                    <div className="bg-[#0E1017] border border-[#2A2F45] rounded-lg p-3 flex items-center justify-between gap-2">
                      <code className="font-mono text-xs text-zinc-200 break-all" data-testid="deposit-address">{deposit.address}</code>
                      <button data-testid="deposit-copy-address" onClick={() => { navigator.clipboard?.writeText(deposit.address); toast("Address copied"); }}
                        className="text-zinc-500 hover:text-emerald-400 shrink-0"><Copy size={15} /></button>
                    </div>
                    {deposit.memo && (
                      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5">
                        <p className="text-[11px] text-amber-300">Memo/Tag required: <span className="font-mono font-bold">{deposit.memo}</span></p>
                      </div>
                    )}
                    <div className="flex items-center justify-center gap-2 text-xs text-zinc-400" data-testid="deposit-status">
                      <Loader2 size={13} className={oxaPolling ? "animate-spin" : ""} />
                      Watching for incoming deposits — balance credits automatically once confirmed
                    </div>
                  </div>
                )}

                {tab === "withdraw" && (
                  <>
                    <div className="bg-[#0E1017] border border-[#2A2F45] rounded-lg p-3 flex items-start gap-2">
                      <ArrowUpFromLine size={15} className="text-emerald-400 mt-0.5 shrink-0" />
                      <p className="text-[11px] text-zinc-400">Send your {coin} to any external wallet on the <span className="text-zinc-200">{COIN_NETWORK[coin]}</span> network. Payouts are sent on-chain via OxaPay — double-check the address, crypto sent can't be reversed.</p>
                    </div>
                    <input data-testid="wallet-address-input" value={address}
                      onChange={(e) => setAddress(e.target.value)} placeholder={`${coin} wallet address`}
                      className="w-full bg-[#090A0F] border border-[#2A2F45] rounded-lg px-3 py-2.5 font-mono text-xs break-all focus:outline-none focus:border-emerald-500" />
                    <input data-testid="wallet-amount-input" type="number" min="0" value={amount}
                      onChange={(e) => setAmount(e.target.value)} placeholder={`Amount in ${coin}`}
                      className="w-full bg-[#090A0F] border border-[#2A2F45] rounded-lg px-3 py-2.5 font-mono text-sm focus:outline-none focus:border-emerald-500" />
                    <button data-testid="wallet-submit-button" onClick={act} disabled={loading}
                      className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-2.5 rounded-lg transition-colors disabled:opacity-60">
                      {loading && <Loader2 size={16} className="animate-spin" />} Withdraw to Address
                    </button>
                  </>
                )}
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
                    {wallet.transactions.slice(0, 8).map((t) => {
                      const positive = t.type === "payout" || t.type === "deposit" || t.type === "refund";
                      const po = t.payout;
                      const hash = po?.tx_hash;
                      const explorer = hash && EXPLORER[t.coin] ? EXPLORER[t.coin](hash) : null;
                      return (
                        <div key={t.id} className="bg-[#0E1017] rounded-md px-3 py-2" data-testid={`wallet-tx-${t.id}`}>
                          <div className="flex items-center justify-between text-sm">
                            <span className="capitalize text-zinc-300">{t.type}</span>
                            <span className={`font-mono text-xs ${positive ? "text-emerald-400" : "text-zinc-400"}`}>
                              {positive ? "+" : "-"}{fmtCrypto(t.amount, t.coin)} {t.coin}
                              <Usd amount={t.amount} coin={t.coin} className="text-zinc-500 ml-1.5" />
                            </span>
                          </div>
                          {po && (() => {
                            const b = payoutBadge(po.status, po.refunded);
                            return (
                              <div className="flex items-center justify-between gap-2 mt-1.5">
                                <span data-testid={`payout-status-${t.id}`}
                                  className={`text-[9px] font-mono uppercase tracking-wider border rounded px-1.5 py-0.5 ${b.cls}`}>
                                  {b.label}
                                </span>
                                {hash ? (
                                  explorer ? (
                                    <a href={explorer} target="_blank" rel="noopener noreferrer" data-testid={`payout-txhash-${t.id}`}
                                      className="flex items-center gap-1 text-[10px] font-mono text-zinc-400 hover:text-emerald-300 truncate max-w-[55%]">
                                      <span className="truncate">{hash}</span><ExternalLink size={11} className="shrink-0" />
                                    </a>
                                  ) : (
                                    <span data-testid={`payout-txhash-${t.id}`} className="text-[10px] font-mono text-zinc-500 truncate max-w-[55%]">{hash}</span>
                                  )
                                ) : (
                                  <span className="text-[10px] font-mono text-zinc-600">awaiting tx hash…</span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
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
