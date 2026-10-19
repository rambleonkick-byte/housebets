import { useState } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { BetSlipProvider } from "@/context/BetSlipContext";
import { Header } from "@/components/Header";
import { AuthModal } from "@/components/AuthModal";
import { WalletModal } from "@/components/WalletModal";
import { BetHistoryModal } from "@/components/BetHistoryModal";
import { Sportsbook } from "@/pages/Sportsbook";
import { Casino } from "@/pages/Casino";
import { Limbo } from "@/pages/games/Limbo";
import { Mines } from "@/pages/games/Mines";
import { Plinko } from "@/pages/games/Plinko";
import { Keno } from "@/pages/games/Keno";
import { Dice } from "@/pages/games/Dice";

function Shell() {
  const { user, setAuthOpen } = useAuth();
  const [walletOpen, setWalletOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const openWallet = () => (user ? setWalletOpen(true) : setAuthOpen(true));
  const openHistory = () => (user ? setHistoryOpen(true) : setAuthOpen(true));

  return (
    <div className="min-h-screen bg-background text-foreground grain">
      <Header onWallet={openWallet} onHistory={openHistory} />
      <div className="pt-16">
        <Routes>
          <Route path="/" element={<Sportsbook />} />
          <Route path="/casino" element={<Casino />} />
          <Route path="/casino/limbo" element={<Limbo />} />
          <Route path="/casino/mines" element={<Mines />} />
          <Route path="/casino/plinko" element={<Plinko />} />
          <Route path="/casino/keno" element={<Keno />} />
          <Route path="/casino/dice" element={<Dice />} />
        </Routes>
      </div>
      <AuthModal />
      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
      <BetHistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <Toaster theme="dark" position="top-center" richColors
        toastOptions={{ style: { background: "#12141C", border: "1px solid #2A2F45", color: "#F4F4F5" } }} />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <BetSlipProvider>
          <Shell />
        </BetSlipProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
