#!/usr/bin/env python3
"""生成模拟 perf.jsonl 用于自测监控页（不依赖主程序）。"""
import json
import math
import time
from pathlib import Path

PROBES = [
    ("net.read_packet", "读取一包媒体数据（socket，含网络等待）", "", 1.2, 0.4),
    ("video.decode_receive", "ffmpeg 解码输出一帧", "解码 CPU 大头在此；可细分 send_packet 与 receive_frame", 6.8, 1.1),
    ("video.plane_copy", "YUV 平面拷贝到可复用缓冲", "", 0.9, 0.3),
    ("slot.send", "视频帧写入共享槽（锁）", "", 0.15, 0.05),
    ("slot.take", "UI 从共享槽取帧（锁）", "", 0.12, 0.04),
    ("ui.frame_time", "Bevy 每帧耗时", "avg 高 = 渲染/UI 卡顿源；count≈每秒 UI 帧数", 7.5, 3.2),
    ("audio.decode", "音频解码/接收一帧", "", 0.6, 0.2),
    ("audio.resample", "音频重采样", "", 0.3, 0.1),
    ("ws.recv", "处理一条 WS 消息", "", 0.05, 0.02),
    ("slot.buffer_miss", "缓冲池未命中（新分配次数）", "miss 偏高可考虑调大 VIDEO_BUFFER_POOL_LIMIT", 0.0, 0.0),
    ("slot.buffer_hit", "缓冲池复用命中次数", "count 高 = 复用良好", 0.0, 0.0),
]

out = Path("mock_perf.jsonl")
n = 180  # 3 分钟
t0 = time.time() - n
with out.open("w", encoding="utf-8") as f:
    for i in range(n):
        ts = t0 + i
        wave = 1.0 + 0.6 * math.sin(i / 20.0) + 0.3 * math.sin(i / 5.0)
        fps = max(0.0, 60.0 * wave * (0.95 if i % 47 == 0 else 1.0))
        probes = []
        for (name, desc, hint, base, jitter) in PROBES:
            if base <= 0:
                probes.append({"name": name, "desc": desc, "hint": hint,
                               "count": 480 if "hit" in name else 12,
                               "avg_ms": 0.0, "p95_ms": 0.0, "max_ms": 0.0})
                continue
            p95 = base * wave + jitter * math.sin(i / 9.0 + hash(name) % 7)
            probes.append({"name": name, "desc": desc, "hint": hint,
                           "count": 60, "avg_ms": p95 * 0.55, "p95_ms": max(0.05, p95), "max_ms": p95 * 1.9})
        row = {"ts": ts, "fps": round(fps, 1),
               "delivered": int(fps), "dropped": 0 if fps >= 55 else int(60 - fps),
               "probes": probes}
        f.write(json.dumps(row) + "\n")
print(f"mock_perf.jsonl generated: {out.resolve()} ({n} rows)")
