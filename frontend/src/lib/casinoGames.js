const IMG = {
  dice: "https://static.prod-images.emergentagent.com/jobs/2da7fdf4-e166-4ed4-bfba-3c73b2857ea1/images/f3c326bfd05f53c0df708c50f72f061b4afec3005519def4bec1c1652ba4e538.jpeg",
  limbo: "https://static.prod-images.emergentagent.com/jobs/2da7fdf4-e166-4ed4-bfba-3c73b2857ea1/images/e7b233f7c8557abf539a6058c2116c70220679c899cd23d30a31f6db8e235ce6.jpeg",
  mines: "https://static.prod-images.emergentagent.com/jobs/2da7fdf4-e166-4ed4-bfba-3c73b2857ea1/images/6527004b5961b064bdc98a19dc5fa1334e98c8d1701e6ace0c628550eaa035af.jpeg",
  keno: "https://static.prod-images.emergentagent.com/jobs/2da7fdf4-e166-4ed4-bfba-3c73b2857ea1/images/6e4275f3951a149f90d0e9567316f9892c06ea610b78df39e7368c9fb3294458.jpeg",
  plinko: "https://static.prod-images.emergentagent.com/jobs/2da7fdf4-e166-4ed4-bfba-3c73b2857ea1/images/a43942ca9067eb8c634da549048154c3316f0a9b210407d806eb14f15fe1e04f.jpeg",
  blackjack: "https://static.prod-images.emergentagent.com/jobs/2da7fdf4-e166-4ed4-bfba-3c73b2857ea1/images/a390492b2a188b9e0aaf7ef855abda3b3940d03cdc262f4f0d8e2541306b4c37.jpeg",
  crash: "https://static.prod-images.emergentagent.com/jobs/2da7fdf4-e166-4ed4-bfba-3c73b2857ea1/images/dbc86b8d5787e13a830cbd583f67b0a13fd61d703af6bc195a5b33c56869b92d.jpeg",
};

export const CASINO_ON = false;

export const CASINO_GAMES = [
  { key: "dice", name: "Dice", to: "/casino/dice", img: IMG.dice, accent: "#3B82F6" },
  { key: "limbo", name: "Limbo", to: "/casino/limbo", img: IMG.limbo, accent: "#2DD4BF" },
  { key: "mines", name: "Mines", to: "/casino/mines", img: IMG.mines, accent: "#F59E0B" },
  { key: "keno", name: "Keno", to: "/casino/keno", img: IMG.keno, accent: "#22C55E" },
  { key: "plinko", name: "Plinko", to: "/casino/plinko", img: IMG.plinko, accent: "#67E8F9" },
  { key: "blackjack", name: "Blackjack", to: "/casino/blackjack", img: IMG.blackjack, accent: "#22D3EE" },
  { key: "crash", name: "Crash", to: null, img: IMG.crash, accent: "#F97316", soon: true },
];
