import re, os, glob
from PIL import Image, ImageDraw, ImageFont

FE = "/app/frontend"
# 1. transparent, upscaled logo
src = Image.open(f"{FE}/public/brand/housebets_logo_src.png").convert("RGB")
bg = src.getpixel((3, 3))
W, H = src.size
out = Image.new("RGBA", (W, H))
for y in range(H):
    for x in range(W):
        p = src.getpixel((x, y))
        d = max(abs(p[i] - bg[i]) for i in range(3))
        a = 0 if d < 18 else min(255, int((d - 18) * 255 / 50))
        out.putpixel((x, y), p + (a,))
bbox = out.getbbox()
out = out.crop(bbox).resize(((bbox[2] - bbox[0]) * 3, (bbox[3] - bbox[1]) * 3), Image.LANCZOS)
out.save(f"{FE}/public/brand/housebets-logo.png")
print("logo", out.size)

# 2. og image
og = Image.new("RGB", (1200, 630), (7, 16, 36))
d = ImageDraw.Draw(og)
for r in range(380, 0, -4):
    a = int(40 * (1 - r / 380))
    d.ellipse([200 - r, 120 - r, 200 + r, 120 + r], fill=(7 + a // 3, 16 + a, 36 + a * 2))
lg = out.resize((int(out.width * 2.2 / 3 * 1.0), int(out.height * 2.2 / 3)), Image.LANCZOS)
og.paste(lg, ((1200 - lg.width) // 2, 200), lg)
f = ImageFont.truetype("/app/marketing/SpaceGrotesk.ttf", 40)
f.set_variation_by_axes([600])
t = "Crypto sportsbook · Play in USD · Fast payouts"
d.text(((1200 - d.textlength(t, font=f)) / 2, 420), t, font=f, fill=(165, 243, 252))
og.save(f"{FE}/public/brand/og-image.png")

# 3. colour + text replacements across src
HEX = {"#090A0F": "#071024", "#12141C": "#0C1A36", "#2A2F45": "#1D3157", "#1E2234": "#162848", "#232838": "#1A2D50",
       "#0E1017": "#0A1530", "#1A1D28": "#132543", "#0B0D14": "#08122A", "#262A38": "#1B2F55", "#151823": "#10203E",
       "#0D0F16": "#09142D", "#070810": "#050C1D", "#252A3B": "#1B2E52", "#1C2030": "#14274A", "#1A1D29": "#132544",
       "#0B0D13": "#08122A", "#2D3346": "#22385F", "#262B3D": "#1C3054", "#222636": "#182B4C", "#1A1D2A": "#132545",
       "#161924": "#11213F", "#07080C": "#050C1D", "#10B981": "#22D3EE", "#34D399": "#67E8F9"}
TEXT = [("ApexOdds Originals", "Housebets Originals"), ("ApexOdds Sportsbook", "Housebets Sportsbook"), ("ApexOdds", "Housebets"),
        ("apexodds-slip-", "housebets-slip-"), ("apexodds-bet-", "housebets-bet-"),
        ('{g.soon ? "Soon" : "Apex"}', '{g.soon ? "Soon" : "House"}'),
        ("rgba(16,185,129,", "rgba(34,211,238,"), ("rgba(16, 185, 129,", "rgba(34, 211, 238,")]
for p in glob.glob(f"{FE}/src/**/*.js*", recursive=True) + glob.glob(f"{FE}/src/**/*.css", recursive=True):
    s = o = open(p).read()
    for a, b in HEX.items():
        s = re.sub(re.escape(a), b, s, flags=re.I)
    for a, b in TEXT:
        s = s.replace(a, b)
    if s != o:
        open(p, "w").write(s)
c = open(f"{FE}/src/pages/Casino.jsx").read()
open(f"{FE}/src/pages/Casino.jsx", "w").write(c.replace("\n              Apex\n", "\n              House\n"))

# 4. emerald -> cyan palette, navy theme vars
css = open(f"{FE}/src/index.css").read()
CYAN = {"50": "#ecfeff", "100": "#cffafe", "200": "#a5f3fc", "300": "#67e8f9", "400": "#22d3ee", "500": "#06b6d4",
        "600": "#0891b2", "700": "#0e7490", "800": "#155e75", "900": "#164e63", "950": "#083344"}
theme = "@theme {\n" + "".join(f"  --color-emerald-{k}: {v};\n" for k, v in CYAN.items()) + "}\n\n"
if "--color-emerald-400" not in css:
    css = css.replace("@theme inline {", theme + "@theme inline {", 1)
for a, b in (("--background: 230 30% 4%;", "--background: 222 68% 8%;"), ("--card: 230 24% 9%;", "--card: 220 64% 13%;"),
             ("--popover: 230 28% 7%;", "--popover: 221 66% 10%;"), ("--primary: 160 84% 39%;", "--primary: 188 86% 53%;"),
             ("--primary-foreground: 230 30% 4%;", "--primary-foreground: 222 68% 8%;"), ("--secondary: 231 20% 14%;", "--secondary: 219 52% 17%;"),
             ("--muted: 231 18% 14%;", "--muted: 219 48% 17%;"), ("--accent: 231 22% 16%;", "--accent: 219 52% 19%;"),
             ("--border: 231 22% 18%;", "--border: 218 50% 23%;"), ("--input: 231 22% 16%;", "--input: 219 52% 19%;"),
             ("--ring: 160 84% 39%;", "--ring: 188 86% 53%;")):
    css = css.replace(a, b)
open(f"{FE}/src/index.css", "w").write(css)
print("done")
