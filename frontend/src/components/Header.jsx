import { Zap, Wallet, History, LogOut, User as UserIcon, ShieldCheck } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { usdValue } from "@/lib/format";
import { usePrices } from "@/lib/prices";
import { NotificationBell } from "@/components/NotificationBell";

export function Header({ onWallet, onHistory, onAdmin }) {
  const { user, logout, setAuthOpen } = useAuth();
  const { pathname } = useLocation();
  const { rates } = usePrices();
  const total = user && user.balances ? usdValue(user.balances, rates) : 0;
  const onCasino = pathname.startsWith("/casino");
  const onSports = !onCasino && pathname !== "/affiliate" && pathname !== "/profile" && pathname !== "/admin";

  return (
    <header className="fixed top-0 inset-x-0 z-50 h-16 bg-[#090A0F]/90 backdrop-blur-md border-b border-[#2A2F45]">
      <div className="h-full px-3 sm:px-4 md:px-6 flex items-center justify-between gap-2 sm:gap-4">
        <div className="flex items-center gap-5">
          <Link to="/" className="flex items-center gap-2.5" data-testid="brand-logo">
            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center">
              <Zap size={18} className="text-black" fill="currentColor" />
            </div>
            <div className="leading-none">
              <span className="font-display text-xl font-black tracking-tight">APEX</span>
              <span className="font-display text-xl font-black tracking-tight text-emerald-400">ODDS</span>
            </div>
          </Link>
          <nav className="hidden sm:flex items-center gap-1">
            <Link to="/" data-testid="nav-sports"
              className={`text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${onSports ? "bg-emerald-500/10 text-emerald-300" : "text-zinc-400 hover:text-white"}`}>
              Sports
            </Link>
            <Link to="/casino" data-testid="nav-casino"
              className={`text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${onCasino ? "bg-emerald-500/10 text-emerald-300" : "text-zinc-400 hover:text-white"}`}>
              Casino
            </Link>
            <Link to="/affiliate" data-testid="nav-affiliate"
              className={`text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${pathname === "/affiliate" ? "bg-emerald-500/10 text-emerald-300" : "text-zinc-400 hover:text-white"}`}>
              Affiliate
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 md:gap-3">
          {user ? (
            <>
              {user.role === "admin" && (
                <button data-testid="header-admin-button" onClick={onAdmin}
                  className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20 rounded-lg px-3 py-2 transition-colors">
                  <ShieldCheck size={16} />
                  <span className="hidden sm:inline text-sm font-semibold">Admin</span>
                </button>
              )}
              <button data-testid="header-wallet-button" onClick={onWallet}
                className="flex items-center gap-2 bg-[#12141C] border border-[#2A2F45] hover:border-emerald-500/60 rounded-lg px-3 py-2 transition-colors">
                <Wallet size={16} className="text-emerald-400" />
                <span data-testid="header-usd-balance" className="font-mono text-sm font-semibold">${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </button>
              <NotificationBell />
              <button data-testid="header-history-button" onClick={onHistory}
                className="hidden sm:flex items-center gap-2 text-zinc-300 hover:text-white px-2 py-2 transition-colors">
                <History size={18} />
              </button>
              <Link to="/profile" data-testid="header-profile-link" title="My profile"
                className={`flex items-center gap-2 md:pl-2 md:border-l border-[#2A2F45] hover:text-white ${pathname === "/profile" ? "text-emerald-300" : ""}`}>
                <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <UserIcon size={14} className="text-emerald-400" />
                </div>
                <span className="hidden md:inline text-sm text-zinc-300 max-w-[120px] truncate">{user.name}</span>
              </Link>
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
