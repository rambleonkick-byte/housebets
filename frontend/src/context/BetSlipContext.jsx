import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { refreshLeg } from "@/lib/slips";
import { toast } from "sonner";

const BetSlipContext = createContext(null);

function selId(s) { return `${s.event_id}:${s.market}:${s.side}`; }

// Identifies the underlying market a pick belongs to, so we can detect
// conflicting selections (e.g. Over vs Under on the same prop line, or
// home vs away moneyline) while still allowing multiple distinct props
// from the same game (same-game parlay).
function baseKey(s) {
  if (s.market === "prop") {
    const parts = String(s.side).split(":"); // stat:player_id:over|under
    return `${s.event_id}:prop:${parts[0]}:${parts[1]}`;
  }
  return `${s.event_id}:${s.market}`;
}

export function BetSlipProvider({ children }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [acceptBetter, setAcceptBetter] = useState(() => localStorage.getItem("apex_accept_better") !== "0");
  useEffect(() => { localStorage.setItem("apex_accept_better", acceptBetter ? "1" : "0"); }, [acceptBetter]);

  const addSelection = useCallback((sel) => {
    setItems((prev) => {
      const id = selId(sel);
      // Clicking the same pick again toggles it off.
      if (prev.find((p) => selId(p) === id)) {
        toast("Removed from bet slip");
        return prev.filter((p) => selId(p) !== id);
      }
      // Block conflicting sides of the same underlying market.
      const conflict = prev.find((p) => baseKey(p) === baseKey(sel) && selId(p) !== id);
      if (conflict) {
        toast.error("Can't pick both sides of the same market");
        return prev;
      }
      toast.success("Added to bet slip");
      setOpen(true);
      return [...prev, { ...sel, _id: id }];
    });
  }, []);

  const removeSelection = useCallback((id) => {
    setItems((prev) => prev.filter((p) => selId(p) !== id));
  }, []);
  const clear = useCallback(() => setItems([]), []);
  // Mark a price move on a leg; worse moves (or any move when auto-accept is off) need confirmation.
  const movePrice = useCallback((p, odds, autoOk) => {
    if (Math.round(odds * 100) === Math.round(p.odds * 100)) return p;
    const move = odds > p.odds ? "up" : "down";
    return { ...p, prevOdds: p.prevOdds ?? p.odds, odds, move, movedAt: Date.now(),
      pending: p.pending || !(autoOk && move === "up") };
  }, []);

  const syncPrices = useCallback((events) => {
    if (!events?.length) return;
    setItems((prev) => prev.map((p) => {
      const fresh = refreshLeg(p, events);
      return fresh ? movePrice({ ...p, status_detail: fresh.status_detail, live: fresh.live }, fresh.odds, acceptBetter) : p;
    }));
  }, [acceptBetter, movePrice]);

  const acceptChanges = useCallback(() => {
    setItems((prev) => prev.map((p) => ({ ...p, pending: false, prevOdds: undefined, move: undefined })));
  }, []);

  const applyServerPrices = useCallback(({ changed = [], unavailable = [] }) => {
    const key = (x) => `${x.event_id}:${x.market}:${x.side}`;
    const gone = new Set(unavailable.map(key));
    const upd = new Map(changed.map((c) => [key(c), c.odds]));
    setItems((prev) => prev.filter((p) => !gone.has(selId(p)))
      .map((p) => (upd.has(selId(p)) ? { ...movePrice(p, upd.get(selId(p)), false), pending: true } : p)));
  }, [movePrice]);

  const loadSlip = useCallback((sels) => {
    setItems(sels.map((s) => ({ ...s, _id: selId(s) })));
    setOpen(true);
  }, []);
  const has = useCallback((sel) => items.some((p) => selId(p) === selId(sel)), [items]);

  return (
    <BetSlipContext.Provider value={{ items, addSelection, removeSelection, clear, has, open, setOpen, selId, loadSlip, applyServerPrices, syncPrices, acceptChanges, acceptBetter, setAcceptBetter }}>
      {children}
    </BetSlipContext.Provider>
  );
}

export const useBetSlip = () => useContext(BetSlipContext);
