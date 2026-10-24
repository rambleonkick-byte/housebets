import asyncio, sys, server
EMAIL = "dhensley727@icloud.com"


async def uid():
    u = await server.db.users.find_one({"email": EMAIL})
    return u.get("id") or str(u["_id"])


async def bal():
    return (await server.db.wallets.find_one({"user_id": await uid()}))["balances"]["USD"]


async def main(step):
    if step == "seed":
        await server.db.withdrawals.insert_one({"id": "test-reopen-1", "user_id": await uid(), "user_email": EMAIL, "coin": "USDT",
                                                "amount": 5, "amount_usd": 5.0, "network": "TRC20", "address": "Txxx",
                                                "status": "failed", "refunded": True, "track_id": "oldtrack123",
                                                "created_at": server.now_iso()})
    if step == "clean":
        await server.db.withdrawals.delete_one({"id": "test-reopen-1"})
        await server.db.transactions.delete_many({"hash": {"$in": ["withdraw-reopen:test-reopen-1", "withdraw-refund:test-reopen-1"]}})
    print(step, "balance", await bal())

asyncio.run(main(sys.argv[1]))
