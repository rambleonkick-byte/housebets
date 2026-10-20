import { useState, useCallback, useEffect } from "react";
import { Zap, Hand, Plus, Square, Split, ShieldCheck } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { BetControls, useGameBase, GameLayout, PlayButton, FieldLabel } from "@/components/casino/GameKit";
import { PlayingCard } from "@/components/casino/PlayingCard";
import { fmtCrypto } from "@/lib/format";
import { sfx } from "@/lib/sfx";
import { toast } from "sonner";

const SIDES = [
  { key: "side_pp", res: "pp", label: "Perfect Pairs", pays: "Up to 25:1" },
  { key: "side_213", res: "t213", label: "21+3", pays: "Up to 100:1" },
  { key: "side_bust", res: "bust", label: "Bust It", pays: "Up to 250:1" },
];
const RESULT_TONE = { win: "bg-emerald-500 text-black", blackjack: "bg-amber-400 text-black", push: "bg-slate-300 text-black", lose: "bg-red-500 text-white", bust: "bg-red-500 text-white" };
const label = (s) => s?.replace(/_/g, " ");

function HandView({ cards, value, soft, title, active, result, bet, coin, testId }) {
  return (
    <div data-testid={testId} className={`flex flex-col items-center gap-2 transition-opacity ${active === false ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-200/70">{title}</span>
        {cards.length > 0 && (
          <span data-testid={`${testId}-value`} className="font-mono text-xs font-bold bg-black/50 border border-white/10 text-white rounded-full px-2 py-0.5">
            {soft && value < 21 ? `${value - 10}/${value}` : value}
          </span>
        )}
      </div>
      <div className={`flex min-h-[104px] rounded-xl p-1 ${active ? "ring-2 ring-amber-300/70 shadow-[0_0_24px_rgba(252,211,77,0.35)]" : ""}`}>
        {cards.map((c, i) => <PlayingCard key={`${i}-${c}`} card={c} index={i} testId={`${testId}-card-${i}`} />)}
      </div>
      {(result || bet != null) && (
        <div className="flex items-center gap-1.5 h-5">
          {bet != null && <span className="font-mono text-[10px] text-emerald-100/70">{fmtCrypto(bet, coin)} {coin}</span>}
          {result && <span data-testid={`${testId}-result`} className={`text-[10px] font-black uppercase tracking-wider rounded-full px-2 py-0.5 ${RESULT_TONE[result]}`}>{result}</span>}
        </div>
      )}
    </div>
  );
}

function Felt({ game, coin }) {
  return (
    <div className="flex-1 relative rounded-[28px] overflow-hidden border-[6px] border-[#3A2614] shadow-[inset_0_0_80px_rgba(0,0,0,0.6),0_0_0_2px_#1A1008]"
      style={{ background: "radial-gradient(ellipse at 50% 35%, #12704F 0%, #0B5139 45%, #06301F 100%)" }}>
      <div className="absolute inset-0 opacity-[0.07] pointer-events-none" style={{ backgroundImage: "radial-gradient(#fff 1px, transparent 1px)", backgroundSize: "4px 4px" }} />
      <div className="relative h-full min-h-[500px] flex flex-col justify-between p-5">
        <div className="flex justify-center">
          <HandView testId="bj-dealer" title="Dealer" cards={game?.dealer || []} value={game?.dealer_value} />
        </div>
        <div className="flex flex-col items-center pointer-events-none select-none my-3" data-testid="bj-table-logo">
          <div className="flex items-center gap-2 opacity-30">
            <div className="w-9 h-9 rounded-xl border-2 border-emerald-100 flex items-center justify-center"><Zap size={18} className="text-emerald-100" fill="currentColor" /></div>
            <span className="font-display text-3xl font-black tracking-tight text-emerald-50">APEX<span className="text-emerald-300">ODDS</span></span>
          </div>
          <p className="mt-2 text-[10px] sm:text-xs font-bold uppercase tracking-[0.3em] text-amber-200/50">Blackjack pays 3 to 2</p>
          <p className="text-[9px] sm:text-[10px] uppercase tracking-[0.25em] text-emerald-100/35">Dealer stands on all 17s · Insurance pays 2 to 1</p>
        </div>
        <div className="flex justify-center gap-6 flex-wrap">
          {(game?.hands || [{ cards: [] }]).map((h, i) => (
            <HandView key={i} testId={`bj-hand-${i}`} title={game?.hands?.length > 1 ? `Hand ${i + 1}` : "You"} cards={h.cards} value={h.value} soft={h.soft}
              active={game && game.status === "active" && game.hands.length > 1 ? i === game.active : undefined}
              result={h.result} bet={game ? h.bet : null} coin={coin} />
          ))}
        </div>
        {game && (
          <div className="flex justify-center gap-2 flex-wrap" data-testid="bj-side-results">
            {SIDES.filter((s) => game.sides[s.res].bet > 0).map((s) => {
              const r = game.sides[s.res];
              const settled = s.res !== "bust" || game.status === "done";
              return (
                <span key={s.res} data-testid={`bj-side-${s.res}`}
                  className={`text-[10px] font-semibold rounded-full px-2.5 py-1 border ${r.result ? "bg-amber-400/20 border-amber-300 text-amber-100" : "bg-black/30 border-white/10 text-emerald-100/60"}`}>
                  {s.label}: {r.result ? `${label(r.result)} · +${fmtCrypto(r.payout, coin)}` : settled ? "no win" : "pending"}
                </span>
              );
            })}
            {game.insurance?.bet > 0 && (
              <span data-testid="bj-side-insurance" className={`text-[10px] font-semibold rounded-full px-2.5 py-1 border ${game.insurance.payout > 0 ? "bg-amber-400/20 border-amber-300 text-amber-100" : "bg-black/30 border-white/10 text-emerald-100/60"}`}>
                Insurance: {game.status !== "done" ? "taken" : game.insurance.payout > 0 ? `+${fmtCrypto(game.insurance.payout, coin)}` : "no win"}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const ACTIONS = [
  { a: "hit", label: "Hit", Icon: Plus }, { a: "stand", label: "Stand", Icon: Square },
  { a: "double", label: "Double", Icon: Hand }, { a: "split", label: "Split", Icon: Split },
];

export function Blackjack() {
  const g = useGameBase();
  const [sides, setSides] = useState({ side_pp: "", side_213: "", side_bust: "" });
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(false);
  const [win, setWin] = useState(null);
  const closeWin = useCallback(() => setWin(null), []);
  const inPlay = game && game.status !== "done";

  useEffect(() => {
    if (!g.user) return;
    api.get("/casino/blackjack/current").then(({ data }) => {
      if (!data.game) return;
      setGame(data.game); g.setCoin(data.game.coin); g.setStake(String(data.game.hands[0].bet));
    }).catch(() => {});
  }, [g.user]);

  const apply = (data) => {
    setGame(data);
    if (data.balances) g.setBalances(data.balances);
    if (data.status === "done") {
      const net = data.total_payout - data.total_stake;
      if (net > 0) setWin({ multiplier: data.total_payout / data.total_stake, payout: data.total_payout, coin: data.coin });
      else if (net < 0) sfx.lose();
    }
  };

  const deal = async () => {
    setWin(null);
    if (!g.user) return g.setAuthOpen(true);
    if (g.stakeNum <= 0) return toast.error("Enter a bet amount");
    const body = { coin: g.coin, stake: g.stakeNum };
    SIDES.forEach((s) => { body[s.key] = parseFloat(sides[s.key]) || 0; });
    setLoading(true);
    try {
      const { data } = await api.post("/casino/blackjack/deal", body);
      [0, 1, 2, 3].forEach((i) => setTimeout(sfx.draw, i * 90));
      apply(data);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally { setLoading(false); }
  };

  const act = async (action) => {
    setLoading(true);
    try {
      const { data } = await api.post("/casino/blackjack/action", { game_id: game.game_id, action });
      if (action !== "stand" && action !== "no_insurance") sfx.draw();
      apply(data);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally { setLoading(false); }
  };

  const can = (a) => game?.actions?.includes(a);
  const sideTotal = SIDES.reduce((t, s) => t + (parseFloat(sides[s.key]) || 0), 0);

  return (
    <GameLayout title="Blackjack" tag="beat the dealer" win={win} onWinClose={closeWin}
      controls={
        <BetControls {...g} disabled={inPlay || loading}>
          <div>
            <FieldLabel>Side bets</FieldLabel>
            <div className="space-y-1.5">
              {SIDES.map((s) => (
                <div key={s.key} className="flex items-center gap-2 bg-[#090A0F] border border-[#2A2F45] rounded-xl pl-3 pr-1 py-1">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white">{s.label}</p>
                    <p className="text-[10px] text-amber-300/80">{s.pays}</p>
                  </div>
                  <input data-testid={`bj-${s.key}`} type="number" min="0" placeholder="0" value={sides[s.key]} disabled={inPlay || loading}
                    onChange={(e) => setSides((x) => ({ ...x, [s.key]: e.target.value }))}
                    className="w-24 bg-[#12141C] border border-[#2A2F45] rounded-lg px-2 py-1.5 font-mono text-xs text-right text-white outline-none focus:border-amber-400 disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] font-mono text-slate-500" data-testid="bj-total-bet">Total bet {fmtCrypto(g.stakeNum + sideTotal, g.coin)} {g.coin}</p>
          </div>
          {game?.status === "insurance" ? (
            <div className="space-y-2" data-testid="bj-insurance-prompt">
              <p className="flex items-center gap-1.5 text-xs text-amber-200"><ShieldCheck size={14} /> Dealer shows an Ace — take insurance for {fmtCrypto(game.hands[0].bet / 2, g.coin)} {g.coin}?</p>
              <div className="grid grid-cols-2 gap-2">
                <PlayButton data-testid="bj-insurance-yes" tone="amber" loading={loading} onClick={() => act("insurance")}>Insure</PlayButton>
                <PlayButton data-testid="bj-insurance-no" loading={loading} onClick={() => act("no_insurance")}>No thanks</PlayButton>
              </div>
            </div>
          ) : inPlay ? (
            <div className="grid grid-cols-2 gap-2">
              {ACTIONS.map(({ a, label: l, Icon }) => (
                <button key={a} data-testid={`bj-action-${a}`} disabled={!can(a) || loading} onClick={() => act(a)}
                  className="flex items-center justify-center gap-1.5 py-3 rounded-xl font-display font-black text-sm uppercase tracking-wider bg-gradient-to-b from-[#2D3346] to-[#1C2030] text-white border-t border-white/10 shadow-[0_4px_0_#0B0D14] active:translate-y-1 active:shadow-none disabled:opacity-30 transition-[transform,box-shadow]">
                  <Icon size={14} /> {l}
                </button>
              ))}
            </div>
          ) : (
            <PlayButton data-testid="bj-deal-button" onClick={deal} loading={loading}>Deal</PlayButton>
          )}
        </BetControls>
      }>
      <Felt game={game} coin={game?.coin || g.coin} />
    </GameLayout>
  );
}
