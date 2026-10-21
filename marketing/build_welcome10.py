import requests, io
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BG = "https://static.prod-images.emergentagent.com/jobs/2da7fdf4-e166-4ed4-bfba-3c73b2857ea1/images/61a59cc56825968c5e3f39adc698662854e7e5e83127b84713d9c1411f24870a.jpeg"
S = 1080
G = (16, 185, 129)
ANTON, GROT = "/app/marketing/Anton.ttf", "/app/marketing/SpaceGrotesk.ttf"


def f(p, s, w=700):
    ft = ImageFont.truetype(p, s)
    if p == GROT:
        ft.set_variation_by_axes([w])
    return ft


im = Image.open(io.BytesIO(requests.get(BG, timeout=60).content)).convert("RGB").resize((S, S), Image.LANCZOS)
shade = Image.new("L", (S, S))
sd = ImageDraw.Draw(shade)
for x in range(S):
    sd.line([(x, 0), (x, S)], fill=int(max(0, 1 - x / (S * 0.75)) * 200))
im = Image.composite(Image.new("RGB", (S, S), (5, 7, 12)), im, shade)
bot = Image.new("L", (S, S))
bd = ImageDraw.Draw(bot)
for y in range(S):
    bd.line([(0, y), (S, y)], fill=int(max(0, (y - S * 0.62) / (S * 0.38)) * 235))
im = Image.composite(Image.new("RGB", (S, S), (5, 7, 12)), im, bot)
d = ImageDraw.Draw(im)

# brand mark
d.rounded_rectangle([64, 64, 120, 120], radius=14, fill=G)
d.polygon([(97, 72), (78, 97), (91, 97), (85, 113), (106, 86), (93, 86)], fill=(0, 0, 0))
fb = f(ANTON, 46)
d.text((136, 66), "APEX", font=fb, fill=(255, 255, 255))
d.text((136 + d.textlength("APEX", font=fb) + 8, 66), "ODDS", font=fb, fill=G)

# headline
d.text((64, 190), "NEW PLAYER OFFER", font=f(GROT, 34), fill=G)
fh = f(ANTON, 200)
glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.text((60, 230), "FREE", font=fh, fill=G + (160,))
gd.text((60, 440), "$10 BET", font=fh, fill=G + (160,))
im = Image.alpha_composite(im.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(22))).convert("RGB")
d = ImageDraw.Draw(im)
d.text((60, 230), "FREE", font=fh, fill=(255, 255, 255))
d.text((60, 440), "$10", font=fh, fill=G)
d.text((60 + d.textlength("$10 ", font=fh), 440), "BET", font=fh, fill=(255, 255, 255))

# code box
y = 712
d.text((64, y), "USE CODE", font=f(GROT, 30), fill=(200, 205, 212))
fc = f(ANTON, 92)
code = "WELCOME10"
w = d.textlength(code, font=fc)
d.rounded_rectangle([64, y + 46, 64 + w + 60, y + 166], radius=22, outline=G, width=5, fill=(8, 22, 18))
d.text((94, y + 52), code, font=fc, fill=(255, 255, 255))

# cta
cx = 64 + w + 100
d.rounded_rectangle([cx, y + 56, cx + 290, y + 156], radius=50, fill=G)
fcta = f(GROT, 40)
d.text((cx + (290 - d.textlength("CLAIM NOW", font=fcta)) / 2, y + 80), "CLAIM NOW", font=fcta, fill=(0, 0, 0))

# steps + terms
fs = f(GROT, 28, 500)
d.text((64, 928), "Sign up  ·  Enter code in your profile  ·  Bet on any game", font=fs, fill=(170, 178, 188))
d.text((64, 978), "New players only. One use per player. Free bet stake not returned. 18+. T&Cs apply.", font=f(GROT, 20, 400), fill=(110, 118, 128))
im.save("/app/marketing/welcome10_ad.png", optimize=True)
im.save("/app/frontend/public/brand/welcome10_ad.png", optimize=True)
im.save("/app/backend/assets/welcome10_ad.png", optimize=True)
print("ok")
