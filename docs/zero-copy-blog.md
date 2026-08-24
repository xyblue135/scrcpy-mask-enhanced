# 投屏零拷贝链路：scrcpy-mask-enhanced 的视频低延迟实现剖析

> 作者：xyblue135 · 2026-08-24
>
> 本文基于 `scrcpy-mask-enhanced`（Bevy + Rust + FFmpeg 的安卓投屏键鼠映射工具）的真实源码，讲解视频从手机屏幕到 PC 窗口的整条链路上，"零拷贝"思想是如何落地、在哪里落地、又在哪里妥协的。

---

## 一、背景：为什么投屏要谈"零拷贝"

投屏的本质是"低延迟观看 + 低延迟操控"。游戏里帧与帧之间，每一毫秒都在影响手感：

- 手机屏幕 90/120fps，意味着画面每 8~11ms 就换一张；
- 传输一帧 1080p 的 H.265 数据，网络层、解码层、渲染层各要"摸"一遍内存；
- 任何一层多做一次**整帧拷贝**（几 MB），都会吃掉 CPU 带宽并制造延迟尖峰。

经典的"零拷贝"（zero-copy）并不要求绝对不拷贝，而是追求 **"不拷贝能省就省，必须拷贝时尽量复用"**。本项目围绕这个目标做了四件关键事：

1. **最新帧单槽覆盖**——不做渲染队列，过期帧直接丢弃；
2. **平面缓冲池**——Y/U/V 数据内存循环复用，避免每帧 `malloc`；
3. **所有权转移**——帧缓冲在解码线程、共享槽、渲染纹理之间靠 `move` 流动，不 `memcpy`；
4. **D3D11VA 硬解 + LOW_DELAY**——把最贵的解码从 CPU 搬走。

---

## 二、视频链路全景

一帧画面从手机屏幕到 PC 窗口，经历 8 个环节：

```
┌──────────┐  socket  ┌───────────────┐  crossbeam  ┌──────────────┐
│ 手机屏幕  │ ───────▶ │  网络读取线程   │ ──────────▶ │  解码线程      │
└──────────┘          │ read_media_    │  (有界队列)  │ video_decode_ │
                      │ packet         │            │ loop          │
                      └───────────────┘            └──────┬───────┘
                                                          │ 解码出 AVFrame
                                                          ▼
┌──────────┐  move    ┌───────────────┐  平面复制(1次)  ┌──────────────┐
│ Bevy 渲染 │ ◀────── │  最新帧槽       │ ◀───────────── │ 缓冲池借出    │
│ Image    │ replace  │ LatestVideo   │   Y/U/V Vec    │ Vec<u8>      │
│ .data    │ Image.data│ Frame         │                │              │
└──────────┘          └───────┬───────┘                └──────────────┘
                              │ 旧帧平面缓冲 回池
                              ▼
                       ┌──────────────┐
                       │  平面缓冲池    │ (最多 12 份)
                       │  take/recycle │
                       └──────────────┘
```

核心代码位置：

| 环节 | 位置 |
|---|---|
| 网络读取 | `src/scrcpy/media.rs` → `read_media_packet` |
| 包合并 | `src/scrcpy/media.rs` → `PacketMerger` |
| 解码 | `src/scrcpy/connection.rs` → `video_decode_loop` / `drain_video_decoder` |
| 缓冲池/最新帧槽 | `src/utils/mod.rs` → `LatestVideoFrame` |
| 渲染消费 | `src/mask/video.rs` → `handle_video_msg` / `replace_image_data` |

---

## 三、关键设计一：最新帧单槽覆盖（Latest-Frame-Only）

传统播放器用**队列**缓冲帧，天然引入延迟。投屏场景下"看最新的"远比"按序播完"重要——晚到的旧帧毫无意义。

`src/utils/mod.rs` 里的 `LatestVideoFrame` 是一个**单槽**容器：

```rust
pub struct LatestVideoFrame {
    inner: Arc<LatestVideoFrameInner>,
}

struct LatestVideoFrameInner {
    slot: Mutex<Option<VideoMsg>>,      // 单槽：永远只保存最新一帧
    buffers: Mutex<Vec<Vec<u8>>>,       // 平面缓冲池
    dropped_frames: AtomicU64,          // 被覆盖丢弃的帧计数
    delivered_frames: AtomicU64,        // 送达渲染层的帧计数
}

pub fn send(&self, mut msg: VideoMsg) {
    let old_msg = self.inner.slot.lock().unwrap().replace(msg);
    if old_msg.as_ref().is_some_and(VideoMsg::is_video_frame) {
        self.inner.dropped_frames.fetch_add(1, Ordering::Relaxed);
    }
    self.recycle_msg(old_msg);          // 旧帧缓冲立即回池，绝不丢弃内存
}

pub fn take(&self) -> Option<VideoMsg> {
    let msg = self.inner.slot.lock().unwrap().take();
    if msg.as_ref().is_some_and(VideoMsg::is_video_frame) {
        self.inner.delivered_frames.fetch_add(1, Ordering::Relaxed);
    }
    msg
}
```

要点：

