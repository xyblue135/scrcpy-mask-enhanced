#!/usr/bin/env python3
"""scrcpy-mask 映射性能（触摸事件）监控服务。

读取主程序写入的 touch_probe.jsonl（每次注入手机的触摸事件一行：
时间戳、距上一条间隔、action、指针、坐标），通过本地 HTTP + SSE
推送给浏览器实时图表，零第三方依赖（仅标准库）。

与屏幕性能监控（perf.jsonl，monitor.py，端口 8765）分开，本服务默认端口 8766。

用法:
    python touch_monitor.py                  # 默认端口 8766
    python touch_monitor.py --dir D:/data    # 指定 touch_probe.jsonl 所在目录
    python touch_monitor.py --port 9001      # 修改端口
    python touch_monitor.py --no-browser     # 不自动打开浏览器
"""
from __future__ import annotations

import argparse
import json
import queue
import threading
import time
from collections import Counter, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HOST = "127.0.0.1"
DEFAULT_PORT = 8766
# 保留最近的数据秒数（时间窗口）
WINDOW_SECONDS = 300
# 探测新行的轮询间隔
POLL_INTERVAL = 0.2
# 单次 snapshot 最多返回的数据行数（超出则均匀降采样）
MAX_SNAPSHOT_ROWS = 400
# 最近事件表格保留条数
RECENT_EVENTS = 80


def default_data_dir() -> Path:
    """默认读取主程序（debug/release 构建）data 目录下的 touch_probe.jsonl。"""
    return Path(
        r"D:\0_desktop\2_Frequently_Used_Folders\scrcpy-mask-enhanced\scrcpy-mask-enhanced\target\debug\data"
    )


class TouchStore:
    """轮询 touch_probe.jsonl，维护时间窗口内的事件流与统计。"""

    def __init__(self, touch_file: Path, window: int = WINDOW_SECONDS):
        self.touch_file = touch_file
        self.window = window
        self.events: deque[dict] = deque()
        self._last_size = 0
        self._listeners: list[queue.Queue] = []
        self._lock = threading.Lock()
        self._start_ts = time.time()

    def subscribe(self):
        q = queue.Queue(maxsize=256)
        with self._lock:
            self._listeners.append(q)
        return q

    def unsubscribe(self, q) -> None:
        with self._lock:
            if q in self._listeners:
                self._listeners.remove(q)

    def _broadcast(self, row: dict) -> None:
        with self._lock:
            for q in self._listeners:
                try:
                    q.put_nowait(row)
                except queue.Full:
                    pass

    def poll_loop(self, stop: threading.Event) -> None:
        """后台线程：按 POLL_INTERVAL 读取文件新增行并广播。"""
        while not stop.is_set():
            try:
                if self.touch_file.exists():
                    size = self.touch_file.stat().st_size
                    if size < self._last_size:
                        self._last_size = 0  # 文件被重建/清空
                    if size > self._last_size:
                        with open(self.touch_file, "r", encoding="utf-8", errors="replace") as f:
                            f.seek(self._last_size)
                            for line in f:
                                line = line.strip()
                                if not line:
                                    continue
                                try:
                                    row = json.loads(line)
                                except json.JSONDecodeError:
                                    continue
                                self._push(row)
                        self._last_size = size
            except OSError:
                pass
            stop.wait(POLL_INTERVAL)

    def _push(self, row: dict) -> None:
        row["ts"] = row.get("ts", time.time())
        with self._lock:
            self.events.append(row)
            cutoff = time.time() - self.window
            while self.events and self.events[0].get("ts", 0) < cutoff:
                self.events.popleft()
        self._broadcast(row)

    def snapshot(self) -> dict:
        with self._lock:
            events = list(self.events)
        if not events:
            return {
                "now": time.time(),
                "start": self._start_ts,
                "events_per_sec": [],
                "since_last": [],
                "action_counts": {},
                "recent": [],
                "total_events": 0,
                "latest": None,
            }

        # 事件频率曲线：按秒聚合
        events_per_sec: list[dict] = []
        buckets: dict[int, int] = {}
        for e in events:
            bucket = int(e["ts"])
            buckets[bucket] = buckets.get(bucket, 0) + 1
        for ts in sorted(buckets):
            events_per_sec.append({"ts": float(ts), "v": buckets[ts]})

        # 间隔曲线：直接取 since_last_ms（降采样后返回）
        since_last = [
            {"ts": e["ts"], "v": e.get("since_last_ms", 0.0)} for e in events
        ]
        since_last = _downsample(since_last, MAX_SNAPSHOT_ROWS)

        # action 统计
        action_counts = Counter(e.get("action", "?") for e in events)

        return {
            "now": time.time(),
            "start": self._start_ts,
            "events_per_sec": events_per_sec,
            "since_last": since_last,
            "action_counts": dict(action_counts),
            "recent": list(events)[-RECENT_EVENTS:],
            "total_events": len(events),
            "latest": events[-1],
        }


