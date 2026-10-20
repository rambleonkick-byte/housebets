export const COIN_USD = { BTC: 64000, ETH: 3400, USDT: 1, SOL: 150, USD: 1 };

export function usdValue(balances, rates = COIN_USD) {
  return Object.entries(balances || {}).reduce(
    (sum, [c, amt]) => sum + (rates[c] || 0) * (amt || 0), 0
  );
}

export function fmtCrypto(n, coin) {
  if (coin === "USD") {
    const v = Number(n || 0);
    return `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  const d = coin === "USDT" ? 2 : coin === "SOL" ? 3 : coin === "ETH" ? 4 : 6;
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: d });
}

export function fmtOdds(dec) {
  return Number(dec || 0).toFixed(2);
}

export function fmtAmt(n, coin) {
  return coin === "USD" ? fmtCrypto(n, coin) : `${fmtCrypto(n, coin)} ${coin}`;
}
