import re, os
os.chdir("/app/frontend/src")


def ed(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:60])
        s = s.replace(a, b)
    open(p, "w").write(s)


ed("lib/casinoGames.js", [("export const CASINO_GAMES = [", "export const CASINO_ON = false;\n\nexport const CASINO_GAMES = [")])
ed("components/Sidebar.jsx", [('''      <Link to="/casino" data-testid="sidebar-tab-casino"
        className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-zinc-400 hover:text-white rounded-full py-2 transition-colors">
        <Dices size={14} /> Casino
      </Link>''', '''      {CASINO_ON && <Link to="/casino" data-testid="sidebar-tab-casino"
        className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-zinc-400 hover:text-white rounded-full py-2 transition-colors">
        <Dices size={14} /> Casino
      </Link>}''')])
ed("components/Header.jsx", [('''            <Link to="/casino" data-testid="nav-casino"''', '''            {CASINO_ON && <Link to="/casino" data-testid="nav-casino"'''),
                              ('''              Casino
            </Link>''', '''              Casino
            </Link>}''')])
ed("pages/Sportsbook.jsx", [("        <CasinoStrip />", "        {CASINO_ON && <CasinoStrip />}")])
ed("pages/Profile.jsx", [('sub="Sports + casino"', 'sub={CASINO_ON ? "Sports + casino" : "Sportsbook"}'),
                         ('<div className="grid md:grid-cols-2 gap-6">\n        <Breakdown title="Sportsbook"', '<div className={`grid gap-6 ${CASINO_ON ? "md:grid-cols-2" : ""}`}>\n        <Breakdown title="Sportsbook"'),
                         ('        <Breakdown title="Casino"', '        {CASINO_ON && <Breakdown title="Casino"'),
                         ('["P&L", signed(c.pnl), pnlTone(c.pnl)]]} />', '["P&L", signed(c.pnl), pnlTone(c.pnl)]]} />}')])
ed("components/TicketThread.jsx", [('"Bet", "Casino", "Account"', '"Bet", "Account"')])
ed("components/VipCard.jsx", [("Every $1 on sports = {vip.sports_mult} points · every $1 in the casino = 1 point", "Every $1 on sports = {vip.sports_mult} points")])
ed("App.js", [('import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";', 'import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";\nimport { CASINO_ON } from "@/lib/casinoGames";'),
              ('''          <Route path="/casino" element={<Casino />} />
          <Route path="/casino/limbo" element={<Limbo />} />
          <Route path="/casino/mines" element={<Mines />} />
          <Route path="/casino/plinko" element={<Plinko />} />
          <Route path="/casino/keno" element={<Keno />} />
          <Route path="/casino/dice" element={<Dice />} />
          <Route path="/casino/blackjack" element={<Blackjack />} />''', '''          {CASINO_ON ? <>
            <Route path="/casino" element={<Casino />} />
            <Route path="/casino/limbo" element={<Limbo />} />
            <Route path="/casino/mines" element={<Mines />} />
            <Route path="/casino/plinko" element={<Plinko />} />
            <Route path="/casino/keno" element={<Keno />} />
            <Route path="/casino/dice" element={<Dice />} />
            <Route path="/casino/blackjack" element={<Blackjack />} />
          </> : <Route path="/casino/*" element={<Navigate to="/" replace />} />}''')])
for p in ("components/Sidebar.jsx", "components/Header.jsx", "pages/Sportsbook.jsx", "pages/Profile.jsx"):
    s = open(p).read()
    s = re.sub(r"(^import .*\n)", r'\1import { CASINO_ON } from "@/lib/casinoGames";\n', s, count=1)
    open(p, "w").write(s)
print("ok")
