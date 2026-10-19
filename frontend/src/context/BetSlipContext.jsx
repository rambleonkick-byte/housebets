import { createContext, useContext, useState, useCallback } from "react";
import { toast } from "sonner";

const BetSlipContext = createContext(null);

function selId(s) { return `${s.event_id}:${s.market}:${s.side}`; }

export function BetSlipProvider({ children }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);

  const addSelection = useCallback((sel) => {
    setItems((prev) => {
      const id = selId(sel);
      // one selection per event
      const sameEvent = prev.find((p) => p.event_id === sel.event_id && selId(p) !== id);
      if (prev.find((p) => selId(p) === id)) {
        toast("Removed from bet slip");
        return prev.filter((p) => selId(p) !== id);
      }
      let next = prev;
      if (sameEvent) next = prev.filter((p) => p.event_id !== sel.event_id);
      toast.success("Added to bet slip");
      setOpen(true);
      return [...next, { ...sel, _id: id }];
    });
  }, []);

  const removeSelection = useCallback((id) => {
    setItems((prev) => prev.filter((p) => selId(p) !== id));
  }, []);
  const clear = useCallback(() => setItems([]), []);
  const has = useCallback((sel) => items.some((p) => selId(p) === selId(sel)), [items]);

  return (
    <BetSlipContext.Provider value={{ items, addSelection, removeSelection, clear, has, open, setOpen, selId }}>
      {children}
    </BetSlipContext.Provider>
  );
}

export const useBetSlip = () => useContext(BetSlipContext);
