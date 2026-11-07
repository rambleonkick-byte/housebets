import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

export function formatApiErrorDetail(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).filter(Boolean).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export const COIN_META = {
  USD: { name: "US Dollar", color: "#67E8F9" },
  BTC: { name: "Bitcoin", color: "#F7931A" },
  ETH: { name: "Ethereum", color: "#627EEA" },
  USDT: { name: "Tether", color: "#26A17B" },
  SOL: { name: "Solana", color: "#14F195" },
};

export const COIN_NETWORK = { BTC: "BTC", ETH: "ERC20", USDT: "ERC20", SOL: "SOL" };

const EXPLORERS = {
  BTC: (h) => `https://blockchair.com/bitcoin/transaction/${h}`,
  ETH: (h) => `https://etherscan.io/tx/${h}`,
  ERC20: (h) => `https://etherscan.io/tx/${h}`,
  TRC20: (h) => `https://tronscan.org/#/transaction/${h}`,
  SOL: (h) => `https://solscan.io/tx/${h}`,
};

export function explorerUrl(coin, hash, net) {
  if (!hash) return null;
  const f = EXPLORERS[coin === "USDT" ? net || COIN_NETWORK.USDT : coin];
  return f ? f(hash) : null;
}
