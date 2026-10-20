import { usePrices, fmtUsd } from "@/lib/prices";

export function Usd({ amount, coin, className = "text-zinc-500", prefix = "≈ ", testId }) {
  const { rates } = usePrices();
  return (
    <span data-testid={testId} className={`font-mono ${className}`}>
      {prefix}{fmtUsd((rates[coin] || 0) * (Number(amount) || 0))}
    </span>
  );
}
