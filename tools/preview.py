"""把页面画成 PNG —— 不打开浏览器也能看效果。

为什么要有这个：沙箱和 CI 里没有浏览器，改完 CSS/Canvas 无法截图验证。
这个脚本用 Pillow 按 js/map.js 的同一套图层顺序和颜色重画一遍，
虽然不能 100% 复刻 Canvas（抗锯齿/字体度量略差），但足以检查：
  · 道路网有没有画出来、粗细分层对不对
  · 楼名/湖名有没有互相压字
  · 阴影、建筑、路线、起终点是否同页共存且不打架

用法：
    python tools/preview.py                       # 默认 14:00、示例路线 0、1400x900
    python tools/preview.py --time 16:00 --pair 1 --size 1600x1000 --out p.png
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data")

from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
]


def load(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        text = f.read()
    return json.loads(text.split("=", 1)[1].strip().rstrip(";"))


def pick_font(size, bold=False):
    order = FONT_CANDIDATES if not bold else ([FONT_CANDIDATES[1]] + FONT_CANDIDATES)
    for path in order:
        if path and os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


GROUND = (247, 239, 217)
GRID = (120, 125, 135, 40)
SHADOW = (29, 42, 69, 107)          # #1d2a45 @ 0.42
CAMPUS_EDGE = (46, 110, 74, 191)
ROAD_STYLE = {
    "main":    {"casing": 7.0, "fill": 5.0, "cc": (146, 139, 120, 140), "fc": (255, 253, 244)},
    "local":   {"casing": 4.6, "fill": 3.0, "cc": (152, 145, 128, 115), "fc": (253, 250, 240)},
    "service": {"casing": 3.0, "fill": 1.8, "cc": (158, 151, 134, 90),  "fc": (251, 247, 234)},
    "path":    {"casing": 0.0, "fill": 1.2, "cc": None,                 "fc": (158, 146, 120, 140)},
}


def building_fill(h):
    """与 js/core.js 的 buildingFill 同一规则：越高越深"""
    h = max(3.0, min(80.0, float(h or 12.0)))
    t = (h - 3.0) / 77.0
    lo, hi = 214, 132
    v = int(round(lo + (hi - lo) * t))
    return (v, v + 6, v + 16)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--time", default="14:00")
    ap.add_argument("--pair", type=int, default=0)
    ap.add_argument("--size", default="1400x900")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    W, H = (int(x) for x in a.size.lower().split("x"))
    meta, base = load("meta.js"), load("basemap.js")
    shadows, routes = load("shadows.js"), load("routes.js")
    buildings = load("buildings.js")

    frames = meta["frames"]
    idx = next((i for i, f in enumerate(frames) if f["t"] == a.time), None)
    if idx is None:
        sys.exit("没有 %s 这一帧" % a.time)
    frame = frames[idx]
    route = routes["frames"][idx]["routes"][a.pair]

    # ---- 视图变换：与 js/proj.js 的 fit 一致（等比 + 居中）----
    x0, y0, x1, y1 = meta["bbox_m"]
    pad = 28
    scale = min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (y1 - y0))
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    ox, oy = W / 2.0, H / 2.0

    def sx(x):
        return ox + (x - cx) * scale

    def sy(y):
        return oy - (y - cy) * scale          # y 朝北，屏幕朝下取反

    img = Image.new("RGBA", (W, H), GROUND + (255,))
    draw = ImageDraw.Draw(img, "RGBA")

    # ---- 1. 100 m 网格 ----
    import math
    gx = math.ceil(x0 / 100.0) * 100
    while gx <= x1:
        draw.line([(sx(gx), sy(y0)), (sx(gx), sy(y1))], fill=GRID, width=1)
        gx += 100
    gy = math.ceil(y0 / 100.0) * 100
    while gy <= y1:
        draw.line([(sx(x0), sy(gy)), (sx(x1), sy(gy))], fill=GRID, width=1)
        gy += 100

    # ---- 2. 水系 ----
    for w in base.get("water") or []:
        pts = [(sx(p[0]), sy(p[1])) for p in w["p"]]
        if len(pts) >= 3:
            draw.polygon(pts, fill=(126, 178, 205, 107) if w.get("approx") else (116, 172, 203, 140))

    # ---- 3. 道路（先描边后路面，路口才不会断）----
    order = ["path", "service", "local", "main"]
    for pass_no in (0, 1):
        for kind in order:
            st = ROAD_STYLE[kind]
            width = st["casing"] if pass_no == 0 else st["fill"]
            if not width:
                continue
            color = st["cc"] if pass_no == 0 else st["fc"]
            for r in base["roads"]:
                if r["t"] != kind or len(r["p"]) < 2:
                    continue
                pts = [(sx(p[0]), sy(p[1])) for p in r["p"]]
                draw.line(pts, fill=color, width=max(1, int(round(width))), joint="curve")

    # ---- 4. 阴影（整体叠一层半透明，重叠处不变黑）----
    shadow_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow_layer, "RGBA")
    for ring in shadows[idx]:
        pts = [(sx(p[0]), sy(p[1])) for p in ring]
        if len(pts) >= 3:
            sdraw.polygon(pts, fill=SHADOW)
    img = Image.alpha_composite(img, shadow_layer)
    draw = ImageDraw.Draw(img, "RGBA")

    # ---- 5. 建筑 ----
    for b in buildings:
        pts = [(sx(p[0]), sy(p[1])) for p in b["p"]]
        if len(pts) >= 3:
            draw.polygon(pts, fill=building_fill(b.get("h")) + (255,),
                         outline=(70, 80, 95, 140))

    # ---- 6. 校园边界 ----
    ring = (meta.get("campus") or {}).get("ring")
    if ring:
        pts = [(sx(p[0]), sy(p[1])) for p in ring]
        for i in range(0, len(pts), 2):     # 手绘虚线
            draw.line([pts[i], pts[(i + 1) % len(pts)]], fill=CAMPUS_EDGE, width=3)

    # ---- 7. 路线 ----
    def draw_route(pts_m, color, dashed):
        if not pts_m or len(pts_m) < 2:
            return
        pts = [(sx(p[0]), sy(p[1])) for p in pts_m]
        if dashed:
            for i in range(0, len(pts) - 1, 2):
                draw.line([pts[i], pts[i + 1]], fill=color, width=7, joint="curve")
        else:
            draw.line(pts, fill=color, width=7, joint="curve")

    if route.get("cool"):
        draw_route(route["cool"]["pts"], (56, 193, 114, 255), False)
    if route.get("fastest"):
        draw_route(route["fastest"]["pts"], (255, 122, 69, 255), True)

    # ---- 8. 地名标注（白描边 + 简单避让）----
    placed = []
    f_b = pick_font(11)
    f_w = pick_font(13, bold=True)

    def draw_label(text, x, y, font, color):
        bbox = draw.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        bx, by = x - tw / 2 - 2, y - th / 2 - 1

        def hits():
            for (ax, ay, aw, ah) in placed:
                if bx < ax + aw and bx + tw + 4 > ax and by < ay + ah and by + th + 3 > ay:
                    return True
            return False

        if hits() or bx < -40 or bx > W + 40 or by < -20 or by > H + 20:
            return False
        placed.append((bx, by, tw + 4, th + 3))
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1)):
            draw.text((x - tw / 2 + dx, y - th / 2 + dy), text, font=font, fill=(255, 253, 244, 235))
        draw.text((x - tw / 2, y - th / 2), text, font=font, fill=color)
        return True

    drawn = 0
    for L in base["labels"]:
        if L["k"] == "w":
            font, color = f_w, (38, 96, 128, 242)
        elif L["k"] == "r":
            font, color = f_b, (96, 88, 70, 230)
        else:
            font, color = f_b, (58, 62, 72, 230)
        if draw_label(L["n"], sx(L["x"]), sy(L["y"]), font, color):
            drawn += 1

    # ---- 9. 起终点 + 比例尺 ----
    def marker(xy, color, txt):
        if not xy:
            return
        px, py = sx(xy[0]), sy(xy[1])
        draw.ellipse([px - 8, py - 8, px + 8, py + 8], fill=(255, 255, 255), outline=color, width=3)
        f = pick_font(10, bold=True)
        bbox = draw.textbbox((0, 0), txt, font=f)
        draw.text((px - (bbox[2] - bbox[0]) / 2, py - (bbox[3] - bbox[1]) / 2 - 1),
                  txt, font=f, fill=(16, 20, 28))

    pair = routes["pairs"][a.pair]
    marker(route["fastest"]["pts"][0], (56, 193, 114, 255), "起")
    marker(route["fastest"]["pts"][-1], (255, 122, 69, 255), "终")

    # 标题条
    f_t = pick_font(17, bold=True)
    f_s = pick_font(12)
    sun = frame["sun"]
    draw.text((30, 22), "%s  %s" % (a.time, pair["name"]), font=f_t, fill=(24, 30, 44, 255))
    draw.text((30, 48), "太阳高度角 %.1f°  方位 %.0f°" % (sun[1], sun[0]), font=f_s, fill=(80, 86, 100, 255))

    out = a.out or os.path.join(ROOT, "preview-%s-pair%d.png" % (a.time.replace(":", ""), a.pair))
    img.convert("RGB").save(out)
    print("已输出 %s  (%dx%d)  道路 %d 段 / 地名画出 %d 个"
          % (out, W, H, len(base["roads"]), drawn))


if __name__ == "__main__":
    main()