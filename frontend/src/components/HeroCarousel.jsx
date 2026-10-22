import { useEffect, useMemo, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Zap } from "lucide-react";
import { OddsButton, buildMeta } from "@/components/MatchCard";
import { useAuth } from "@/context/AuthContext";

const IMG = (id) => `https://images.unsplash.com/${id}?crop=entropy&cs=srgb&fm=jpg&w=1600&q=80`;
const BG = {
  welcome: IMG("photo-1679391029864-d46f366a456b"),
  NFL: IMG("photo-1566577739112-5180d4bf9390"),
  NBA: IMG("photo-1546519638-68e109498ffc"),
  UFC: "https://images.pexels.com/photos/28550405/pexels-photo-28550405.jpeg?auto=compress&cs=tinysrgb&w=1600",
  SOCCER: IMG("photo-1676746424139-77f8bd8922a8"),
};
const FEATURED = [
  { key: "NFL", label: "NFL", leagues: ["NFL", "NCAAF"] },
  { key: "NBA", label: "NBA", leagues: ["NBA", "NCAAB"] },
  { key: "UFC", label: "UFC", leagues: ["UFC"] },
  { key: "SOCCER", label: "Football", leagues: ["EPL", "UEFA_CHAMPIONS_LEAGUE", "UEFA_EUROPA_LEAGUE", "LA_LIGA", "BUNDESLIGA", "IT_SERIE_A", "FR_LIGUE_1", "MLS"] },
];
const DURATION = 6500;

function pickEvent(events, leagues) {
  const pool = events.filter((e) => leagues.includes(e.league_key) && e.state !== "post"
    && e.markets?.some((m) => m.market === "moneyline"));
  const rank = (e) => leagues.indexOf(e.league_key);
  return pool.find((e) => e.state === "in") || pool.find((e) => e.main_event)
    || [...pool].sort((a, b) => rank(a) - rank(b) || (a.start || "").localeCompare(b.start || ""))[0];
}

function Countdown({ iso }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const ms = Math.max(0, new Date(iso).getTime() - now);
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4), s = Math.floor((ms % 6e4) / 1e3);
  const parts = d > 0 ? [[d, "D"], [h, "H"], [m, "M"]] : [[h, "H"], [m, "M"], [s, "S"]];
  return (
    <div className="flex gap-1.5" data-testid="hero-countdown">
      {parts.map(([v, u]) => (
        <span key={u} className="bg-black/50 backdrop-blur border border-white/10 rounded-md px-2 py-1 font-mono text-sm font-bold">
          {String(v).padStart(2, "0")}<span className="text-[10px] text-zinc-400 ml-0.5">{u}</span>
        </span>
      ))}
    </div>
  );
}

function Side({ t, ufc, align }) {
  const [err, setErr] = useState(false);
  const img = ufc ? t.photo : t.logo;
  return (
    <div className={`flex flex-col items-center gap-2 min-w-0 ${align}`}>
      <div className={`${ufc ? "w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden bg-black/40 border-2 border-white/15" : "w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-black/40 backdrop-blur border border-white/10 p-3"} flex items-center justify-center`}>
        {img && !err
          ? <img src={img} alt={t.name} onError={() => setErr(true)} className={ufc ? "w-full h-full object-cover object-top" : "w-full h-full object-contain"} />
          : <span className="font-display font-black text-xl">{t.abbr || t.name?.slice(0, 3)}</span>}
      </div>
      <p className="font-display font-black text-sm sm:text-lg leading-tight text-center line-clamp-2 max-w-[9rem]">{t.name}</p>
      {t.record && <span className="text-[10px] font-mono text-zinc-400">{t.record}</span>}
    </div>
  );
}

