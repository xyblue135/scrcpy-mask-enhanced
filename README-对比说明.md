# Scrcpy Mask Enhanced —— 魔改增强版 vs 最初版本 对比说明

> 本文档详细对比 **「最初版本」（`scrcpy-mask-master`，即上游 `AkiChase/scrcpy-mask` v0.9.0 基线）** 与 **「魔改增强版」（`scrcpy-mask-enhanced`）** 之间的全部差异。
>
> 每一处改动都按 **「增加了什么 / 修改了什么 / 优化了什么 → 好处 → 坏处 / 代价 → 技术要点」** 的结构展开。

---

## 目录

1. [总览：一句话看懂改了什么](#1-总览)
2. [新增功能模块逐项拆解](#2-新增功能模块逐项拆解)
3. [对既有代码的修改与优化](#3-对既有代码的修改与优化)
4. [前端改动](#4-前端改动)
5. [依赖与配置差异](#5-依赖与配置差异)
6. [构建 / 打包 / 环境](#6-构建打包环境)
7. [技术深潜：关键实现原理](#7-技术深潜)
8. [整体收益 vs 代价总结](#8-整体收益-vs-代价总结)

---

## 1. 总览

魔改增强版在**不改变原项目定位**（Rust + Bevy + React 的安卓投屏 + 键鼠映射客户端）的前提下，围绕「**低延迟**」「**可观测性**」「**游戏操作便利性**」三大主题做了系统性增强：

| 主题 | 对应改动 | 一句话总结 |
| --- | --- | --- |
| 低延迟 | `PresentMode::Immediate`、自定义帧管线、scrcpy 预设系统 | 从渲染到编码，全链路压延迟 |
| 可观测性 | `perf.rs` 性能探针 + `perf_monitor/` 监控器 + `LatencyCompare` 延迟对比页 | 把「黑盒延迟」变成「可测量、可定位的指标」 |
| 操作便利性 | `wheel` 轮盘、`movement_assist` 疾跑/潜行、`quick_switch` 预设热切换、`window_state` F11 全屏 | 补齐手游高频操作场景 |

### 文件级精确差异

下表是**文件级差异**的精确对比（✅ = 增强版新增）：

| 目录 | 最初版本 | 增强版 | 净增 |
| --- | --- | --- | --- |
| `src/mask/mapping/` | 16 个 `.rs` | 19 个 `.rs` | ✅ `wheel.rs`、`movement_assist.rs`、`quick_switch.rs` |
| `src/mask/` | 22 个 `.rs`（无 `window_state.rs`） | 26 个 `.rs` | ✅ `window_state.rs` |
| `src/scrcpy/` | 9 个 `.rs` | 10 个 `.rs` | ✅ `launch_options.rs` |
| `src/web/` | 6 个 `.rs` | 7 个 `.rs` | ✅ `upload.rs` |
| `src/` 根 | 无 `perf.rs` | 有 `perf.rs` | ✅ `perf.rs` |
| `perf_monitor/` | 无 | 5 个文件 | ✅ 整个目录新增 |
| `frontend/.../mappings/` | 21 个（17 tsx） | 24 个（19 tsx） | ✅ `ButtonWheel.tsx`、`MacroPresetModal.tsx`、`reservedKeys.ts` |
| `frontend/.../components/` | 无延迟对比、无预设弹窗 | 多 2 个页面 | ✅ `LatencyCompare.tsx`、`ScrcpyModuleModal.tsx` |
| `frontend/src/` 根 | 无 `scrcpyOptions.ts` | 有 | ✅ `scrcpyOptions.ts` |
| `config.example.json` | 无 | 有 | ✅ 新增（含 5 套 scrcpy 预设） |

---

## 2. 新增功能模块逐项拆解

### 2.1 性能探针系统（`src/perf.rs` + `perf_monitor/`）⭐⭐⭐

这是本次改动中**技术含量最高、最能体现工程能力**的部分。

#### 增加了什么

一个**零侵入、热路径极低开销**的性能探针注册表 + 配套的独立可视化监控器：

```
src/perf.rs                      # 探针注册表 + 采样 + 每秒 JSON 快照
perf_monitor/
├── monitor.py                   # 读取 perf.jsonl 并起本地 Web 服务可视化
├── index.html                   # 监控前端（图表）
├── mock_perf.jsonl              # 演示数据
├── mock_data.py                 # 生成演示数据
└── vendor/                      # 前端依赖
```

#### 技术要点（核心实现）

1. **原子化累加，避开热路径锁竞争**：每个 `Probe` 用 `AtomicU64` 存 `count / sum_nanos / max_nanos / value`，`record()` 只做 `fetch_add` 与 `fetch_max`，全程 `Ordering::Relaxed`。这意味着在视频帧接收、解码这些高频热路径上插入探针，几乎不引入额外开销。

2. **降采样环形缓冲算 p95**：不是每次调用都入队（那样会拖慢热路径），而是每 `SAMPLE_EVERY = 16` 次才 `push_back` 一个样本到容量 128 的 `VecDeque`，快照时 `sort_unstable` 取 0.95 分位数。既拿到了长尾延迟（p95），又控制了内存和 CPU 开销。

3. **RAII 计时守卫**：`perf::timed("xxx")` 返回 `TimerGuard`，离开作用域时 `Drop` 自动 `record` 耗时，且可跨 `.await` 持有（记录墙钟时间）。用法极简：`let _t = perf::timed("net.read_packet");`

4. **`detail_hint` 闭环设计**：每个探针带一段「细分提示」，当某探针耗时偏高、监控页会提示「应在此处插入更细的探针」，实现「分析太粗 → 标记 → 补点 → 重跑」的迭代闭环。这是**性能工程里的最佳实践**——探针体系本身可被引导式扩展。

5. **每秒 flush 到 JSONL**：后台 tokio 任务用 `interval(Duration::from_secs(1))` 定时把全部探针快照 + FPS/丢帧统计序列化成一行 JSON，追加写入 `data/perf.jsonl`，`MissedTickBehavior::Skip` 避免任务积压。

探针覆盖了完整的**投屏延迟链路**，每一个环节都能单独定位：

| 探针 | 覆盖环节 |
| --- | --- |
| `net.read_header` / `net.read_data.first` / `net.read_data.body` / `net.read_data.bytes` | 网络接收：区分「首包延迟」与「带宽」 |
| `video.packet_merge` / `video.decode_submit` / `video.decode_receive` | FFmpeg 解码链路 |
| `video.plane_copy` | YUV 平面拷贝 |
| `slot.send` / `slot.take` / `slot.buffer_hit` / `slot.buffer_miss` | 帧共享槽 + 缓冲池命中率 |
| `ui.frame_time` / `ui.app_sched` / `ui.present_wait` | Bevy 渲染：区分「调度耗时」与「Present 等 vblank」 |
| `audio.decode` / `audio.resample` / `audio.queue_push` | 音频链路 |
| `ws.recv` / `ws.send` | WebSocket |

#### 好处

- **把「投屏卡顿」这个模糊问题，变成「网络 / 解码 / 渲染哪个环节慢」的精确诊断**。
- 热路径开销极低（原子 + 降采样），对实际性能几乎无影响。
- 独立 `perf_monitor` 用 Python 起本地服务即可可视化，无需侵入主程序 UI。

#### 坏处 / 代价

- `perf.jsonl` 每秒写一行，长时间运行会持续累积文件（好在写入用户数据目录 `data/`，不污染系统 AppData）。
- 探针名称是**编译期写死 `&'static str`** 的，新增探针需改代码重编译，无法运行时动态注册。
- `Box::leak` 注册的探针永不释放（有意的，换取 `&'static` 稳定引用），对内存有轻微但可忽略的占用。

---

### 2.2 Scrcpy 启动参数 / 预设系统（`src/scrcpy/launch_options.rs`）⭐⭐⭐

#### 增加了什么

一套完整的 **scrcpy server 启动参数「预设（Preset）」体系**，后端 `launch_options.rs` + 前端 `ScrcpyModuleModal.tsx` + `scrcpyOptions.ts` 三端配合：

- **`ScrcpyParameterScope`**：把参数分为 `Server`（真实下发给安卓 scrcpy server）与 `ClientOnly`（仅记录官方桌面客户端参数、不发给安卓）两类。
- **`ScrcpyPreset`**：一个预设 = 视频/音频开关 + 虚拟屏配置 + 参数列表。
- **`ScrcpyVirtualDisplayConfig`**：虚拟屏尺寸/DPI/keep-active/销毁内容/系统装饰/启动应用等完整配置。
- **`ScrcpyModuleConfig`**：模块总开关 + 激活预设 id + 预设数组（最多 32 个，每预设最多 96 个参数）。
- **内置预设**：`qualcomm_hevc_low_latency`（高通 H.265 低延迟）等，`config.example.json` 里预置了 5 套（H.265 低延迟 / H.264 均衡 / 高码率清晰 / 低带宽 / 虚拟屏办公）。

#### 技术要点（核心实现）

1. **安全校验，防止注入**：`validate_value()` 拒绝含空白、控制字符及 `; & | \` $ < > ' "` 等 shell 特殊字符的值，`normalize_key()` 把 key 统一为小写 `snake_case`，杜绝「参数值被拼进 shell 命令导致注入」的风险。

2. **保留键保护**：`RESERVED_SERVER_KEYS` 列出 `scid / video / audio / control / tunnel_forward / new_display / ...` 等由 LowCast（本程序）自己管理的传输级键，用户预设若尝试覆盖会直接 `validate()` 报错——避免「调试参数不小心破坏投屏协议」的坑。

3. **`upsert_server_arg` 去重合并**：同名参数后设覆盖前设，不会产生重复的 `key=value` 段。

4. **前端「命令粘贴 ↔ 预设」双向转换**：`parseCommandIntoPreset` 能把任意 `scrcpy --video-codec=h265 ...` 命令行解析回预设结构（含 `--no-video` 取反、`--new-display=1920x1080/420` 尺寸解析、`8M` 码率单位换算），`commandPreview` 又能把预设还原成命令行——方便用户「从官方 scrcpy 文档抄一条命令直接调优」。

5. **完整参数目录**：`scrcpyOptions.ts` 以 scrcpy 4.0 server 的 `Options.java` 为基线，枚举了 60+ 个参数（视频/摄像头/音频/显示/设备/诊断/客户端七大类），每个带 `label / description / defaultValue / choices / scope`，前端据此渲染成带开关、下拉、`Server`/`Client Only` 标签的可视化编辑器。

6. **单元测试**：`launch_options.rs` 内置了 3 个测试（内置预设匹配目标命令、拒绝传输键覆盖与 shell 字符、虚拟屏构建与包名校验），保证参数合并逻辑的正确性。

#### 好处

- 用户无需手改根目录 `config.json`，在网页控制台即可可视化管理 scrcpy 启动参数，**一键切换预设**（如「打游戏用 H.265 低延迟」「办公用虚拟屏分屏」）。
- 安全边界清晰：`Server` 参数真实生效，`ClientOnly` 参数只用于记录参考，避免误导。
- 内置预设直接面向真实机型（高通平台 H.265 编码器 `c2.qti.hevc.encoder.cq`），开箱即用。

#### 坏处 / 代价

- 增加了配置结构的复杂度（`config.example.json` 从无到 5 套预设，JSON 体积明显增大）。
- 参数目录与 scrcpy 版本强绑定，未来 scrcpy server 升级到 v4.1+ 需同步维护 `scrcpyOptions.ts`。
- 部分诊断参数（`list_encoders` 等）启用后会导致投屏断开，对不了解的新手可能造成困惑（前端已有文案提示）。

---

### 2.3 轮盘操作映射（`src/mask/mapping/wheel.rs`）

#### 增加了什么

一个**专门针对手游「轮盘道具/技能选择」场景**的新映射类型 `BindMappingWheel`（前端 `ButtonWheel.tsx` 对应）。

#### 技术要点

- **交互模型**：按住绑定键 → 拖动鼠标朝某个径向扇区移动 → 松开；触摸点会**跟随光标方向**（被 clamp 到 `radius` 半径内），游戏自身的轮盘菜单就会选中「手指抬起位置」对应的道具。
- **屏幕空间半径换算**：`cal_wheel_target_pos` 把配置里的 `radius`（按原始高度像素）按 `radius / 1000.0 * mask_size.y` 缩放成当前窗口的屏幕空间半径，与施法映射的 `drag_radius` 保持同一套换算逻辑。
- **初始滑动 + 缓动**：`start_wheel` 先发 `Down`，再通过 `spawn_initial_swipe` 生成一次初始滑动（随机化时用 `ArcWithEaseOut` 圆弧缓出策略，否则线性），模拟「手指滑入轮盘」的真实手感。
- **光标捕获归属**：用 `Wheel:{action}` 作为捕获 owner，`cleanup_wheel_on_stop` / `handle_wheel_focus_lost` 会在停止或窗口失焦时释放捕获并补发 `Up`，防止「轮盘卡住不放」。
- **随机化支持**：可配置随机锚点、随机偏移，配合 `anchor_random_offset` 打乱轨迹。

#### 好处

- 把「需要两根手指在屏幕上划轮盘」的高频操作，简化成「鼠标按住拖一下」，显著提升 FPS/TPS 类游戏的物品切换效率。
- 窗口失焦、映射停止时自动清理，不留「僵尸触摸点」。

#### 坏处 / 代价

- 只支持径向轮盘，对「列表式/网格式」道具栏不适用。
- `count`（扇区数）仅做校验（1~8），实际未用于轨迹计算，属于预留字段。

---

### 2.4 移动辅助映射（`src/mask/mapping/movement_assist.rs`）

#### 增加了什么

针对「疾跑（sprint）」与「潜行（stealth）」两个高频移动状态的新辅助逻辑。

#### 技术要点

- **统一状态资源** `MovementAssistState`：用三个 `HashSet<String>` 记录「已锁定的疾跑动作」「等待松开以取消疾跑的动作」「已锁定的潜行动作」。
- **toggle-run 互斥设计**：疾跑与潜行被故意放在同一个 resource 里，让它们**确定性地互相取消**，避免「两个逻辑模式同时生效」的状态混乱。
- **二次按键取消疾跑**：`toggle_run_stop_on_release_actions` 记录「第二次按下疾跑键进入待取消态，真正取消发生在松开时」，从而保证第一次按/松仍可作为**真正的非持续疾跑开关**使用。
- **`cancel_all_stealth`**：开启疾跑时，把当前所有已锁定的潜行映射逐个「再点一次」取消，保证切换状态时屏幕上的潜行按钮状态与 PC 端一致。

#### 好处

- 把「按住 Shift 疾跑」这种需要持续按键的操作，变成「按一下锁定疾跑」，减轻长时间游戏的手指疲劳。
- 状态互斥、确定性取消，杜绝「疾跑和潜行同时生效」的 bug 类问题。

#### 坏处 / 代价

- 状态逻辑较为绕（二次按键语义），可读性需要配合注释理解。
- 依赖「潜行/疾跑」这类映射在游戏里的具体实现，通用性有限。

---

### 2.5 映射预设快捷键切换（`src/mask/mapping/quick_switch.rs`）

#### 增加了什么

全局快捷键**一键切换映射预设文件**（`mapping_quick_switches` 配置 + `handle_mapping_quick_switch` 系统）。

#### 技术要点

- **快捷键匹配**：`keyboard_shortcut` 把配置里的按键名（如 `ControlLeft`、`F1`）解析成 `KeyCode`，要求「组合键全部按住 + 其中至少一个刚按下」才触发（`all_pressed && triggered`）。
- **消费 chord 防误触**：切换成功后 `keys.clear_just_pressed(key)` 清掉该组合键的 `just_pressed`，**防止切换预设的同时又触发游戏里绑定到同一按键的触摸**。
- **拒绝鼠标绑定**：`keyboard_shortcut` 只接受键盘键，`M-Left` 之类鼠标绑定直接返回 `None`（附单元测试）。
- **全局开关**：`LocalConfig::get_quick_switch_enabled()` 关闭时整个系统直接 return，不影响性能。

#### 好处

- 多个游戏/场景用多套映射时，无需打开网页控制台，直接按快捷键切换，游戏体验无感切换。
- 防误触设计避免了「切换预设 = 误点游戏按钮」的恼人问题。

#### 坏处 / 代价

- 快捷键冲突风险：如果预设快捷键和游戏常用键重叠，可能误触发切换（用户需自行规划）。

---

### 2.6 窗口状态管理（`src/mask/window_state.rs`）

#### 增加了什么

把「普通窗口最大化」和「无边框全屏」两个概念**彻底分离并正确管理**。

#### 技术要点

1. **两个独立状态**：`MaskMaximizeState`（普通最大化，保留标题栏与 Windows 任务栏）与 `MaskFullscreenState`（F11 无边框全屏 `BorderlessFullscreen`）。
2. **进入全屏前快照**：`enter_fullscreen` 先保存进入前的窗口 `position / size / titlebar_visible / resizable` 到 `WindowedSnapshot`，并**先退出普通最大化**再进全屏，避免两种窗口状态互相打架。
3. **退出全屏延迟恢复**：`leave_fullscreen` 设置 `transitioning = true` + `restore_after_frames = 2`，`apply_pending_window_restore` 等 Winit 完成 `Windowed` 切换后（2 帧后）再恢复 geometry。
4. **最小化坐标防护**：`is_persistable_window_position` 识别 Windows 最小化时窗口被移到 `(-32000, -32000)` 的临时坐标，避免把这种「假位置」持久化到配置。
5. **窗口持久化抑制**：`suppress_window_persistence()` 在全屏/过渡期返回 true，防止「全屏时的临时 geometry」被写回配置。

#### 好处

- F11 全屏行为始终一致：进入全屏 ↔ 退出回普通窗口，不会出现「时而是全屏时而是最大化」的困惑。
- 修掉了原版「全屏/最大化状态互相覆盖」「最小化后窗口飞到屏幕外」这类经典窗口 bug。

#### 坏处 / 代价

- 退出全屏有 2 帧的恢复延迟（视觉上几乎无感），但确实不是「瞬回」。

---

### 2.7 延迟对比工具（前端 `LatencyCompare.tsx` + Web 截图 API）

#### 增加了什么

一个专门用于**测量和对比投屏延迟**的页面 + 三个后端截图/上传端点。

#### 后端新增 API

| 端点 | 作用 | 技术要点 |
| --- | --- | --- |
| `/api/device/adb_screenshot` | 截图（**改**） | 原版调 `adb shell screencap`，新版改为**直接从 Bevy 解码帧取当前帧转 PNG**，保留原路由名兼容前端 |
| `/api/device/window_screenshot` | PC 窗口截图（**增**） | Windows GDI `BitBlt` 抓取 scrcpy 窗口客户区，保存 PNG，带 `X-PC-Ts-Before/After` 时间戳 header |
| `/api/device/adb_save_screenshot` | 手机截图（**增**） | 手机端 `screencap` 保存到手机 + `adb pull` 拉回，带 `X-Phone-Ts-Before/After`、`X-PC-Ts-Before` 时间戳 header |
| `/api/upload/upload` | 图片上传（**增**，`upload.rs`） | axum `multipart` 接收，校验图片扩展名，存 `data/uploads/`，返回可访问 URL |

#### 前端 `LatencyCompare.tsx`

- 左栏「手机截图」、右栏「窗口截图」，可**同时截取**（`Promise.all` 并行触发）。
- 上传本地图片对比。
- 用 `Alert` 组件显式提示：「截图对比只能感知整体延迟，细分延迟需用 `perf_monitor`」，把「感知延迟」和「精确测量」两个层次讲清楚。

#### 好处

- 用户终于有了一个**直观、可操作的延迟测量工具**，配合时间戳 header 可以粗略估算端到端延迟。
- `/adb_screenshot` 改为取解码帧，**不再需要额外走一次 adb 往返**，截图速度更快、更真实反映当前画面。

#### 坏处 / 代价

- `window_screenshot` 仅 Windows 支持（GDI 抓屏），macOS 上该端点直接返回错误。
- 截图测延迟本质是「人工看两张图对齐」，精度有限（页面也如实提示了需用另一台手机拍两个屏幕）。

---

### 2.8 退出清理 adb 反向隧道（`src/main.rs::on_app_exit`）

#### 增加了什么

程序退出时，遍历本会话创建的所有 `localabstract:scrcpy_*` 反向隧道并 `reverse_remove`。

#### 技术要点

- 监听 Bevy `AppExit` 事件，退出时对 `ControlledDevice::get_device_list_blocking()` 的每个设备执行 `adb reverse --remove`（温和清理，**不杀 adb 服务端**）。
- 避免 adb server 上残留转发，导致「设备端连接和端口一直占用、下次连接异常」。

#### 好处

- 解决「反复连接/断开后端口残留、设备连接卡死」的顽疾。

#### 坏处 / 代价

- 退出时多一次 adb 往返，退出略慢（可忽略）。

---

## 3. 对既有代码的修改与优化

### 3.1 渲染呈现模式改为 `Immediate`（`main.rs`）

```rust
present_mode: PresentMode::Immediate, // LowCast: 显式 Immediate，present 完全不阻塞（可能有撕裂）
```

- **改了什么**：原版走 Bevy 默认的 `AutoVsync`（垂直同步），增强版显式指定 `PresentMode::Immediate`。
- **好处**：`Present` 完全不等待 vblank，**显著降低输入到画面的延迟**，对投屏类应用是核心优化。`perf.rs` 里 `ui.present_wait` 探针正是为了量化这个开销。
- **坏处**：可能出现画面撕裂（tearing），不适合对画面撕裂敏感的观影场景（但对游戏操控场景撕裂可接受）。

### 3.2 配置项扩展（`src/config.rs`）

新增三个配置：

| 配置项 | 类型 | 作用 |
| --- | --- | --- |
| `mapping_quick_switches` | `Vec<MappingQuickSwitch>` | 预设快捷键切换列表（`file` + `enabled` + `shortcut`） |
| `quick_switch_enabled` | `bool` | 全局预设切换开关（关闭时忽略所有快捷键） |
| `macro_preset_enabled` | `bool` | 全局宏预设开关（关闭时宏预设绑定不执行，也控制前端显示） |

- **好处**：全局开关让「快捷键切换」「宏预设」都能一键禁用，避免误触发。
- **坏处**：配置项增多，`config.example.json` 需要同步维护。

### 3.3 视频帧管线优化（`src/mask/video.rs`）

- **改了什么**：视频渲染引入 `VideoViewport`（source_size / offset / size），用 `contain` 缩放算法精确计算黑边偏移，键位映射使用的 `MaskSize` 与实际显示视频区域严格对齐。
- **好处**：键位映射在「有黑边（宽高比不匹配）」时也能精准对位，不会出现「键位偏移」。
- **技术点**：`window_state` 的全屏/最大化状态也接入 `video.rs`，全屏时视频区域重算。

### 3.4 截图源改造（`src/web/device.rs`）

见 [2.7](#27-延迟对比工具前端-latencycomparetsx--web-截图-api)，`adb_screenshot` 从「adb screencap」改为「取当前解码帧」，保留原路由名保证前端兼容。

---

## 4. 前端改动

### 4.1 新增页面

| 组件 | 作用 |
| --- | --- |
| `LatencyCompare.tsx` | 延迟对比页（见 2.7） |
| `ScrcpyModuleModal.tsx` | scrcpy 预设可视化编辑器（见 2.2） |

### 4.2 新增映射编辑器

| 组件 | 作用 |
| --- | --- |
| `ButtonWheel.tsx` | 轮盘映射的配置 UI |
| `MacroPresetModal.tsx` | 宏预设弹窗 |
| `reservedKeys.ts` | 保留键定义（配合 quick_switch） |

### 4.3 新增类型与数据

| 文件 | 作用 |
| --- | --- |
| `scrcpyOptions.ts` | scrcpy 4.0 官方参数目录（60+ 参数定义） |

### 4.4 路由与国际化

- 路由表新增 `LatencyCompare`、`ScrcpyModule` 两个页面。
- i18n 新增 `latencyCompare.*` 等翻译键（多语言）。

---

## 5. 依赖与配置差异

### 5.1 `Cargo.toml` 差异

| 变更 | 最初版本 | 增强版 | 原因 |
| --- | --- | --- | --- |
| `axum` features | `["macros", "ws"]` | `["macros", "ws", "multipart"]` | 支持 `/upload` 文件上传 |
| `png` | 无 | `0.18` | 截图/窗口截图的 PNG 编码 |

> 其余依赖完全一致（Bevy 0.19-rc.2、ffmpeg-next 7.1.0、wgpu 29、axum 0.8.4、tokio、rodio 等），说明增强版**没有引入破坏性依赖升级**，改动是纯增量、低风险的。

### 5.2 `config.example.json`

- **最初版本：无此文件**。
- **增强版：新增**，包含完整的配置骨架 + 5 套 scrcpy 预设（`scrcpyModule.presets`），方便新用户直接参考。

---

## 6. 构建 / 打包 / 环境

> 构建环境与最初版本基本一致（Rust ≥ 1.85、FFmpeg 7.1.2 静态编译、MSYS2、pnpm、ADB platform-tools 等）。以下是增强版需要注意的补充点：

### 环境变量（MSYS2 壳示例）

```powershell
$env:PATH = "C:\msys64\mingw64\bin;" + $env:PATH
$env:PKG_CONFIG_PATH = "...\ffmpeg-7.1.2\ffmpeg-windows-x64\lib\pkgconfig"
$env:FFMPEG_DIR = "...\ffmpeg-7.1.2\ffmpeg-windows-x64"
$env:SCRCPY_MASK_OS = "windows-x64"
```

### 构建顺序

```powershell
.\scripts\build-ffmpeg.sh       # 1. 编译 FFmpeg 静态库（首次，慢）
.\scripts\prepare-adb.ps1       # 2. 打包 adb 到 assets/platform-tools
cd frontend; pnpm install; pnpm build   # 3. 构建前端
cargo build --release           # 4. 构建后端（链接 FFmpeg 静态库）
```

### 运行时文件布局

`assets/` 必须与 exe 同级，包含 `platform-tools/adb.exe`、`web/`、`shaders/`、`locales/`、`overlay/`、`icons/`、`scrcpy-mask-server-v4.0`。

### 常见报错速查

| 报错 | 原因 | 解决 |
| --- | --- | --- |
| `pkg-config command could not be found` | 未执行 env 脚本 / FFmpeg 编译失败 | 重跑编译 + 环境变量脚本 |
| `cl.exe 未找到` | VS Build Tools C++ 组件缺失 | 修复安装 VS 构建工具 |
| FFmpeg 源码下载超时 | 国内网络无代理 | 开启 `127.0.0.1:7890` 代理后重编译 |

---

## 7. 技术深潜

### 7.1 低延迟投屏的完整链路

增强版把投屏延迟拆成可观测的多个环节，每个环节都有对应优化：

```
设备端编码 → (adb 隧道/USB) → 网络接收 → FFmpeg 解码 → YUV 拷贝 → 共享槽 → Bevy 纹理上传 → 渲染 Present
   ↑ 预设系统优化           ↑ perf 探针量化               ↑ 缓冲池复用      ↑ Immediate 不阻塞
```

- **编码端**：`launch_options.rs` 预设可直接指定 `c2.qti.hevc.encoder.cq`（高通低延迟 H.265 编码器）、码率、max_fps，从源头压延迟。
- **接收/解码端**：`perf.rs` 的 `net.*`、`video.*` 探针量化每一步，`slot.buffer_hit/miss` 监控缓冲池复用。
- **渲染端**：`PresentMode::Immediate` + `ui.present_wait` 探针，把「等 vblank」这一常见延迟源暴露出来。

### 7.2 帧共享与缓冲池复用

- `slot.send` / `slot.take` 探针量化「视频线程 → UI 线程」跨线程传帧的锁开销。
- `slot.buffer_hit` / `slot.buffer_miss` 探针监控 YUV 缓冲池复用命中率，miss 偏高提示调大 `VIDEO_BUFFER_POOL_LIMIT`。

### 7.3 无锁 / 低开销并发设计

- **`perf.rs`**：`AtomicU64` + `OnceLock` + `Box::leak`，热路径全程无锁。
- **`LatestVideoFrame`**：`Arc` 共享，`perf_flush_system` 只 clone `Arc`（引用计数 +1）就 move 进后台任务，安全无拷贝。
- **`quick_switch.rs` / `wheel.rs`**：`Arc<AtomicBool>` 做跨异步边界的初始滑动完成标志（`initial_swipe_done`），避免阻塞等待。

### 7.4 安全编码实践

- `launch_options.rs` 的 `validate_value` / `normalize_key` / `RESERVED_SERVER_KEYS`：**从输入源头防御命令注入**。
- `upload.rs`：只允许图片扩展名（png/jpg/jpeg/webp/bmp），且只处理第一个有效图片字段，限制上传面。
- `window_state.rs` 的 `is_persistable_window_position`：防御 Windows 最小化假坐标。

### 7.5 测试覆盖

增强版在关键纯逻辑模块加了**单元测试**（最初版本基本没有）：

- `launch_options.rs`：3 个测试（预设匹配、拒绝非法参数、虚拟屏构建）。
- `quick_switch.rs`：1 个测试（拒绝鼠标绑定）。

> 说明：这些是可独立验证的纯函数逻辑，适合单测；涉及 Bevy ECS / tokio 异步的部分仍依赖集成验证。

---

## 8. 整体收益 vs 代价总结

### 收益（Benefits）

1. **低延迟**：`Immediate` 呈现 + 预设系统 + 解码帧截图，全链路压延迟，投屏更跟手。
2. **可观测性**：`perf` 探针 + `perf_monitor` + `LatencyCompare`，从「感觉卡」到「知道哪里卡」。
3. **操作便利性**：轮盘、疾跑/潜行辅助、快捷键切换预设、F11 全屏，覆盖手游高频场景。
4. **稳定性**：退出清理 adb 隧道、窗口状态正确管理、截图 API 兼容改造。
5. **工程化**：单元测试、安全校验、配置示例文件，代码可维护性更高。

### 代价（Costs）

1. **复杂度上升**：新增 7 个后端文件 + 6 个前端文件 + 5 个 perf_monitor 文件，代码量和心智负担增加。
2. **`perf.jsonl` 磁盘累积**：长时间运行会持续写日志。
3. **平台耦合**：`window_screenshot` 仅 Windows；部分优化（Immediate）以牺牲撕裂为代价。
4. **维护成本**：`scrcpyOptions.ts` 与 scrcpy 版本强绑定，升级需同步。

### 一句话结论

> 最初版本是一个「功能完整、稳定可用」的投屏客户端；魔改增强版把它从「能用」推向「**好用 + 可诊断 + 可调优**」，尤其适合**低延迟竞技手游**和**需要量化延迟的进阶用户**。代价是更高的代码复杂度与部分平台耦合，但对目标用户而言收益远大于成本。

---

*本文档基于对两个版本源码的逐文件对比整理。*
