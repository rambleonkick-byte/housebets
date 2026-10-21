# Unit probe: _apply_deposit_match + free-bet settlement (win=winnings only, void restores token, loss no lossback)
import asyncio
import sys
import uuid
sys.path.insert(0, "/app/backend")
import server as S  # noqa


async def main():
    db = S.db
    uid = f"TEST_probe_{uuid.uuid4().hex[:8]}"
    ok = True
    try:
        await S.ensure_wallet(uid)
        await S._rewards_doc(uid)
        await db.rewards.update_one({"user_id": uid}, {"$set": {"pending_match": {"code": "TPROBE", "pct": 100, "max_bonus": 50, "wager_mult": 2}}})
        await S._apply_deposit_match(uid, 80)
        bal = (await S._balances(uid))["USD"]
        rw = await db.rewards.find_one({"user_id": uid})
        print("deposit match bal", bal, "target", rw["wager_target"], "pending", rw.get("pending_match"))
        ok &= bal == 50 and rw["wager_target"] == 100 and rw.get("pending_match") is None
        await S._apply_deposit_match(uid, 80)
        ok &= (await S._balances(uid))["USD"] == 50
        print("second apply no-op:", (await S._balances(uid))["USD"] == 50)

        sel = {"event_id": "TEST_EV", "league": "x", "league_label": "x", "home": "A", "away": "B",
               "market": "moneyline", "pick": "A ML", "side": "home", "line": None, "odds": 3.0}
        mk = lambda fid: {"id": str(uuid.uuid4()), "user_id": uid, "selections": [sel], "bet_type": "single", "stake": 10.0,
                          "coin": "USD", "total_odds": 3.0, "potential_payout": 30.0, "status": "open", "free_bet": True,
                          "free_bet_id": fid, "created_at": S.now_iso()}
        S._accrue_player = lambda *_a, **_k: asyncio.sleep(0)
        for scenario in ("win", "loss", "void"):
            fid = str(uuid.uuid4())
            await db.free_bets.insert_one({"id": fid, "user_id": uid, "amount": 10, "status": "used", "code": "TPROBE", "created_at": S.now_iso()})
            b = mk(fid)
            await db.bets.insert_one(dict(b))

            async def fake_results(_ids, sc=scenario):
                return {"TEST_EV": {"cancelled": sc == "void", "state": "post"}}
            S._fetch_sgo_results = fake_results
            S.settle_selection = lambda s, ev, sc=scenario: sc == "win"
            before = (await S._balances(uid))["USD"]
            await S._settle_bets([b])
            after = (await S._balances(uid))["USD"]
            fb = await db.free_bets.find_one({"id": fid})
            bet = await db.bets.find_one({"id": b["id"]})
            print(scenario, "status", bet["status"], "delta", round(after - before, 2), "lossback", bet.get("lossback"), "token", fb["status"])
            if scenario == "win":
                ok &= round(after - before, 2) == 20 and bet["status"] == "won"
            elif scenario == "loss":
                ok &= after == before and not bet.get("lossback")
            else:
                ok &= after == before and fb["status"] == "available" and bet["status"] == "void"
    finally:
        for c in ("wallets", "rewards", "transactions", "bets", "free_bets"):
            await db[c].delete_many({"user_id": uid})
    print("ALL OK" if ok else "FAILURES")


asyncio.run(main())