function MatchSlide({ ev, label }) {
  const live = ev.state === "in";
  const ufc = ev.league_key === "UFC";
  const ml = ev.markets.find((m) => m.market === "moneyline");
  const meta = buildMeta(ev);
  return (
    <div className="relative h-full flex flex-col justify-between px-5 sm:px-8 pt-6 pb-9" data-testid={`hero-slide-match-${ev.event_id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 whitespace-nowrap text-[10px] font-mono font-bold uppercase tracking-[0.2em] bg-emerald-500 text-black rounded px-2 py-0.5">Featured {label}</span>
          <span className="hidden sm:inline text-[11px] font-mono text-zinc-300 truncate">{ev.card_name || ev.league_label}</span>
        </div>
        {live
          ? <span className="flex items-center gap-1.5 text-[11px] font-mono font-bold text-red-400 bg-red-500/15 border border-red-500/40 rounded px-2 py-0.5"><span className="live-dot w-1.5 h-1.5 rounded-full bg-red-500" /> LIVE · {ev.status_detail}</span>
          : <Countdown iso={ev.start} />}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-6 my-3">
        <Side t={ev.away} ufc={ufc} align="justify-self-end" />
        <div className="text-center">
          {live && ev.away.score != null
            ? <p className="font-mono text-3xl sm:text-4xl font-black" data-testid="hero-live-score">{ev.away.score}<span className="text-zinc-500 mx-2">:</span>{ev.home.score}</p>
            : <p className="font-display text-3xl sm:text-5xl font-black italic text-emerald-400 drop-shadow-[0_0_18px_rgba(16,185,129,0.6)]">VS</p>}
        </div>
        <Side t={ev.home} ufc={ufc} align="justify-self-start" />
      </div>
      {ml && (
        <div className={`grid gap-2 max-w-md mx-auto w-full ${ml.selections.length === 3 ? "grid-cols-3" : "grid-cols-2"} [&>button:not(.bg-emerald-500)]:bg-black/50 [&>button]:backdrop-blur`} data-testid="hero-odds">
          {[...ml.selections].sort((a, b) => ["away", "draw", "home"].indexOf(a.side) - ["away", "draw", "home"].indexOf(b.side)).map((s) => <OddsButton key={s.side} sel={{ ...s, market: "moneyline" }} meta={meta} />)}
        </div>
      )}
    </div>
  );
}

function WelcomeSlide({ live, markets }) {
  const { user, setAuthOpen } = useAuth();
  return (
    <div className="relative h-full flex flex-col justify-center px-5 sm:px-8 pt-6 pb-10" data-testid="hero-slide-welcome">
      <p className="text-xs font-mono uppercase tracking-[0.25em] text-emerald-400 mb-3 flex items-center gap-2"><Zap size={12} fill="currentColor" /> ApexOdds Sportsbook</p>
      <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] uppercase max-w-xl">
        Under the lights.<br /><span className="text-emerald-400 drop-shadow-[0_0_24px_rgba(16,185,129,0.55)]">On the line.</span>
      </h1>
      <p className="text-sm sm:text-base text-zinc-300 mt-4 max-w-md">Live odds on NFL, NBA, UFC and football. Play in USD. Deposit with BTC, ETH, SOL or USDT and get paid fast.</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-5 sm:mt-6">
        {!user && (
          <button data-testid="hero-cta-signup" onClick={() => setAuthOpen(true)}
            className="bg-emerald-500 hover:bg-emerald-400 text-black font-bold px-6 py-3 rounded-full shadow-[0_0_30px_-5px_rgba(16,185,129,0.7)] transition-colors active:scale-95">
            Join now
          </button>
        )}
        <span className="flex items-center gap-2 font-mono text-sm"><span className="live-dot w-2 h-2 rounded-full bg-red-500" /><b>{live}</b><span className="text-zinc-400">live now</span></span>
        <span className="font-mono text-sm"><b>{markets}</b> <span className="text-zinc-400">markets</span></span>
      </div>
    </div>
  );
}

export function HeroCarousel({ events, liveCount }) {
  const slides = useMemo(() => [{ id: "welcome", bg: BG.welcome },
    ...FEATURED.map((f) => ({ id: f.key, bg: BG[f.key], label: f.label, ev: pickEvent(events, f.leagues) })).filter((s) => s.ev)], [events]);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = slides.length;
  const go = useCallback((d) => setIdx((i) => (i + d + n) % n), [n]);
  useEffect(() => { if (idx >= n) setIdx(0); }, [n, idx]);
  useEffect(() => {
    if (paused || n < 2) return;
    const t = setTimeout(() => go(1), DURATION);
    return () => clearTimeout(t);
  }, [idx, paused, n, go]);
  const s = slides[Math.min(idx, n - 1)];
  const [touchX, setTouchX] = useState(null);
  const onTouchEnd = (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    setTouchX(null);
  };

  return (
    <div data-testid="hero-carousel" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => setTouchX(e.touches[0].clientX)} onTouchEnd={onTouchEnd}
      className="relative m-4 mb-0 h-[340px] sm:h-[360px] rounded-2xl overflow-hidden border border-[#2A2F45] bg-[#090A0F] shadow-[0_20px_60px_-25px_rgba(16,185,129,0.35)]">
      <AnimatePresence mode="sync">
        <motion.div key={s.id} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.7 }}>
          <img src={s.bg} alt="" className="absolute inset-0 w-full h-full object-cover hero-kenburns" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#090A0F] via-[#090A0F]/70 to-[#090A0F]/30" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#090A0F]/90 via-transparent to-[#090A0F]/60" />
          <div className="absolute -top-24 left-1/4 w-96 h-48 bg-emerald-400/20 blur-3xl rounded-full" />
          <motion.div className="relative h-full" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15, duration: 0.5 }}>
            {s.ev ? <MatchSlide ev={s.ev} label={s.label} /> : <WelcomeSlide live={liveCount} markets={events.length} />}
          </motion.div>
        </motion.div>
      </AnimatePresence>

      {n > 1 && (
        <>
          <button data-testid="hero-carousel-prev" onClick={() => go(-1)} aria-label="Previous"
            className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 backdrop-blur border border-white/10 hidden sm:flex items-center justify-center hover:bg-emerald-500 hover:text-black transition-colors"><ChevronLeft size={18} /></button>
          <button data-testid="hero-carousel-next" onClick={() => go(1)} aria-label="Next"
            className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 backdrop-blur border border-white/10 hidden sm:flex items-center justify-center hover:bg-emerald-500 hover:text-black transition-colors"><ChevronRight size={18} /></button>
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex">
            {slides.map((sl, i) => (
              <button key={sl.id} data-testid={`hero-dot-${sl.id}`} onClick={() => setIdx(i)} aria-label={`Slide ${i + 1}`}
                className="px-1 py-2.5">
                <span className="relative block h-1 w-8 rounded-full bg-white/20 overflow-hidden">
                {i === idx && <span key={`${idx}-${paused}`} className={`absolute inset-y-0 left-0 bg-emerald-400 ${paused ? "w-full" : "hero-progress"}`} style={{ animationDuration: `${DURATION}ms` }} />}
                {i < idx && <span className="absolute inset-0 bg-white/50" />}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
