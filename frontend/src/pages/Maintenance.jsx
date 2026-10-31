import { Zap, CreditCard, MonitorPlay, Clock } from "lucide-react";

const ITEMS = [
  { Icon: CreditCard, title: "Upgrading our payment systems", text: "Faster, smoother crypto deposits and withdrawals." },
  { Icon: MonitorPlay, title: "Integrating Sportradar live streams", text: "Watch the action live, right next to your bets." },
];

export default function Maintenance() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#07080C] text-zinc-100 flex items-center" data-testid="maintenance-page">
      <div className="pointer-events-none absolute -top-40 -left-40 w-[560px] h-[560px] rounded-full bg-emerald-500/15 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-0 right-0 w-[420px] h-[420px] rounded-full bg-emerald-400/10 blur-[120px]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{ backgroundImage: "linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)", backgroundSize: "48px 48px" }} />

      <main className="relative w-full max-w-5xl mx-auto px-6 sm:px-10 py-16">
        <div className="flex items-center gap-3 mb-16 animate-in fade-in slide-in-from-top-2 duration-700">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 grid place-items-center shadow-[0_0_30px_rgba(16,185,129,0.45)]">
            <Zap size={20} className="text-black" fill="currentColor" />
          </div>
          <span className="font-display text-2xl font-black tracking-tight">APEX<span className="text-emerald-400">ODDS</span></span>
        </div>

        <p className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-[0.2em] text-emerald-300 border border-emerald-500/30 bg-emerald-500/10 rounded-full px-3 py-1.5 mb-6"
          data-testid="maintenance-badge">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Scheduled maintenance
        </p>
        <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-black leading-[1.05] max-w-3xl animate-in fade-in slide-in-from-bottom-3 duration-700"
          data-testid="maintenance-title">
          We're levelling up.<br /><span className="text-emerald-400">Back soon.</span>
        </h1>
        <p className="mt-6 text-base md:text-lg text-zinc-400 max-w-2xl" data-testid="maintenance-message">
          We are upgrading our payment systems and integrating Sportradar live streams to the platform.
        </p>

        <div className="mt-12 grid sm:grid-cols-2 gap-4 max-w-3xl">
          {ITEMS.map(({ Icon, title, text }, i) => (
            <div key={title} style={{ animationDelay: `${150 + i * 120}ms` }}
              className="animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-2xl p-5 hover:border-emerald-500/40 transition-colors">
              <Icon size={22} className="text-emerald-400 mb-3" />
              <p className="font-bold">{title}</p>
              <p className="text-sm text-zinc-500 mt-1">{text}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 max-w-3xl flex flex-wrap items-center gap-4 border-t border-white/10 pt-8">
          <div className="flex items-center gap-3" data-testid="maintenance-eta">
            <Clock size={20} className="text-emerald-400" />
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-zinc-500">Expected downtime</p>
              <p className="font-display text-xl font-bold">12–24 hours</p>
            </div>
          </div>
          <div className="h-1.5 flex-1 min-w-[160px] rounded-full bg-white/5 overflow-hidden">
            <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 animate-[maint_2.4s_ease-in-out_infinite]" />
          </div>
        </div>

        <p className="mt-10 text-zinc-300" data-testid="maintenance-thanks">Thank you for your patience. Your balance and open bets are safe.</p>
      </main>
      <style>{`@keyframes maint{0%{transform:translateX(-110%)}100%{transform:translateX(320%)}}`}</style>
    </div>
  );
}
