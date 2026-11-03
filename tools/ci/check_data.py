#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CI 数据守卫：体积预算 + JSON 解析 + 口径不变量 + 换行/BOM。

只用标准库；不联网；不写任何文件。
用法：python tools/ci/check_data.py
退出码：0 = 通过，1 = 有阻断问题；警告不阻断。

这些数字写在 README / PITCH / PPT 里，变了就是口径事故——所以让 CI 而不是 diff 来发现。
"""
import json
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
DATA_BUDGET = int(os.environ.get("DATA_BUDGET", "1600000"))
SINGLE_FILE_MAX = int(os.environ.get("SINGLE_FILE_MAX", "1048576"))
RAW_BUDGET = int(os.environ.get("RAW_BUDGET", "700000"))
IN_CI = os.environ.get("GITHUB_ACTIONS") == "true"

GENERATED = [
    "data/meta.js", "data/buildings.js", "data/shadows.js",
    "data/routes.js", "data/graph.js", "data/basemap.js",
]

errors, warnings = [], []


def err(msg):
    errors.append(msg)
    print(("::error::" if IN_CI else "[FAIL] ") + msg)


def warn(msg):
    warnings.append(msg)
    print(("::warning::" if IN_CI else "[WARN] ") + msg)


def load_js(path):
    """data/*.js 是 `window.DATA_X = {...};` —— 截掉前缀按 JSON 解析。"""
    text = path.read_text(encoding="utf-8")
    body = text[text.index("=") + 1:].strip().rstrip(";").strip()
    return json.loads(body)


def check_generated():
    total = 0
    for rel in GENERATED:
        p = ROOT / rel
        if not p.is_file() or p.stat().st_size == 0:
            err(f"{rel} 缺失或为空 —— smoke.js 会以 TypeError 崩溃而不是可读断言失败")
            continue
        size = p.stat().st_size
        total += size
        print(f"  {size:>9,} B  {rel}")
        if size > SINGLE_FILE_MAX:
            err(f"{rel} = {size:,} B 超过单文件预算 {SINGLE_FILE_MAX:,} B")
        if "window.DATA_" not in p.read_text(encoding="utf-8", errors="replace"):
            err(f"{rel} 里找不到 window.DATA_* 赋值，生成物结构可能被改坏")
    print(f"  ---- 生成物合计 {total:,} B（预算 {DATA_BUDGET:,}）")
    if total > DATA_BUDGET:
        err(f"data/*.js 合计 {total:,} B 超过预算 {DATA_BUDGET:,} B（体积爆炸）")


def check_raw():
    total = 0
    raw = ROOT / "data/raw"
    if not raw.is_dir():
        err("data/raw/ 不存在（原始数据丢了？）")
        return
    for p in sorted(raw.glob("*.json")):
        size = p.stat().st_size
        total += size
        if p.read_bytes()[:3] == b"\xef\xbb\xbf":
            err(f"data/raw/{p.name} 带 UTF-8 BOM")
            continue
        try:
            obj = json.loads(p.read_bytes().decode("utf-8"))
        except Exception as e:  # noqa: BLE001 - 要的就是把任何解析错暴露出来
            err(f"data/raw/{p.name} JSON 解析失败：{e}")
            continue
        print(f"  OK {p.name:<18} {type(obj).__name__:<6} {size:>9,} B")
    print(f"  ---- raw 合计 {total:,} B（预算 {RAW_BUDGET:,}）")
    if total > RAW_BUDGET:
        err(f"data/raw 合计 {total:,} B 超过预算 {RAW_BUDGET:,} B")


def check_invariants():
    try:
        meta = load_js(ROOT / "data/meta.js")
    except Exception as e:  # noqa: BLE001
        err(f"data/meta.js 无法解析：{e}")
        return
    if meta.get("date") != "2026-11-02":
        err(f"data/meta.js 的演示日变成 {meta.get('date')!r}；README/PITCH/PPT 全按 2026-11-02 写")
    frames = meta.get("frames") or []
    if len(frames) != 31:
        err(f"data/meta.js 帧数 {len(frames)} != 31（README §1.2 与 PPT 都写 31 帧）")
    if frames and not all(len(f.get("sun") or []) == 2 for f in frames):
        err("data/meta.js 有帧缺少 sun[方位, 高度]")

    try:
        shadows = load_js(ROOT / "data/shadows.js")
        if len(shadows) != len(frames):
            err(f"shadows 帧数 {len(shadows)} != meta 帧数 {len(frames)}")
    except Exception as e:  # noqa: BLE001
        err(f"data/shadows.js 无法解析：{e}")

    try:
        graph = load_js(ROOT / "data/graph.js")
        if len(graph.get("edges") or []) != 613:
            warn(f"graph.edges = {len(graph.get('edges') or [])}，文档口径是 613")
        if len(graph.get("nodes") or []) != 474:
            warn(f"graph.nodes = {len(graph.get('nodes') or [])}，文档口径是 474")
        if float(graph.get("coolFactor", 0)) != 6.0:
            warn(f"graph.coolFactor = {graph.get('coolFactor')}，README 口径是 6")
    except Exception as e:  # noqa: BLE001
        err(f"data/graph.js 无法解析：{e}")

    try:
        routes = load_js(ROOT / "data/routes.js")
        if len(routes.get("pairs") or []) != 2:
            warn(f"routes.pairs = {len(routes.get('pairs') or [])}，页面「示例 A/B」需要 2 组")
        if len(routes.get("frames") or []) != len(frames):
            err(f"routes 帧数 {len(routes.get('frames') or [])} != meta 帧数 {len(frames)}")
    except Exception as e:  # noqa: BLE001
        err(f"data/routes.js 无法解析：{e}")

    print("  口径不变量检查完成")


def check_eol():
    try:
        out = subprocess.run(["git", "ls-files", "--eol"], cwd=ROOT,
                             capture_output=True, text=True, check=True).stdout
    except Exception as e:  # noqa: BLE001 - 不在 git 仓库里跑就跳过
        warn(f"跳过换行检查（git 不可用：{e}）")
        return
    bad = [ln for ln in out.splitlines() if ln.startswith("i/crlf") or ln.startswith("i/mixed")]
    if bad:
        err("索引里存在 CRLF/混合换行文件：\n" + "\n".join(bad[:10]))
    print("  换行检查完成（索引应全为 LF）")


def main():
    print("== 生成物体积 =="); check_generated()
    print("== raw JSON 解析 =="); check_raw()
    print("== 口径不变量 =="); check_invariants()
    print("== 换行 =="); check_eol()
    print()
    if errors:
        print(f"FAIL：{len(errors)} 个阻断问题 / {len(warnings)} 个警告")
        return 1
    print(f"PASS：0 个阻断问题 / {len(warnings)} 个警告")
    return 0


if __name__ == "__main__":
    sys.exit(main())