- **`replace` 而非 push**：新帧直接把旧帧顶掉，天然不积压，解码再快也不会有队列延迟；
- **`dropped_frames` 计数器**：被覆盖的帧数被记录下来，供 `perf.jsonl` 探针评估"渲染层跟不跟得上"；
- **旧帧内存回池**：被顶掉的帧不是 `drop` 释放，而是把 Y/U/V 平面缓冲送回池子循环再用（见下一节）。

> 一句话：**用"覆盖"代替"排队"，用"回池"代替"释放"。**

---

## 四、关键设计二：平面缓冲池（Buffer Pool）

解码器每帧输出的 YUV 数据量很大：1080p 的 YUV420 仅 Y 平面就约 200 万字节。如果每帧重新 `Vec::new` + 分配，GC 压力和分配器抖动都会变成延迟毛刺。

`LatestVideoFrame` 内部维护一个最多 12 份的缓冲池：

```rust
const VIDEO_BUFFER_POOL_LIMIT: usize = 12;

pub fn take_buffer(&self, size: usize) -> Vec<u8> {
    let mut buffers = self.inner.buffers.lock().unwrap();
    let Some(index) = buffers.iter().position(|b| b.capacity() >= size) else {
        crate::perf::incr("slot.buffer_miss");   // 池未命中才新分配
        return vec![0; size];
    };
    crate::perf::incr("slot.buffer_hit");
    let mut buffer = buffers.swap_remove(index);
    if buffer.len() != size {
        buffer.resize(size, 0);
    }
    buffer
}

pub fn recycle_buffer(&self, buffer: Vec<u8>) {
    let mut buffers = self.inner.buffers.lock().unwrap();
    if buffers.len() < VIDEO_BUFFER_POOL_LIMIT {
        buffers.push(buffer);                    // 回池复用
    }
}
```

解码端从池子里"借"出 Y/U/V 三块缓冲，填好数据后作为 `VideoMsg` 发出去；渲染端用完后又"还"回池子。配合探针 `slot.buffer_hit` / `slot.buffer_miss`，可以量化池子的命中率。

> 一句话：**把"每帧分配/释放"变成"借出/归还"，分配次数趋近于 0。**

---

## 五、关键设计三：所有权转移（Move 代替 Memcpy）

这是最体现"零拷贝"思想的部分。跨线程传帧时，缓冲的**所有权**在整个生命周期里被反复 `move`，全程没有 `clone`：

1. **网络线程**：`read_media_packet` 直接 `vec![0u8; len]` 从 socket 读入，`MediaPacket` 持有这块内存；
2. **解码线程**：`MediaPacket.data` 转成 FFmpeg `Packet`，解码出 `AVFrame`；
3. **平面复制**：`copy_plane` 把 AVFrame 的 Y/U/V 平面复制进池子借出的 `Vec<u8>`（这是"必要的一次拷贝"，原因见第八节）；
4. **发送**：三个 `Vec<u8>` 以 `VideoMsg::Yuv420p { y, u, v, .. }` **move** 进最新帧槽；
5. **渲染消费**（`src/mask/video.rs`）：

```rust
fn replace_image_data(
    images: &mut Assets<Image>,
    handle: &Handle<Image>,
    data: Vec<u8>,
    v_rx: &ChannelReceiverV,
) {
    if let Some(mut image) = images.get_mut(handle) {
        if let Some(old_data) = image.data.replace(data) {   // 整体替换，零拷贝
            v_rx.0.recycle_buffer(old_data);                 // 旧数据回池
        }
    }
}
```

Bevy 的 `Image.data` 被**整体替换**成新帧的 `Vec<u8>`——渲染器直接拿着这块内存上传 GPU，没有在纹理对象上再做一次 `memcpy`；被换下来的旧数据立即回池。

> 一句话：**从"槽"到"纹理"，帧数据全程只被移动、从不被复制。**

---

## 六、关键设计四：PacketMerger 包合并

scrcpy 协议的 H.264/H.265 流里，**编解码器配置包（SPS/PPS）**与首帧数据是分开发送的，但 FFmpeg 解码器要求"配置紧跟帧数据"。`PacketMerger` 负责把两者粘成**一个包**：

```rust
pub struct PacketMerger { config: Option<Vec<u8>> }

pub fn merge(&mut self, media_packet: MediaPacket) -> Option<Packet> {
    if media_packet.is_config {
        self.config = Some(media_packet.data);   // 缓存配置包
        return None;
    }
    let Some(config_data) = self.config.take() else {
        return Some(media_packet.into_ffmpeg_packet());   // 非首帧：直接转包
    };
    let mut merged_data = Vec::with_capacity(config_data.len() + media_packet.data.len());
    merged_data.extend_from_slice(&config_data);          // 仅首帧发生一次合并
    merged_data.extend_from_slice(&media_packet.data);
    Some(MediaPacket::ffmpeg_packet(merged_data, media_packet.pts, media_packet.is_key_frame))
}
```

注意：**合并只发生在首帧**，后续帧走 `into_ffmpeg_packet()` 直接转包，没有额外拷贝。这是对"极小代价换协议正确性"的典型取舍。

