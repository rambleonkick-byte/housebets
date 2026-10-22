import json, subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
D = "/app/marketing/tnf_ad"
S, FPS = 1080, 30
G = (16, 185, 129)
ANTON, GROT = "/app/marketing/Anton.ttf", "/app/marketing/SpaceGrotesk.ttf"
PH_H = 900                      # phone screen height
PH_W = round(390 * PH_H / 844)  # 416
BZ = 16                         # bezel
PX, PY = S - PH_W - 2 * BZ - 90, (S - PH_H - 2 * BZ) // 2


def f(p, s, w=700):
    ft = ImageFont.truetype(p, s)
    if p == GROT:
        ft.set_variation_by_axes([w])
    return ft


def run(args):
    r = subprocess.run([FF, "-y", "-loglevel", "error"] + args, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[:2500]


# 1. phone screen video from timed frames (trim to ~1.3s after the last tap)
times = json.load(open(f"{D}/frames/times.json"))
last = len(times) - 1
end_t = times[0] + 0
cut = next(i for i in range(len(times)) if times[i] - times[-1] > -1350) if False else None
place_t = times[-1] - 2600
keep = list(range(len(times)))
with open(f"{D}/frames/list.txt", "w") as fh:
    for a, b in zip(keep, keep[1:] + [None]):
        dur = ((times[b] - times[a]) if b is not None else 400) / 1000
        fh.write(f"file 'f{a:04d}.png'\nduration {dur:.3f}\n")
    fh.write(f"file 'f{keep[-1]:04d}.png'\n")
PHONE_T = (times[keep[-1]] - times[keep[0]]) / 1000 + 0.4
run(["-f", "concat", "-safe", "0", "-i", f"{D}/frames/list.txt", "-vf",
     f"fps={FPS},scale={PH_W}:{PH_H}:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-crf", "16", f"{D}/screen.mp4"])

# 2. phone bezel + rounded screen mask
W, H = PH_W + 2 * BZ, PH_H + 2 * BZ
bez = Image.new("RGBA", (S, S), (0, 0, 0, 0))
sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(sh).rounded_rectangle([PX - 10, PY + 10, PX + W + 10, PY + H + 30], radius=70, fill=(0, 0, 0, 200))
bez = Image.alpha_composite(bez, sh.filter(ImageFilter.GaussianBlur(30)))
gl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(gl).rounded_rectangle([PX, PY, PX + W, PY + H], radius=64, fill=G + (120,))
bez = Image.alpha_composite(bez, gl.filter(ImageFilter.GaussianBlur(40)))
d = ImageDraw.Draw(bez)
d.rounded_rectangle([PX, PY, PX + W, PY + H], radius=64, fill=(22, 24, 30, 255), outline=(70, 76, 90, 255), width=3)
hole = Image.new("L", (S, S), 0)
ImageDraw.Draw(hole).rounded_rectangle([PX + BZ, PY + BZ, PX + BZ + PH_W, PY + BZ + PH_H], radius=50, fill=255)
a = bez.getchannel("A")
a.paste(0, mask=hole)
bez.putalpha(a)
d = ImageDraw.Draw(bez)
d.rounded_rectangle([PX + W // 2 - 55, PY + BZ + 10, PX + W // 2 + 55, PY + BZ + 40], radius=15, fill=(0, 0, 0, 255))
bez.save(f"{D}/bezel.png")
m = Image.new("L", (PH_W, PH_H), 0)
ImageDraw.Draw(m).rounded_rectangle([0, 0, PH_W - 1, PH_H - 1], radius=50, fill=255)
m.save(f"{D}/screenmask.png")


# 3. text overlays
def shade_bottom():
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    g = Image.new("L", (1, S))
    for y in range(S):
        g.putpixel((0, y), int(max(0, (y - S * 0.4) / (S * 0.6)) ** 1.3 * 235))
    blk = Image.new("RGBA", (S, S), (0, 0, 0, 255))
    blk.putalpha(g.resize((S, S)))
    return Image.alpha_composite(im, blk)


def glow_text(im, xy, txt, ft, fill=(255, 255, 255)):
    g = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(g).text(xy, txt, font=ft, fill=G + (170,))
    im = Image.alpha_composite(im, g.filter(ImageFilter.GaussianBlur(14)))
    ImageDraw.Draw(im).text(xy, txt, font=ft, fill=fill + (255,))
    return im


def kicker(d, x, y, txt):
    d.rectangle([x, y + 8, x + 10, y + 46], fill=G)
    d.text((x + 28, y), txt, font=f(GROT, 34), fill=G)


im = shade_bottom()
d = ImageDraw.Draw(im)
kicker(d, 72, 640, "TONIGHT  ·  8:15 PM ET")
im = glow_text(im, (72, 700), "PATRIOTS @ BEARS", f(ANTON, 128))
ImageDraw.Draw(im).text((72, 880), "LIVE ODDS ON APEX ODDS", font=f(GROT, 42), fill=(228, 228, 231))
im.save(f"{D}/t_intro.png")

im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
side = Image.new("L", (S, 1))
for x in range(S):
    side.putpixel((x, 0), int(max(0, 1 - x / (S * 0.65)) * 215))
blk = Image.new("RGBA", (S, S), (5, 7, 12, 255))
blk.putalpha(side.resize((S, S)))
im = Image.alpha_composite(im, blk)
d = ImageDraw.Draw(im)
kicker(d, 64, 330, "BET IT IN SECONDS")
im = glow_text(im, (60, 390), "PATRIOTS", f(ANTON, 104))
im = glow_text(im, (60, 520), "TO WIN", f(ANTON, 104))
d = ImageDraw.Draw(im)
d.rounded_rectangle([64, 680, 404, 760], radius=40, outline=G, width=4, fill=(8, 22, 18, 255))
d.text((96, 694), "NE ML  2.30", font=f(GROT, 42), fill=(255, 255, 255))
d.text((66, 790), "Pick your side. Tap. Done.", font=f(GROT, 30, 500), fill=(170, 178, 188))
im.save(f"{D}/t_phone.png")

im = Image.new("RGBA", (S, S), (0, 0, 0, 150))
d = ImageDraw.Draw(im)
fk = f(GROT, 40)
t = "THURSDAY NIGHT"
d.text(((S - d.textlength(t, font=fk)) / 2, 300), t, font=fk, fill=G)
fb = f(ANTON, 190)
t = "FOOTBALL"
im = glow_text(im, ((S - d.textlength(t, font=fb)) / 2, 350), t, fb)
d = ImageDraw.Draw(im)
fq = f(ANTON, 120)
t = "WHO'S YOUR TEAM?"
w = d.textlength(t, font=fq)
im = glow_text(im, ((S - w) / 2, 600), t, fq, fill=G)
d = ImageDraw.Draw(im)
fs = f(GROT, 36)
t = "NE @ CHI  ·  8:15 PM ET  ·  APEXODDS.IO"
d.text(((S - d.textlength(t, font=fs)) / 2, 800), t, font=fs, fill=(228, 228, 231))
d.rounded_rectangle([64, 64, 120, 120], radius=14, fill=G)
d.polygon([(97, 72), (78, 97), (91, 97), (85, 113), (106, 86), (93, 86)], fill=(0, 0, 0))
fl = f(ANTON, 46)
d.text((136, 66), "APEX", font=fl, fill=(255, 255, 255))
d.text((136 + d.textlength("APEX", font=fl) + 8, 66), "ODDS", font=fl, fill=G)
im.save(f"{D}/t_end.png")

# 4. compose: intro (4s) -> phone over blurred action -> TNF end card over action
I, E, XF = 4.0, 4.5, 0.4
P = PHONE_T + 0.6
total = I + P + E - 2 * XF
fc = [
    f"[0:v]trim=0:{I},setpts=PTS-STARTPTS,scale={S}:{S},fps={FPS},format=yuv420p,eq=contrast=1.06:saturation=1.08[a0]",
    f"[4:v]format=rgba,fade=in:st=0.4:d=0.4:alpha=1,fade=out:st={I - 0.8}:d=0.4:alpha=1[ta]",
    f"[a0][ta]overlay=0:0,fps={FPS},settb=AVTB,format=yuv420p[s0]",
    "[1:v]split[act1][act2]",
    f"[act1]trim=0:5,setpts=PTS-STARTPTS,scale={S}:{S},fps={FPS},boxblur=18:2,eq=brightness=-0.12,loop=loop=-1:size=150,trim=0:{P},setpts=PTS-STARTPTS[bg]",
    f"[5:v]loop=loop=-1:size=1,trim=0:{P},setpts=PTS-STARTPTS,format=rgba[tp]",
    "[2:v]setpts=PTS-STARTPTS+0.3/TB,format=rgba[scr0]",
    "[3:v]format=gray[msk]",
    "[scr0][msk]alphamerge[scr]",
    "[bg][tp]overlay=0:0[b1]",
    f"[b1][scr]overlay={PX + BZ}:{PY + BZ}:eof_action=repeat[b2]",
    f"[b2][6:v]overlay=0:0,trim=0:{P},fps={FPS},settb=AVTB,format=yuv420p[s1]",
    f"[act2]trim=0:{E},setpts=PTS-STARTPTS,scale={S}:{S},fps={FPS},format=yuv420p[a2]",
    f"[7:v]format=rgba,fade=in:st=0.3:d=0.5:alpha=1[te]",
    f"[a2][te]overlay=0:0,fps={FPS},settb=AVTB,format=yuv420p[s2]",
    f"[s0][s1]xfade=transition=fadeblack:duration={XF}:offset={I - XF:.2f}[x1]",
    f"[x1][s2]xfade=transition=fadewhite:duration={XF}:offset={I + P - 2 * XF:.2f},format=yuv420p[vout]",
    f"[8:a]atrim=0:{total:.2f},afade=t=in:d=0.3,afade=t=out:st={total - 1.5:.2f}:d=1.5,loudnorm=I=-14:TP=-1.5[aout]",
]
run(["-i", f"{D}/t1_stadium.mp4", "-i", f"{D}/t2_action.mp4", "-i", f"{D}/screen.mp4", "-loop", "1", "-i", f"{D}/screenmask.png",
     "-loop", "1", "-t", str(I), "-i", f"{D}/t_intro.png", "-i", f"{D}/t_phone.png", "-loop", "1", "-i", f"{D}/bezel.png",
     "-loop", "1", "-t", str(E), "-i", f"{D}/t_end.png", "-i", f"{D}/music.wav",
     "-filter_complex", ";".join(fc), "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
     "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-t", f"{total:.2f}",
     f"{D}/apexodds_tnf_ad.mp4"])
print("total", round(total, 2), "phone", round(PHONE_T, 2))
