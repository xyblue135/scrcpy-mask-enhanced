//! 轻量性能探针注册表。
//!
//! 设计目标：
//! - 热路径开销极低：只用原子累加，每 `SAMPLE_EVERY` 次调用才采一次样进环形缓冲（用于 p95）。
//! - 每秒由后台任务（见 `main.rs::perf_flush_system`）把全部探针汇总成一行 JSON，
//!   追加写入 `perf.jsonl`，由独立监控程序（`perf_monitor/`）读取并可视化。
//! - 每个探针带 `detail_hint`：当该探针耗时偏高但内部可再细分时，监控页会提示
//!   “应在此处插入更细的探针”，实现“分析太粗 → 标记 → 补点 → 重跑”的闭环。

use std::{
    collections::VecDeque,
    sync::{
        Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    time::Instant,
};

/// 单个探针的聚合状态。
struct Probe {
    desc: &'static str,
    /// 若非空：该探针耗时偏高时可在此细分（提示往哪插更细的探针）。
    detail_hint: &'static str,
    count: AtomicU64,
    sum_nanos: AtomicU64,
    max_nanos: AtomicU64,
    /// 数值型累计量（如读取字节数），每秒随快照清零，可用于吞吐量等。
    value: AtomicU64,
    /// 环形采样缓冲，用于 p95。
    samples: Mutex<VecDeque<u64>>,
}

const SAMPLE_EVERY: u64 = 16;
const SAMPLE_CAPACITY: usize = 128;

struct Registry {
    /// 探针名 -> 探针。`&'static` 借用自 `Box::leak`，引用稳定。
    probes: Mutex<Vec<(&'static str, &'static Probe)>>,
}

static REGISTRY: OnceLock<Registry> = OnceLock::new();

fn registry() -> &'static Registry {
    REGISTRY.get_or_init(|| Registry {
        probes: Mutex::new(Vec::new()),
    })
}

fn ensure_probe(name: &'static str) -> &'static Probe {
    let mut probes = registry().probes.lock().unwrap();
    if let Some((_, p)) = probes.iter().find(|(n, _)| *n == name) {
        return p;
    }
    let probe = Box::leak(Box::new(Probe {
        desc: "",
        detail_hint: "",
        count: AtomicU64::new(0),
        sum_nanos: AtomicU64::new(0),
        max_nanos: AtomicU64::new(0),
        value: AtomicU64::new(0),
        samples: Mutex::new(VecDeque::with_capacity(SAMPLE_CAPACITY)),
    }));
    probes.push((name, probe));
    probe
}

/// 注册探针元数据（名称、描述、细分提示）。重复注册忽略。
/// 应在启动阶段调用 `register_all` 一次性注册全部探针。
pub fn register(name: &'static str, desc: &'static str, detail_hint: &'static str) {
    let mut probes = registry().probes.lock().unwrap();
    if probes.iter().any(|(n, _)| *n == name) {
        return;
    }
    let probe = Box::leak(Box::new(Probe {
        desc,
        detail_hint,
        count: AtomicU64::new(0),
        sum_nanos: AtomicU64::new(0),
        max_nanos: AtomicU64::new(0),
        value: AtomicU64::new(0),
        samples: Mutex::new(VecDeque::with_capacity(SAMPLE_CAPACITY)),
    }));
    probes.push((name, probe));
}

/// 记录一次耗时（纳秒）。热路径安全。
pub fn record(name: &'static str, nanos: u128) {
    let p = ensure_probe(name);
    let nanos = nanos.min(u64::MAX as u128) as u64;
    p.count.fetch_add(1, Ordering::Relaxed);
    p.sum_nanos.fetch_add(nanos, Ordering::Relaxed);
    p.max_nanos.fetch_max(nanos, Ordering::Relaxed);
    let count = p.count.load(Ordering::Relaxed);
    if count % SAMPLE_EVERY == 0 {
        let mut samples = p.samples.lock().unwrap();
        if samples.len() >= SAMPLE_CAPACITY {
            samples.pop_front();
        }
        samples.push_back(nanos);
    }
}

/// 简单计数（如丢帧数、缓冲池未命中次数）。
pub fn incr(name: &'static str) {
    let p = ensure_probe(name);
    p.count.fetch_add(1, Ordering::Relaxed);
}

/// 累加一个数值型指标（如读取的字节数）。快照时随计数一起清零，可用于吞吐量等。
pub fn add_value(name: &'static str, v: u64) {
    let p = ensure_probe(name);
    p.value.fetch_add(v, Ordering::Relaxed);
}

/// 计时守卫：离开作用域时自动 `record` 耗时。可跨 `.await` 持有（记的是墙钟时间）。
pub struct TimerGuard {
    name: &'static str,
    start: Instant,
}

/// 开始计时某段代码：`let _t = perf::timed("xxx");`
pub fn timed(name: &'static str) -> TimerGuard {
    TimerGuard {
        name,
        start: Instant::now(),
    }
}

impl Drop for TimerGuard {
    fn drop(&mut self) {
        record(self.name, self.start.elapsed().as_nanos());
    }
}

fn percentile(samples: &VecDeque<u64>, q: f64) -> u64 {
    if samples.is_empty() {
        return 0;
    }
    let mut v: Vec<u64> = samples.iter().copied().collect();
    v.sort_unstable();
    let idx = ((v.len() as f64 - 1.0) * q).round() as usize;
    v[idx]
}

/// 生成全部探针的 JSON 快照（含元数据），并清零计数（供每秒汇总）。
pub fn snapshot_and_reset_json() -> String {
    let probes = registry().probes.lock().unwrap();
    let mut items = Vec::with_capacity(probes.len());
    for (name, p) in probes.iter() {
        let count = p.count.swap(0, Ordering::Relaxed);
        let sum = p.sum_nanos.swap(0, Ordering::Relaxed);
        let max = p.max_nanos.swap(0, Ordering::Relaxed);
        let value = p.value.swap(0, Ordering::Relaxed);
        let mut samples = p.samples.lock().unwrap();
        let p95 = percentile(&samples, 0.95);
        samples.clear();
        items.push(serde_json::json!({
            "name": name,
            "desc": p.desc,
            "hint": p.detail_hint,
            "count": count,
            "avg_ms": if count > 0 { sum as f64 / count as f64 / 1e6 } else { 0.0 },
            "p95_ms": p95 as f64 / 1e6,
            "max_ms": max as f64 / 1e6,
            "value": value,
        }));
    }
    serde_json::to_string(&items).unwrap()
}

/// 每秒调用一次：把探针快照 + 帧统计追加到 perf.jsonl。
pub fn flush_to_file(file: &std::path::Path, fps: f64, delivered: u64, dropped: u64) {
    let probes: serde_json::Value =
        serde_json::from_str(&snapshot_and_reset_json()).unwrap_or(serde_json::Value::Null);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);
    let line = serde_json::json!({
        "ts": ts,
        "fps": fps,
        "delivered": delivered,
        "dropped": dropped,
        "probes": probes,
    });
    let mut s = serde_json::to_string(&line).unwrap();
    s.push('\n');
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(file)
    {
        use std::io::Write;
        let _ = f.write_all(s.as_bytes());
    }
}

