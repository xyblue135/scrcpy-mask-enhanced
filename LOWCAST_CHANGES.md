# LowCast v0.3 源码修改说明

本压缩包基于用户上传的 `src/` 源码目录修改。原上传 ZIP 本身不包含 `Cargo.toml`、`Cargo.lock`、`assets/`、`frontend/`、`build.rs` 等完整工程文件，因此本包保持“源码目录”形式，不伪造缺失的工程文件。

## 已修改

1. **关闭 VSync 优先路径**
   - `src/main.rs`
   - `PresentMode::AutoVsync` → `PresentMode::AutoNoVsync`
   - 优先使用 Immediate，其次 Mailbox；不支持时才回退，避免直接写死 Immediate 带来的兼容性崩溃。

2. **RMX3700 / Qualcomm H.264 默认配置**
   - 默认 `video_codec = H264`
   - 新增 `video_encoder`，默认 `c2.qti.avc.encoder`
   - 默认码率改为 `12_000_000`
   - 默认最大 FPS 改为 `60`

3. **Qualcomm 低延迟编码实验开关**
   - 新增 `qualcomm_low_latency: bool`，默认 `false`
   - 开启后向 scrcpy server 添加：
     `video_codec_options=vendor.qti-ext-enc-low-latency.enable=1`
   - 保留 `video_codec_options` 字符串，可继续追加其它 MediaCodec 参数。

4. **PC 客户端逐帧延迟遥测**
   - 从完整视频包读入后开始记录时间点。
   - 记录：socket receive → FFmpeg submit → decode output → YUV copy → latest-frame slot → UI take → Bevy image update。
   - 每约 60 帧输出一条：`[LowCast][Latency] ...`
   - `client_total` 只代表 PC client pipeline，不包含 Android 编码和 USB/ADB 传输时间。

5. **latest-frame-only 丢帧统计**
   - 保留原项目已有的单槽 latest-frame 机制。
   - 新增 `dropped_frames` / `delivered_frames` 计数。
   - 新帧覆盖尚未显示的旧帧时计为 dropped，避免播放器式 FIFO 排队积累延迟。

6. **保留已有 FFmpeg LOW_DELAY**
   - 原源码已有 `codec::Flags::LOW_DELAY`，未重复重写。

## 修改文件

- `src/main.rs`
- `src/config.rs`
- `src/web/device.rs`
- `src/web/config.rs`
- `src/scrcpy/media.rs`
- `src/scrcpy/connection.rs`
- `src/utils/mod.rs`
- `src/mask/video.rs`

## 当前没有做

- 没有绕过 ADB。
- 没有加入 D3D11VA 硬解/零拷贝。
- 没有直接控制 DXGI `Present(0, ALLOW_TEARING)`；当前仍由 Bevy/WGPU 管理交换链，只是切为 `AutoNoVsync`。
- 没有 Android server 侧每帧时间戳，因为上传包没有 `scrcpy-mask-server` 源码。

这几个部分建议作为下一阶段，在当前 client telemetry 有基准数据后继续做，避免一次重构太多导致无法判断每项优化实际减少了多少毫秒。
