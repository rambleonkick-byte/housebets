import { Zap, Wallet, History, LogOut, User as UserIcon } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { usdValue } from "@/lib/format";

export function Header({ onWallet, onHistory }) {
  const { user, logout, setAuthOpen } = useAuth();
  const total = user && user.balances ? usdValue(user.balances) : 0;

  return (
    <header className="fixed top-0 inset-x-0 z-50 h-16 bg-[#090A0F]/90 backdrop-blur-md border-b border-[#2A2F45]">
      <div className="h-full px-4 md:px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5" data-testid="brand-logo">
          <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center">
            <Zap size={18} className="text-black" fill="currentColor" />
          </div>
          <div className="leading-none">
            <span className="font-display text-xl font-black tracking-tight">APEX</span>
            <span className="font-display text-xl font-black tracking-tight text-emerald-400">ODDS</span>
          </div>
          <span className="hidden md:inline-flex ml-2 text-[10px] font-mono uppercase tracking-widest text-zinc-500 border border-[#2A2F45] rounded px-1.5 py-0.5">
            Crypto Sportsbook
          </span>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          {user ? (
            <>
              <button data-testid="header-wallet-button" onClick={onWallet}
                className="flex items-center gap-2 bg-[#12141C] border border-[#2A2F45] hover:border-emerald-500/60 rounded-lg px-3 py-2 transition-colors">
                <Wallet size={16} className="text-emerald-400" />
                <span className="font-mono text-sm font-semibold">${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </button>
              <button data-testid="header-history-button" onClick={onHistory}
                className="hidden sm:flex items-center gap-2 text-zinc-300 hover:text-white px-2 py-2 transition-colors">
                <History size={18} />
              </button>
              <div className="hidden md:flex items-center gap-2 pl-2 border-l border-[#2A2F45]">
                <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <UserIcon size={14} className="text-emerald-400" />
                </div>
                <span className="text-sm text-zinc-300 max-w-[120px] truncate">{user.name}</span>
              </div>
              <button data-testid="header-logout-button" onClick={logout}
                className="text-zinc-400 hover:text-red-400 p-2 transition-colors">
                <LogOut size={18} />
              </button>
            </>
          ) : (
            <button data-testid="header-signin-button" onClick={() => setAuthOpen(true)}
              className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm px-4 py-2 rounded-lg transition-colors">
              Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
