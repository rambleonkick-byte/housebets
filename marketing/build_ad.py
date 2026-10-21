import subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
D = "/app/marketing/ad"
S, FPS, CL, XF = 1080, 24, 5.0, 0.4
GREEN = (16, 185, 129)
ANTON = "/app/marketing/Anton.ttf"
GROT = "/app/marketing/SpaceGrotesk.ttf"
CLIPS = ["c1_stadium", "c2_dunk", "c3_phone", "c4_crypto", "c5_goal"]
TITLES = [
    ("INTRODUCING", "APEX ODDS", "THE GAME JUST CHANGED"),
    ("SPORTSBOOK", "LIVE ODDS", "EVERY GAME. EVERY MOMENT."),
    ("GO DEEPER", "PLAYER PROPS", "ON EVERY STAR. EVERY STAT."),
    ("BTC · ETH · USDT · SOL", "INSTANT DEPOSITS", "CRYPTO IN. PLAY IN USD."),
    ("LOSSBACK", "10% BACK", "ON EVERY LOSING SPORTS BET"),
]


def font(path, size):
    f = ImageFont.truetype(path, size)
    if path == GROT:
        try:
            f.set_variation_by_axes([700])
        except Exception:
            pass
    return f


def fit(path, text, size, maxw):
    while size > 20 and ImageDraw.Draw(Image.new("L", (1, 1))).textlength(text, font=font(path, size)) > maxw:
        size -= 4
    return font(path, size)


def title_png(i, kicker, big, sub):
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    grad = Image.new("L", (1, S))
    for y in range(S):
        grad.putpixel((0, y), int(max(0, (y - S * 0.45) / (S * 0.55)) ** 1.4 * 235))
    shade = Image.new("RGBA", (S, S), (0, 0, 0, 255))
    shade.putalpha(grad.resize((S, S)))
    im = Image.alpha_composite(im, shade)
    d = ImageDraw.Draw(im)
    fb = fit(ANTON, big, 150, S - 144)
    fk = font(GROT, 34)
    fs = fit(GROT, sub, 42, S - 144)
    x, y = 72, S - 340
    d.rectangle([x, y + 8, x + 10, y + 48], fill=GREEN + (255,))
    d.text((x + 28, y), kicker, font=fk, fill=GREEN + (255,))
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).text((x, y + 62), big, font=fb, fill=GREEN + (170,))
    im = Image.alpha_composite(im, glow.filter(ImageFilter.GaussianBlur(14)))
    ImageDraw.Draw(im).text((x, y + 62), big, font=fb, fill=(255, 255, 255, 255))
    ImageDraw.Draw(im).text((x, y + 62 + fb.getbbox(big)[3] + 22), sub, font=fs, fill=(228, 228, 231, 255))
    im.save(f"{D}/t{i}.png")


def endcard():
    im = Image.new("RGB", (S, S), (9, 10, 15))
    glow = Image.new("RGB", (S, S), (0, 0, 0))
    ImageDraw.Draw(glow).ellipse([190, 120, 890, 820], fill=(10, 80, 58))
    im = Image.blend(im, glow.filter(ImageFilter.GaussianBlur(160)), 0.85)
    logo = Image.open("/app/frontend/public/brand/apexodds-profile.png").convert("RGBA").crop((260, 260, 820, 820)).resize((280, 280))
    mask = Image.new("L", (280, 280), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, 279, 279], radius=62, fill=255)
    halo = Image.new("RGB", (S, S), (0, 0, 0))
    ImageDraw.Draw(halo).rounded_rectangle([400, 200, 680, 480], radius=62, fill=GREEN)
    im = Image.blend(im, Image.composite(halo.filter(ImageFilter.GaussianBlur(40)), im, Image.new("L", (S, S), 255)), 0.35)
    im.paste(logo, ((S - 280) // 2, 200), mask)
    d = ImageDraw.Draw(im)
    fw = font(ANTON, 150)
    a, o = "APEX", "ODDS"
    wa, wo = d.textlength(a, font=fw), d.textlength(o, font=fw)
    x0 = (S - wa - wo - 20) / 2
    d.text((x0, 530), a, font=fw, fill=(255, 255, 255))
    d.text((x0 + wa + 20, 530), o, font=fw, fill=GREEN)
    ft = font(GROT, 44)
    t = "BET SMARTER. WIN BIGGER."
    d.text(((S - d.textlength(t, font=ft)) / 2, 745), t, font=ft, fill=(228, 228, 231))
    fs = font(GROT, 30)
    s = "SPORTS  ·  PLAYER PROPS  ·  CRYPTO  ·  CASINO"
    d.text(((S - d.textlength(s, font=fs)) / 2, 830), s, font=fs, fill=(130, 140, 150))
    d.rounded_rectangle([340, 905, 740, 975], radius=35, fill=GREEN)
    fc = font(GROT, 34)
    c = "SIGN UP TODAY"
    d.text(((S - d.textlength(c, font=fc)) / 2, 920), c, font=fc, fill=(0, 0, 0))
    im.save(f"{D}/end.png")


for i, t in enumerate(TITLES):
    title_png(i, *t)
endcard()

END = 3.6
args = [FF, "-y"]
for c in CLIPS:
    args += ["-i", f"{D}/{c}.mp4"]
args += ["-loop", "1", "-t", str(END), "-i", f"{D}/end.png"]
for i in range(len(TITLES)):
    args += ["-loop", "1", "-t", str(CL), "-i", f"{D}/t{i}.png"]
args += ["-i", f"{D}/music.wav"]
n = len(CLIPS)
fc = []
for i in range(n):
    ti = n + 1 + i
    fc.append(f"[{i}:v]trim=0:{CL},setpts=PTS-STARTPTS,scale={S}:{S},fps={FPS},format=yuv420p,"
              f"eq=contrast=1.06:saturation=1.08[v{i}]")
    fc.append(f"[{ti}:v]format=rgba,fade=in:st=0.45:d=0.45:alpha=1,fade=out:st={CL - 0.9}:d=0.4:alpha=1[tt{i}]")
    fc.append(f"[v{i}][tt{i}]overlay=0:0:format=auto,format=yuv420p[o{i}]")
fc.append(f"[{n}:v]scale={S}:{S},fps={FPS},format=yuv420p,zoompan=z='min(1.0+0.0012*on,1.06)':d=1:s={S}x{S}:fps={FPS}[oe]")
prev, off = "o0", 0.0
for i in range(1, n):
    off += CL - XF
    fc.append(f"[{prev}][o{i}]xfade=transition={'fadeblack' if i == 1 else 'smoothleft' if i % 2 else 'circleopen'}:duration={XF}:offset={off:.2f}[x{i}]")
    prev = f"x{i}"
off += CL - 0.6
fc.append(f"[{prev}][oe]xfade=transition=fadewhite:duration=0.6:offset={off:.2f},format=yuv420p[vout]")
total = off + END
music_i = n + 1 + len(TITLES)
fc.append(f"[{music_i}:a]atrim=0:{total:.2f},afade=t=in:d=0.4,afade=t=out:st={total - 1.6:.2f}:d=1.6,loudnorm=I=-14:TP=-1.5[aout]")
args += ["-filter_complex", ";".join(fc), "-map", "[vout]", "-map", "[aout]",
         "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-profile:v", "high",
         "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-t", f"{total:.2f}", f"{D}/apexodds_ad_1x1.mp4"]
r = subprocess.run(args, capture_output=True, text=True)
print(r.returncode, r.stderr[-1500:])
print("total", total)
