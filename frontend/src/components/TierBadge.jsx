import { Crown, Gem, Medal, Star, Shield } from "lucide-react";

const FAMILY = {
  Bronze: { color: "#CD7F32", Icon: Medal },
  Silver: { color: "#C9D1D9", Icon: Medal },
  Gold: { color: "#F5C542", Icon: Star },
  Platinum: { color: "#9FD3E6", Icon: Shield },
  Diamond: { color: "#5EEAD4", Icon: Gem },
  Elite: { color: "#C084FC", Icon: Crown },
  Black: { color: "#F4F4F5", Icon: Crown },
};

export const tierStyle = (name = "Bronze") => FAMILY[name.split(" ")[0]] || FAMILY.Bronze;

export function TierBadge({ name, size = "md", testid }) {
  const { color, Icon } = tierStyle(name);
  const big = size === "lg";
  return (
    <span data-testid={testid} className={`inline-flex items-center gap-1.5 rounded-full border font-bold ${big ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[10px]"} ${name?.startsWith("Black") ? "bg-black" : ""}`}
      style={{ color, borderColor: `${color}66`, background: name?.startsWith("Black") ? "#000" : `${color}14` }}>
      <Icon size={big ? 15 : 11} /> {name}
    </span>
  );
}
