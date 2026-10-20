import { motion } from "framer-motion";

const SUIT = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RANK = { T: "10" };

export function PlayingCard({ card, index = 0, testId }) {
  const hidden = card === "XX";
  const red = !hidden && "HD".includes(card[1]);
  const rank = hidden ? "" : RANK[card[0]] || card[0];
  return (
    <motion.div data-testid={testId}
      initial={{ opacity: 0, y: -60, x: 40, rotate: 8 }} animate={{ opacity: 1, y: 0, x: 0, rotate: 0 }}
      transition={{ type: "spring", damping: 18, stiffness: 220, delay: index * 0.08 }}
      className="relative w-[62px] h-[88px] sm:w-[74px] sm:h-[104px] rounded-lg shrink-0 shadow-[0_8px_18px_rgba(0,0,0,0.5)] -ml-7 first:ml-0"
      style={{ zIndex: index }}>
      {hidden ? (
        <div className="absolute inset-0 rounded-lg border-2 border-white/90 bg-[#0B3D2E] overflow-hidden flex items-center justify-center"
          style={{ backgroundImage: "repeating-linear-gradient(45deg, rgba(16,185,129,0.35) 0 4px, transparent 4px 9px)" }}>
          <div className="w-8 h-8 rounded-md bg-emerald-500 flex items-center justify-center font-display font-black text-black text-xs">AO</div>
        </div>
      ) : (
        <div className={`absolute inset-0 rounded-lg bg-white border border-zinc-300 ${red ? "text-red-600" : "text-zinc-900"}`}>
          <div className="absolute top-1 left-1.5 leading-none text-center">
            <p className="font-display font-black text-base sm:text-lg">{rank}</p>
            <p className="text-sm -mt-0.5">{SUIT[card[1]]}</p>
          </div>
          <p className="absolute inset-0 flex items-center justify-center text-3xl sm:text-4xl">{SUIT[card[1]]}</p>
          <div className="absolute bottom-1 right-1.5 leading-none text-center rotate-180">
            <p className="font-display font-black text-base sm:text-lg">{rank}</p>
            <p className="text-sm -mt-0.5">{SUIT[card[1]]}</p>
          </div>
        </div>
      )}
    </motion.div>
  );
}
