import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useBetSlip } from "@/context/BetSlipContext";

export function slipLink(code) {
  return `${window.location.origin}/?slip=${code}`;
}

// Re-price a shared leg against the live feed; returns null if no longer available.
function refreshLeg(leg, events) {
  const ev = events.find((e) => e.event_id === leg.event_id);
  if (!ev || ev.state === "post") return null;
  let odds = null;
  if (leg.market === "prop") {
    const [stat, pid, dir] = String(leg.side).split(":");
    const p = (ev.props || []).find((x) => x.stat === stat && String(x.player_id) === pid && x.line === leg.line);
    odds = p ? p[dir] : null;
  } else {
    const m = ev.markets.find((x) => x.market === leg.market);
    const s = m?.selections.find((x) => x.side === leg.side && (leg.line == null || x.line == null || x.line === leg.line));
    odds = s?.odds;
  }
  if (!odds) return null;
  return {
    ...leg, odds, league: ev.league, league_label: ev.league_label, home: ev.home.abbr, away: ev.away.abbr,
    home_name: ev.home.name, away_name: ev.away.name, status_detail: ev.status_detail, live: ev.state === "in",
  };
}

export function useSharedSlipLoader(events, loading) {
  const { loadSlip } = useBetSlip();
  const done = useRef(false);
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("slip");
    if (!code || loading || done.current) return;
    done.current = true;
    api.get(`/slips/${code}`).then(({ data }) => {
      const legs = data.selections.map((l) => refreshLeg(l, events)).filter(Boolean);
      const dropped = data.selections.length - legs.length;
      if (!legs.length) { toast.error("This shared slip's games are no longer available"); return; }
      loadSlip(legs);
      toast.success(`Loaded ${data.by}'s slip${dropped ? ` — ${dropped} pick${dropped > 1 ? "s" : ""} no longer available` : ""}`);
    }).catch(() => toast.error("Shared slip not found"))
      .finally(() => window.history.replaceState(null, "", window.location.pathname));
  }, [events, loading, loadSlip]);
}
