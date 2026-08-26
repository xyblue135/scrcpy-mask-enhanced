#!/usr/bin/env python3
"""scrcpy-mask 屏幕性能监控服务（perf.jsonl）。

读取主程序每秒写入的 perf.jsonl（投屏链路各环节耗时探针 + 帧统计），
通过本地 HTTP + SSE 推送给浏览器实时图表，零第三方依赖（仅标准库）。

与映射性能监控（touch_probe.jsonl，touch_monitor.py，端口 8766）分开，
本服务默认端口 8765。

用法:
    python monitor.py                  # 使用默认数据目录 + 端口 8765
    python monitor.py --dir D:/perf    # 指定 perf.jsonl 所在目录
    python monitor.py --port 9000      # 修改端口
    python monitor.py --no-browser     # 不自动打开浏览器
    数据目录也可在网页「数据路径」卡片中随时修改并持久化（写入 perf_monitor_config.json）。
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HOST = "127.0.0.1"
DEFAULT_PORT = 8765
# 保留最近的数据秒数（时间窗口）
WINDOW_SECONDS = 600
# 探测新行的轮询间隔
POLL_INTERVAL = 0.3
# 单次 snapshot 最多返回的数据行数（超出则均匀降采样，防止前端渲染卡顿）
MAX_SNAPSHOT_ROWS = 300

APP_IDENTIFIER = "com.akichase.scrcpy-mask"


CONFIG_FILE = Path(__file__).resolve().parent / "perf_monitor_config.json"


def load_config_dir() -> Path | None:
    """读取本地保存的数据目录配置（由网页端设置后持久化于此）。"""
    try:
        if CONFIG_FILE.exists():
            data = json.loads(CONFIG_FILE.read_text("utf-8"))
            d = data.get("dir")
            if d:
                return Path(d)
    except Exception:
        pass
    return None


def save_config(data_dir: Path) -> None:
    """持久化数据目录到本地配置文件，重启后依然生效。"""
    try:
        CONFIG_FILE.write_text(
            json.dumps({"dir": str(data_dir)}, ensure_ascii=False, indent=2),
            "utf-8",
        )
    except OSError:
        pass


def default_data_dir() -> Path:
    """兜底默认目录：主程序把 perf.jsonl 写在 `data/` 目录下。

    - debug 构建（cargo run）：data/ 位于项目根（CARGO_MANIFEST_DIR）下；
    - release 构建：data/ 位于 exe 所在目录下。
    仅当网页未配置、也未通过 --dir 指定时才使用；路径可随时在网页内修改。
    """
    script_dir = Path(__file__).resolve().parent  # perf_monitor/
    candidates = [
        # debug：项目根/data （perf_monitor 在项目根下）
        script_dir.parent / "data",
        # release：exe 目录/data （perf_monitor 打包在 exe 的 assets/ 下）
        script_dir.parent.parent / "data",
    ]
    for c in candidates:
        if (c / "perf.jsonl").exists() or (c / "touch_probe.jsonl").exists():
            return c
    return candidates[0]


class PerfStore:
    """轮询 perf.jsonl，维护时间窗口内的探针与帧统计数据。"""

    def __init__(self, perf_file: Path, window: int = WINDOW_SECONDS):
        self.perf_file = perf_file
        self.window = window
        self.rows: deque[dict] = deque()
        self._last_size = 0
        self._listeners: list[queue.Queue] = []
        self._lock = threading.Lock()
        self._start_ts = time.time()

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=256)
        with self._lock:
            self._listeners.append(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            if q in self._listeners:
                self._listeners.remove(q)

    def set_file(self, perf_file: Path) -> None:
        """运行时切换数据文件（网页端修改路径后调用）。"""
        with self._lock:
            self.perf_file = perf_file
            self._last_size = 0
            self.rows.clear()
        self._start_ts = time.time()

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
                if self.perf_file.exists():
                    size = self.perf_file.stat().st_size
                    if size < self._last_size:
                        # 文件被重建/清空，回到开头
                        self._last_size = 0
                    if size > self._last_size:
                        with open(self.perf_file, "r", encoding="utf-8", errors="replace") as f:
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
            self.rows.append(row)
            cutoff = time.time() - self.window
            while self.rows and self.rows[0].get("ts", 0) < cutoff:
                self.rows.popleft()
        self._broadcast(row)

    def snapshot(self) -> dict:
        with self._lock:
            rows = list(self.rows)
        # 行数过多时降采样，避免前端一次渲染上万个点导致卡顿。
        rows = _downsample(rows, MAX_SNAPSHOT_ROWS)
        # 按探针名聚合时间序列
        probes: dict[str, list[dict]] = {}
        for r in rows:
            for p in r.get("probes") or []:
                name = p.get("name", "?")
                probes.setdefault(name, []).append(
                    {
                        "ts": r["ts"],
                        "count": p.get("count", 0),
                        "avg": p.get("avg_ms", 0.0),
                        "p95": p.get("p95_ms", 0.0),
                        "max": p.get("max_ms", 0.0),
                        "value": p.get("value", 0.0),
                    }
                )
        return {
            "now": time.time(),
            "start": self._start_ts,
            "fps": [{"ts": r["ts"], "v": r.get("fps", 0)} for r in rows],
            "delivered": [{"ts": r["ts"], "v": r.get("delivered", 0)} for r in rows],
            "dropped": [{"ts": r["ts"], "v": r.get("dropped", 0)} for r in rows],
            "probes": probes,
        }


STORE: PerfStore | None = None


def _downsample(rows: list[dict], limit: int) -> list[dict]:
    """按 limit 均匀降采样：保留首尾，中间等距抽样，保持曲线整体形状。"""
    n = len(rows)
    if n <= limit:
        return rows
    step = n / limit
    out: list[dict] = []
    for i in range(limit - 1):
        out.append(rows[int(i * step)])
    out.append(rows[-1])  # 始终保留最新一行
    return out


def _sse(data: str, event: str = "message") -> str:
    return f"event: {event}\ndata: {data}\n\n"


class Handler(BaseHTTPRequestHandler):
    server_version = "perf_monitor/1.0"

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
            self._send_json({"ok": True, "file": str(STORE.perf_file)})
        elif path == "/api/config":
            self._send_json({"ok": True, "dir": str(STORE.perf_file.parent)})
        elif path.startswith("/vendor/"):
            self._serve_vendor(path.removeprefix("/vendor/"))
        else:
            self.send_error(404)

    def _serve_vendor(self, rel: str) -> None:
        """提供本地静态资源（如 Chart.js），避免依赖外部 CDN。"""
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
        index = Path(__file__).resolve().parent / "index.html"
        if not index.exists():
            self.send_error(404, "index.html not found next to monitor.py")
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
            # 先推一份快照，让页面打开即有数据
            self.wfile.write(_sse(json.dumps(STORE.snapshot()), "snapshot").encode("utf-8"))
            self.wfile.flush()
            while True:
                try:
                    row = q.get(timeout=15)
                    self.wfile.write(_sse(json.dumps(row)).encode("utf-8"))
                    self.wfile.flush()
                except queue.Empty:
                    # 心跳，避免代理/浏览器断开
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            STORE.unsubscribe(q)

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b""
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except json.JSONDecodeError:
            payload = {}
        if urlparse(self.path).path == "/api/set-path":
            self._set_path(payload)
        else:
            self.send_error(404)

    def _set_path(self, payload: dict) -> None:
        """网页端设置数据目录：切换 perf.jsonl 并持久化到本地配置。"""
        d = (payload or {}).get("dir", "")
        if not d or not isinstance(d, str):
            self._send_json({"ok": False, "error": "缺少 dir 参数"}, status=400)
            return
        p = Path(d.strip())
        fname = STORE.perf_file.name
        # 允许直接粘贴完整 perf.jsonl 路径，自动取父目录（按文件名判断，文件尚未生成也生效）
        if p.name == fname:
            data_dir = p.parent
        else:
            data_dir = p
        perf_file = data_dir / fname
        warning = None
        if not data_dir.exists():
            warning = f"目录不存在：{data_dir}（已记录，主程序写入后将自动出现）"
        save_config(data_dir)
        STORE.set_file(perf_file)
        self._send_json({
            "ok": True,
            "dir": str(data_dir),
            "file": str(perf_file),
            "warning": warning,
        })


def main() -> None:
    global STORE
    parser = argparse.ArgumentParser(description="scrcpy-mask 性能监控服务")
    parser.add_argument("--dir", default=None, help="perf.jsonl 所在目录（默认应用数据目录）")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--host", default=HOST)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    cfg = load_config_dir()
    if cfg is not None:
        data_dir = cfg
    elif args.dir:
        data_dir = Path(args.dir)
    else:
        data_dir = default_data_dir()
    perf_file = data_dir / "perf.jsonl"

    if not perf_file.exists():
        print(f"[perf_monitor] 未找到 {perf_file}")
        print("  主程序运行并写入探针数据后会自动出现；现在先启动页面（将显示等待数据）。")

    STORE = PerfStore(perf_file)
    stop = threading.Event()
    threading.Thread(target=STORE.poll_loop, args=(stop,), daemon=True).start()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{args.host}:{args.port}/"
    print(f"[perf_monitor] 数据文件: {perf_file}")
    print(f"[perf_monitor] 监控页面: {url}")
    if not args.no_browser:
        import webbrowser

        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[perf_monitor] 已停止")
    finally:
        stop.set()
        httpd.server_close()


if __name__ == "__main__":
    main()