STORE: TouchStore | None = None


def _downsample(rows: list[dict], limit: int) -> list[dict]:
    """按 limit 均匀降采样：保留首尾，中间等距抽样，保持曲线整体形状。"""
    n = len(rows)
    if n <= limit:
        return rows
    step = n / limit
    out = []
    for i in range(limit - 1):
        out.append(rows[int(i * step)])
    out.append(rows[-1])  # 始终保留最新一行
    return out


def _sse(data: str, event: str = "message") -> str:
    return f"event: {event}\ndata: {data}\n\n"


class Handler(BaseHTTPRequestHandler):
    server_version = "touch_monitor/1.0"

    def log_message(self, fmt, *args):  # 静默访问日志
        pass

    def _send_json(self, obj: dict, status: int = 200) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        url = urlparse(self.path)
        path = url.path
        if path in ("/", "/index.html"):
            self._serve_index()
        elif path == "/api/snapshot":
            self._send_json(STORE.snapshot())
        elif path == "/events":
            self._serve_sse()
        elif path == "/health":
            self._send_json({"ok": True, "file": str(STORE.touch_file)})
        elif path.startswith("/vendor/"):
            self._serve_vendor(path.removeprefix("/vendor/"))
        else:
            self.send_error(404)

    def _serve_vendor(self, rel: str) -> None:
        root = Path(__file__).resolve().parent / "vendor"
        target = (root / rel).resolve()
        if not str(target).startswith(str(root.resolve())) or not target.is_file():
            self.send_error(404)
            return
        content_type = "application/javascript"
        if target.suffix == ".css":
            content_type = "text/css"
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "public, max-age=3600")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_index(self) -> None:
        index = Path(__file__).resolve().parent / "index_touch.html"
        if not index.exists():
            self.send_error(404, "index_touch.html not found next to touch_monitor.py")
            return
        body = index.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_sse(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        q = STORE.subscribe()
        try:
            self.wfile.write(_sse(json.dumps(STORE.snapshot()), "snapshot").encode("utf-8"))
            self.wfile.flush()
            while True:
                try:
                    row = q.get(timeout=15)
                    self.wfile.write(_sse(json.dumps(row)).encode("utf-8"))
                    self.wfile.flush()
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            STORE.unsubscribe(q)

    def _handle_one_shot(self) -> None:
        try:
            self.do_GET()
        except (BrokenPipeError, ConnectionResetError):
            pass

    do_POST = _handle_one_shot


def main() -> None:
    global STORE
    parser = argparse.ArgumentParser(description="scrcpy-mask 映射性能（触摸事件）监控服务")
    parser.add_argument("--dir", default=None, help="touch_probe.jsonl 所在目录（默认应用数据目录）")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--host", default=HOST)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    if args.dir:
        data_dir = Path(args.dir)
    else:
        data_dir = default_data_dir()
    touch_file = data_dir / "touch_probe.jsonl"

    if not touch_file.exists():
        print(f"[touch_monitor] 未找到 {touch_file}")
        print("  主程序开启「映射性能探针」并产生触摸事件后会自动出现；现在先启动页面（将显示等待数据）。")

    STORE = TouchStore(touch_file)
    stop = threading.Event()
    threading.Thread(target=STORE.poll_loop, args=(stop,), daemon=True).start()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{args.host}:{args.port}/"
    print(f"[touch_monitor] 数据文件: {touch_file}")
    print(f"[touch_monitor] 监控页面: {url}")
    if not args.no_browser:
        import webbrowser

        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[touch_monitor] 已停止")
    finally:
        stop.set()
        httpd.server_close()


if __name__ == "__main__":
    main()
