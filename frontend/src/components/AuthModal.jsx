import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mail, Lock, User, Loader2, Gift } from "lucide-react";
import { useAuth, formatApiErrorDetail } from "@/context/AuthContext";
import { toast } from "sonner";

export function AuthModal() {
  const { authOpen, setAuthOpen, login, register } = useAuth();
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ref, setRef] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (mode === "login") await login(email, password);
      else await register(name, email, password, ref.trim());
      toast.success(mode === "login" ? "Welcome back" : "Account created");
      setAuthOpen(false);
      setPassword("");
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {authOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={() => setAuthOpen(false)} data-testid="auth-modal-overlay"
        >
          <motion.div
            className="relative w-full max-w-md bg-[#12141C] border border-[#2A2F45] rounded-xl p-8 overflow-hidden"
            initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute -top-20 -right-20 w-48 h-48 rounded-full bg-emerald-500/10 blur-3xl" />
            <button onClick={() => setAuthOpen(false)} data-testid="auth-modal-close"
              className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors">
              <X size={20} />
            </button>
            <p className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400 mb-1">ApexOdds</p>
            <h2 className="font-display text-3xl font-black tracking-tight mb-1">
              {mode === "login" ? "Sign in" : "Create account"}
            </h2>
            <p className="text-sm text-zinc-400 mb-6">
              {mode === "login" ? "Access your crypto balance & bets." : "Create your account to start betting."}
            </p>

            <form onSubmit={submit} className="space-y-3">
              {mode === "register" && (
                <Field icon={User} testid="auth-name-input" value={name} onChange={setName}
                  placeholder="Display name" />
              )}
              <Field icon={Mail} testid="auth-email-input" type="email" value={email} onChange={setEmail}
                placeholder="Email address" />
              <Field icon={Lock} testid="auth-password-input" type="password" value={password} onChange={setPassword}
                placeholder="Password" />
              {mode === "register" && (
                <Field icon={Gift} testid="auth-ref-input" value={ref} onChange={(v) => setRef(v.toUpperCase())}
                  placeholder="Referral code (optional)" required={false} />
              )}
              {error && <p className="text-sm text-red-400" data-testid="auth-error">{error}</p>}
              <button type="submit" disabled={loading} data-testid="auth-submit-button"
                className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold py-3 rounded-lg transition-colors disabled:opacity-60">
                {loading && <Loader2 size={16} className="animate-spin" />}
                {mode === "login" ? "Sign in" : "Create account"}
              </button>
            </form>

            <p className="text-sm text-zinc-500 mt-5 text-center">
              {mode === "login" ? "New to ApexOdds? " : "Already have an account? "}
              <button data-testid="auth-toggle-mode"
                onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
                className="text-emerald-400 hover:text-emerald-300 font-medium">
                {mode === "login" ? "Create one" : "Sign in"}
              </button>
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({ icon: Icon, testid, type = "text", value, onChange, placeholder, required = true }) {
  return (
    <div className="relative">
      <Icon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
      <input data-testid={testid} type={type} value={value} required={required}
        onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-[#090A0F] border border-[#2A2F45] rounded-lg pl-9 pr-3 py-3 text-sm
          focus:outline-none focus:border-emerald-500 transition-colors placeholder:text-zinc-600" />
    </div>
  );
}
