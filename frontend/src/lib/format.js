export const COIN_USD = { BTC: 64000, ETH: 3400, USDT: 1, SOL: 150 };

export function usdValue(balances, rates = COIN_USD) {
  return Object.entries(balances || {}).reduce(
    (sum, [c, amt]) => sum + (rates[c] || 0) * (amt || 0), 0
  );
}

export function fmtCrypto(n, coin) {
  const d = coin === "USDT" ? 2 : coin === "SOL" ? 3 : coin === "ETH" ? 4 : 6;
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: d });
}

export function fmtOdds(dec) {
  return Number(dec || 0).toFixed(2);
}