---

## 七、关键设计五：D3D11VA 硬解 + LOW_DELAY

解码是整条链路里 CPU 开销最大的环节，硬解能把它从 CPU 卸载到 GPU。

`src/scrcpy/media.rs` 的 `open_video_decoder`：

- Windows + H.264/H.265 时**优先尝试** D3D11VA 硬件解码（`av_hwdevice_ctx_create` + `hw_device_ctx`）；
- 任一环节失败自动**回退软件解码**，保证可用性；
- 两种路径都强制 `LOW_DELAY` flag，让解码器尽快输出帧而不是为压缩率攒帧：

```rust
fn set_low_delay_flag(codec_context: &mut codec::Context) {
    let flags = /* 取当前 flags */ | codec::Flags::LOW_DELAY;
    codec_context.set_flags(flags);
}
```

需要坦白的一点：本项目的硬解输出（D3D11VA 纹理帧）会被 `av_hwframe_transfer_data` **下载回 CPU**（NV12），并没有直接走 GPU 纹理直通。原因是渲染端（Bevy）需要 CPU 侧数据上传自己的纹理。也就是说：

> **GPU 直通零拷贝在本项目里没有实现，硬解的价值主要体现在"降低 CPU 解码负载、削减解码耗时"上，帧数据仍需一次 GPU→CPU 下载。**

---

## 八、诚实面对：哪些拷贝"省不掉"

"零拷贝"从来不是玄学。这条链路里仍然存在几个**必须的**拷贝点，理解它们能帮你判断优化的边界：

| 拷贝点 | 原因 | 能否避免 |
|---|---|---|
| socket → `Vec<u8>` | 网络数据必须落进用户态内存 | 否（除非 `recvmmsg`/DMA 类方案） |
| `Packet::copy(&data)` | FFmpeg API 需要把包拷入自己的缓冲 | 否（FFmpeg 约束） |
| SPS/PPS 合并（仅首帧） | 协议分包与解码器期望不一致 | 否，但仅一次 |
| `copy_plane`（AVFrame → Vec） | 解码输出内存布局与渲染需要的布局/对齐不同 | 否（当前设计），可考虑解码器直接输出到目标布局 |
| 硬解帧 GPU→CPU 下载 | Bevy 纹理上传需要 CPU 数据 | 可改进：`wgpu` 侧 D3D11 共享纹理直通 |

**被省掉的，恰恰是历史上最容易浪费的三块**：每帧的堆分配、帧队列的积压、以及跨线程/跨模块的整帧复制。

---

## 九、可观测性：探针怎么"看着"延迟

零拷贝做得对不对，要用数据说话。每帧都携带 `VideoFrameTrace`，记录它经过每个环节的墙钟时间：

```rust
pub struct VideoFrameTrace {
    pub socket_received_at: Instant,   // 网络收到
    pub decode_submitted_at: Instant,  // 提交解码
    pub decode_output_at: Option<Instant>, // 解码输出
    pub copy_finished_at: Option<Instant>, // 平面复制完成
    pub queued_at: Option<Instant>,    // 进入最新帧槽
    pub ui_taken_at: Option<Instant>,  // UI 线程取走
    pub ui_ready_at: Option<Instant>,  // 纹理就绪
}
```

配合 `perf_monitor/monitor.py`，可以看到 `video.decode`、`video.plane_copy`、`video.hw_transfer`、`slot.send`、`slot.take`、`slot.buffer_hit/miss`、`slot.dropped_frames` 等探针的 avg/p95/max 曲线。比如：

- `slot.buffer_miss` 频繁 → 缓冲池容量或命中策略需要调整；
- `slot.dropped_frames` 持续增长 → 渲染层跟不上，需要看 `ui.frame_time` 或降分辨率。

---

## 十、总结

这个项目的"零拷贝"，本质是**一套为低延迟投屏定制的内存管理策略**：

1. **覆盖优于排队**——最新帧单槽，天然零积压延迟；
2. **复用优于分配**——Y/U/V 平面缓冲池，消灭每帧堆分配；
3. **移动优于复制**——帧缓冲从解码线程一路 `move` 到渲染纹理，全程零整帧 `memcpy`；
4. **硬件优于软件**——D3D11VA 硬解 + LOW_DELAY，降低 CPU 侧最贵的开销；
5. **数据优于猜测**——每帧 8 个时间探针 + 命中/丢弃计数器，让每次优化都有依据。

如果你也想给自己的音视频/游戏工具做低延迟，可以照着这五条对照自己的链路：**"有没有在排队？有没有在重复分配？有没有在复制？有没有能搬去硬件的？有没有在测量？"**

> 附：相关源码位置
> - 单槽/缓冲池：`src/utils/mod.rs`（`LatestVideoFrame`）
> - 网络读取/包合并/解码器：`src/scrcpy/media.rs`
> - 解码循环：`src/scrcpy/connection.rs`（`video_decode_loop`、`drain_video_decoder`）
> - 渲染消费/纹理替换：`src/mask/video.rs`（`handle_video_msg`、`replace_image_data`）
