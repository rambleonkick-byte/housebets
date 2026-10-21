import os, time, json, requests, concurrent.futures as cf
from urllib.parse import urlparse

K = os.environ["EMERGENT_LLM_KEY"]
B = os.environ.get("INTEGRATION_PROXY_URL", "https://integrations.emergentagent.com").rstrip("/") + "/api/v1/fal"
OUT = "/app/marketing/ad"
os.makedirs(OUT, exist_ok=True)
H = {"Authorization": f"Bearer {K}", "Content-Type": "application/json"}
STYLE = ("cinematic commercial, dark moody night palette, deep black with electric emerald-green neon accents, "
         "anamorphic lens flares, volumetric light, shallow depth of field, ultra detailed, high-end sports betting brand ad, no text, no logos")
CLIPS = {
    "c1_stadium": "Slow dramatic drone push-in over a packed night stadium, blazing floodlights cutting through haze, emerald green light beams sweeping the crowd, confetti in the air, " + STYLE,
    "c2_dunk": "Extreme slow motion basketball player soaring for a dunk in a dark arena, sweat droplets frozen in the air, green rim light outlining the athlete, camera orbits around him, " + STYLE,
    "c3_phone": "Close-up of a hand holding a sleek smartphone in a dark room, the screen glowing green with rapidly changing live betting odds, player stat cards and rising charts reflected on the face of the viewer, holographic numbers floating out of the screen, " + STYLE,
    "c4_crypto": "Shiny golden and silver cryptocurrency coins raining in slow motion into a glowing emerald green portal, futuristic neon city skyline at night in the background, sparks and particles, camera dolly forward, " + STYLE,
    "c5_goal": "Slow motion soccer ball smashing into the back of the net under stadium floodlights, the net ripples and a burst of emerald green energy shockwave explodes outward with golden coins flying back toward camera, " + STYLE,
}
MUSIC = ("Epic dramatic cinematic trailer music, deep booming drums, tense rising strings, heavy sub bass hits, "
         "building to a powerful climax with braams, ending on a big final impact, instrumental, 120 bpm")


def run(endpoint, payload, timeout=1500):
    r = requests.post(f"{B}/proxy", headers=H | {"X-Fal-Target-Url": f"https://queue.fal.run/{endpoint}"}, json=payload, timeout=60)
    if r.status_code == 402:
        raise RuntimeError("Insufficient Universal Key credits")
    r.raise_for_status()
    sub = r.json()
    base = urlparse(B + "/queue")
    for u in (sub["status_url"], sub["response_url"]):
        p = urlparse(u)
        assert p.netloc == base.netloc and p.path.startswith(base.path), "untrusted queue url"
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            s = requests.get(sub["status_url"], headers=H, timeout=30).json()
        except requests.RequestException:
            time.sleep(5); continue
        st = (s.get("status") or "").upper()
        if st in ("COMPLETED", "OK"):
            for _ in range(5):
                try:
                    return requests.get(sub["response_url"], headers=H, timeout=60).json()
                except requests.RequestException:
                    time.sleep(3)
        if st in ("FAILED", "CANCELLED", "CANCELED", "ERROR"):
            raise RuntimeError(f"{endpoint} failed: {s}")
        time.sleep(5)
    raise RuntimeError("timeout")


def save(url, path):
    with requests.get(url, timeout=300, stream=True) as r:
        r.raise_for_status()
        with open(path, "wb") as f:
            for ch in r.iter_content(1 << 20):
                f.write(ch)


def clip(name, prompt):
    path = f"{OUT}/{name}.mp4"
    if os.path.exists(path):
        return name, "exists"
    res = run("fal-ai/kling-video/v3/pro/text-to-video",
              {"prompt": prompt, "aspect_ratio": "1:1", "duration": "5", "generate_audio": False})
    save(res["video"]["url"], path)
    return name, "ok"


def music():
    path = f"{OUT}/music.wav"
    if os.path.exists(path):
        return "music", "exists"
    res = run("fal-ai/stable-audio-25/text-to-audio", {"prompt": MUSIC, "seconds_total": 29, "guidance_scale": 7})
    url = res["audio"]["url"]
    ext = os.path.splitext(urlparse(url).path)[1] or ".wav"
    path = f"{OUT}/music{ext}"
    save(url, path)
    return "music", "ok " + path


with cf.ThreadPoolExecutor(6) as ex:
    futs = [ex.submit(clip, n, p) for n, p in CLIPS.items()] + [ex.submit(music)]
    for f in cf.as_completed(futs):
        try:
            print(f.result(), flush=True)
        except Exception as e:
            print("ERROR", e, flush=True)
print("DONE", flush=True)
