import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { COIN_USD } from "@/lib/format";

export function usePrices() {
  const { data } = useQuery({
    queryKey: ["prices"],
    queryFn: async () => (await api.get("/prices")).data,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return { rates: data?.rates || COIN_USD, live: !!data?.live };
}

export function fmtUsd(n) {
  const v = Number(n || 0);
  const d = Math.abs(v) < 1 && v !== 0 ? 4 : 2;
  return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: d });
}