/// 启动时注册全部探针的元数据。
pub fn register_all() {
    register(
        "net.read_packet",
        "读取一包媒体数据（socket，含网络等待）",
        "耗时大头稳定在此；看子探针 read_header / read_data.first / read_data.body 定位",
    );
    register(
        "net.read_header",
        "读取 12 字节帧头（等待服务端推送）",
        "高 = 网络往返/服务端推送间隔，与数据量无关",
    );
    register(
        "net.read_data",
        "读取帧数据体（首块等待 + 持续传输）",
        "可细分 net.read_data.first（首包延迟）与 net.read_data.body（带宽）",
    );
    register(
        "net.read_data.first",
        "读取首个 64KiB 数据块（等待数据到达）",
        "高 = 服务端推送延迟/缓冲；若 body 低说明是延迟不是带宽",
    );
    register(
        "net.read_data.body",
        "读取剩余数据体（持续传输）",
        "高 = 带宽不足或单帧数据量大；配合 read_data.bytes 算 MB/s",
    );
    register(
        "net.read_data.bytes",
        "每秒读取的媒体字节数（吞吐）",
        "除以 read_data 的 avg 可估算有效带宽，判断延迟还是带宽瓶颈",
    );
    register("video.packet_merge", "H264/H265 配置合并", "");
    register("video.decode_submit", "提交编码包到 ffmpeg 解码器", "");
    register(
        "video.decode_receive",
        "ffmpeg 解码输出一帧",
        "解码 CPU 大头在此；可细分 send_packet 与 receive_frame",
    );
    register("video.plane_copy", "YUV 平面拷贝到可复用缓冲", "");
    register("slot.send", "视频帧写入共享槽（锁）", "");
    register("slot.take", "UI 从共享槽取帧（锁）", "");
    register("slot.buffer_hit", "缓冲池复用命中次数", "count 高 = 复用良好");
    register(
        "slot.buffer_miss",
        "缓冲池未命中（新分配次数）",
        "miss 偏高可考虑调大 VIDEO_BUFFER_POOL_LIMIT",
    );
    register("ui.update_textures", "UI 更新 YUV 纹理", "");
    register(
        "ui.frame_time",
        "Bevy 每帧耗时",
        "avg 高 = 渲染/UI 卡顿源；count≈每秒 UI 帧数",
    );
    register(
        "ui.app_sched",
        "Bevy 主循环耗时（First→Last，不含 Present）",
        "高 = Update 系统/主世界调度拖慢；与 present_wait 对比定位尖峰",
    );
    register(
        "ui.present_wait",
        "渲染提交 + Present 等待（frame_time - app_sched）",
        "高 = PresentMode 阻塞等 vblank；考虑 Immediate/Mailbox",
    );
    register("audio.decode", "音频解码/接收一帧", "");
    register("audio.resample", "音频重采样", "");
    register("audio.queue_push", "音频写入播放队列", "");
    register("ws.recv", "处理一条 WS 消息", "");
    register("ws.send", "发送一条 WS 通知", "");
    register(
        "touch.move_filtered",
        "Move 事件被距离阈值过滤掉的次数（per pointer_id）",
        "高 = 抖动/高频微移明显；与 touch_probe.jsonl 行数对比可估算降噪比例",
    );
    register(
        "touch.move_adaptive_filtered",
        "Move 事件被自适应阈值（>1x 用户基线）过滤掉的次数",
        "这部分意味着在静止/抖动场景下系统已自动把阈值放大，命中真实误判的可能性低",
    );
}
