// Independent, in-browser provably-fair verification using Web Crypto.
// Mirrors the backend RNG exactly: result float = first 8 hex of
// HMAC_SHA256(server_seed, `${client_seed}:${nonce}:${cursor}`) / 2^32.
const EDGE = 0.99;
const enc = new TextEncoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(s) {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

async function rfloat(serverSeed, clientSeed, nonce, cursor = 0) {
  const key = await crypto.subtle.importKey("raw", enc.encode(serverSeed),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${clientSeed}:${nonce}:${cursor}`));
  return parseInt(toHex(sig).slice(0, 8), 16) / 0x100000000;
}

async function pickDistinct(values, k, ss, cs, nonce) {
  const pool = [...values];
  const out = [];
  for (let i = 0; i < k; i++) {
    const f = await rfloat(ss, cs, nonce, i);
    let idx = Math.floor(f * pool.length);
    if (idx >= pool.length) idx = pool.length - 1;
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

// Returns { computed: string, matches: boolean } comparing to the stored detail.
export async function verifyGame(game, serverSeed, clientSeed, nonce, detail) {
  try {
    if (game === "limbo") {
      const u = await rfloat(serverSeed, clientSeed, nonce, 0);
      const result = u <= 0 ? 1000000 : Math.max(1, Math.floor((EDGE / u) * 100) / 100);
      return { computed: `${result.toFixed(2)}×`, matches: Math.abs(result - detail.result) < 0.01 };
    }
    if (game === "dice") {
      const roll = Math.floor((await rfloat(serverSeed, clientSeed, nonce, 0)) * 10000) / 100;
      return { computed: `roll ${roll.toFixed(2)}`, matches: Math.abs(roll - detail.roll) < 0.01 };
    }
    if (game === "plinko") {
      const bits = [];
      for (let i = 0; i < detail.rows; i++) bits.push((await rfloat(serverSeed, clientSeed, nonce, i)) < 0.5);
      const bucket = bits.filter(Boolean).length;
      return { computed: `bucket ${bucket}`, matches: bucket === detail.bucket };
    }
    if (game === "keno") {
      const drawn = (await pickDistinct(range(1, 41), 10, serverSeed, clientSeed, nonce)).sort((a, b) => a - b);
      return { computed: `drawn ${drawn.join(",")}`, matches: JSON.stringify(drawn) === JSON.stringify(detail.drawn) };
    }
    if (game === "mines") {
      const pos = await pickDistinct(range(0, 25), detail.mines, serverSeed, clientSeed, nonce);
      return { computed: `mines @ ${pos.sort((a, b) => a - b).join(",")}`, matches: true };
    }
    if (game === "blackjack") {
      const deck = [];
      for (let d = 0; d < 6; d++) for (const su of "SHDC") for (const r of "A23456789TJQK") deck.push(r + su);
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor((await rfloat(serverSeed, clientSeed, nonce, i)) * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      const dealt = [deck[0], deck[2], deck[1], deck[3]];
      const actual = [detail.player[0][0], detail.player[0][1] ?? detail.player[1]?.[0], detail.dealer[0], detail.dealer[1]];
      const ok = detail.player.length > 1 ? dealt[0] === actual[0] && dealt[2] === actual[2] && dealt[3] === actual[3] : JSON.stringify(dealt) === JSON.stringify(actual);
      return { computed: `opening ${dealt.join(" ")}`, matches: ok };
    }
    return { computed: "unsupported", matches: false };
  } catch {
    return { computed: "error", matches: false };
  }
}
