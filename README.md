#scrcpy-mask-enhanced-xyblue

>scrcpy-mask-enhanced-xyblue 是基于 **scrcpy-mask** 的 Windows 低延迟增强分支。  
> 在保留原有键鼠映射、脚本系统、虚拟屏与 Web 配置能力的基础上，重点增强了 **Qualcomm 设备视频参数、Windows 全屏/最大化与等比例显示、虚拟屏应用生命周期、键位编辑体验，以及自动跑、静步和可视化宏预设等手游键鼠功能**。

---

## 项目定位

LowCast Enhanced 并不是重新实现一套 scrcpy，也不是替代原项目的键鼠映射框架。

项目整体关系可以理解为：

```text
scrcpy
  ↓
scrcpy-mask
  ↓
LowCast Enhanced
```

其中：

- **scrcpy** 提供 Android 屏幕捕获、编码、传输与控制能力。
- **scrcpy-mask** 在此基础上提供了键鼠映射、脚本、虚拟屏、Web 配置等完整功能。
- **LowCast Enhanced** 主要针对 Windows、Qualcomm / realme 设备以及低延迟手游投屏场景进行进一步增强。

本仓库建议以：

```text
scrcpy-mask-src
```

作为原作者功能基线，以：

```text
dev
```

作为scrcpy-mask-enhanced-xyblue 的主要开发分支。

---

# 主要增强内容

## 1. Windows 低延迟视频优化

LowCast Enhanced 对视频参数进行了更偏向低延迟游戏场景的调整。

主要包括：

- Windows 渲染由 `AutoVsync` 调整为 `AutoNoVsync`
- 默认使用 H.264
- 针对 Qualcomm 设备支持指定硬件编码器
- 默认推荐：

```text
c2.qti.avc.encoder
```

- 默认视频码率调整为：

```text
12 Mbps
```

- 默认帧率上限：

```text
60 FPS
```

- 支持页面调整：
  - 跟随设备 / 不限制
  - 30 FPS
  - 60 FPS
  - 90 FPS
  - 120 FPS
  - 自定义 FPS
- 支持自定义 Video Encoder
- 支持 Codec Options
- 增加 Qualcomm Low Latency 实验开关

需要说明：

> FPS 设置是视频编码帧率上限，并不会关闭手机自身的动态刷新率机制。

---

## 2. PC 端视频延迟观测

在原有低延迟视频链路基础上增加了客户端延迟追踪能力，用于后续继续优化。

可以观察类似：

```text
Socket Receive
      ↓
Decoder Submit
      ↓
Decode
      ↓
YUV Copy
      ↓
Latest Frame Slot
      ↓
UI Take
      ↓
Texture Update
```

并统计：

- Decode 延迟
- Copy 延迟
- UI Wait
- Client Total
- Delivered Frames
- Dropped Frames

该功能主要用于性能分析，不改变 scrcpy-mask 原有的 latest-frame-only 思路。

---

# Windows 窗口体验优化

## 3. F11 真全屏

现在：

```text
F11
```

进入真正的无边框全屏模式。

与普通 Windows 最大化完全分离。

---

## 4. 普通 Windows 最大化

右上角最大化按钮使用正常 Windows 最大化行为：

```text
窗口最大化
↓
保留 Windows 任务栏
```

而不是进入 F11 全屏。

因此：

```text
右上角最大化 ≠ F11
```

---

## 5. 保持视频原始比例

原来的窗口铺满方式可能会造成手机画面拉伸。

LowCast Enhanced 改为等比例缩放：

```text
手机画面
↓
按原始宽高比放大
↓
无法填满的位置显示黑边
```

例如：

```text
┌─────────────────────────────┐
│           黑边              │
│   ┌─────────────────────┐   │
│   │                     │   │
│   │      手机画面       │   │
│   │                     │   │
│   └─────────────────────┘   │
│           黑边              │
└─────────────────────────────┘
```

同时对以下坐标进行了同步修正：

- 普通鼠标
- FPS 鼠标
- 虚拟鼠标
- 键位映射标签
- 黑边偏移后的触摸位置

避免出现：

> 画面比例正确，但鼠标点击位置偏移。

---

## 6. Windows `-32000` 最小化坐标修复

Windows 最小化窗口时可能临时使用类似：

```text
-32000, -32000
```

的特殊窗口坐标。

原逻辑可能将这个坐标保存到配置，导致下一次启动窗口出现在屏幕外。

LowCast Enhanced 增加了异常坐标保护：

- 不保存 Windows 最小化特殊坐标
- 不保存异常极小窗口尺寸
- F11 / 最大化状态不覆盖普通窗口尺寸
- 已污染的异常位置可以恢复到正常坐标

---

# 虚拟屏增强

## 7. 指定包名启动应用

原 scrcpy-mask 已支持基础虚拟屏。

LowCast Enhanced 在此基础上增加：

```text
创建虚拟屏
↓
建立 scrcpy Control Socket
↓
START_APP
↓
指定 Android 包名
↓
直接进入应用
```

例如：

```text
com.example.game
```

这主要用于解决部分手机 ROM：

> 虚拟屏创建成功，但无法从虚拟桌面正常打开应用。

尤其适用于部分 realme / Android 设备。

---

## 8. 可选 Force Stop

虚拟屏应用启动支持：

```text
Start App
Force Stop
```

两种行为。

默认推荐：

```text
Start App   ON
Force Stop  OFF
```

避免每次进入虚拟屏都强制杀死并重新加载应用。

---

## 9. 虚拟屏常驻与应用状态保持

为了减少：

```text
退出虚拟屏
↓
Virtual Display 被销毁
↓
重新进入
↓
App 冷启动
```

LowCast Enhanced 增加：

```text
keep_active=true
vd_destroy_content=false
```

目标是：

- Alt + Tab 不销毁虚拟屏
- 最小化不销毁虚拟屏
- F11 切换不销毁虚拟屏
- 普通最大化不销毁虚拟屏
- 打开设置不主动销毁虚拟屏
- 尽可能保留 Android App Task

只有真正断开设备、关闭会话或异常重连时才需要重新创建 Virtual Display。

---

# 键位映射背景截图修复

## 10. 不再依赖 ADB Screencap

原方案：

```text
刷新键位背景
↓
adb screencap
↓
SurfaceFlinger Display
```

在部分 realme / Android 设备上会出现：

```text
当前投屏：虚拟屏
刷新背景：主屏
```

LowCast Enhanced 最终改为：

```text
刷新键位背景
↓
读取 LowCast 当前显示的视频帧
↓
YUV → RGB
↓
PNG
↓
作为键位映射背景
```

因此：

```text
当前显示主屏
→ 背景就是主屏

当前显示虚拟屏
→ 背景就是虚拟屏
```

同时：

- 不依赖 ROM 的 `screencap -d`
- 不需要重新通过 ADB pull PNG
- F11 / 最大化产生的黑边不会被截入背景
- PNG 转换只在点击刷新时执行
- 不会每帧额外产生截图开销

---

# 键鼠映射增强

## 11. 键盘映射总开关

增加：

```text
启用键盘映射
```

默认开启。

关闭后会真正停止映射状态，而不是只隐藏 UI。

配置会保存，下次启动继续保持用户选择。

---

## 12. 键位位置锁定 / 拖动调整

原项目实际上存在长按后拖动的能力，但交互不够明显。

LowCast Enhanced 增加显式模式：

```text
🔒 位置锁定
🔓 拖动调整
```

默认：

```text
位置锁定
```

需要调整布局时：

```text
解锁
↓
鼠标直接拖动键位
↓
更新 XY
```

无需：

```text
删除键位
↓
重新创建
↓
重新绑定
```

方向轮盘等复杂映射会整体移动中心位置。

---

# 移动辅助功能

## 13. 方向轮盘（非按住跑步）

基于原有 Direction Pad 的向上延长能力增加新的自动跑模式。

最终逻辑：

```text
第一次按 Shift
→ 开启自动跑

松开第一次 Shift
→ 继续保持自动跑

A
→ 不取消

D
→ 不取消

S
→ 立即取消
```

如果希望使用 Shift 取消：

```text
再次按下 Shift
↓
松开这次 Shift
↓
取消自动跑
```

因此移动时可以：

```text
W + Shift
↓
进入自动跑
↓
松开 Shift
↓
继续前进
↓
A / D 调整方向
```

而不需要一直按住 Shift。

---

## 14. 静步按键

增加新的静步映射类型。

例如：

```text
静步键：Ctrl
静步坐标：X / Y
```

第一次：

```text
Ctrl
↓
点击手机静步按钮
↓
静步 ON
```

再次按：

```text
Ctrl
↓
再次点击
↓
静步 OFF
```

同时支持自定义取消键。

例如：

```text
W
A
S
D
Shift
```

其中任意一个按下时都可以取消静步。

取消逻辑仍然是：

```text
再次点击手机静步按钮
```

适配手游中常见的 Toggle 静步按钮。

---

## 15. 自动跑与静步冲突管理

新增独立 Movement Assist 状态，用来协调：

```text
自动跑
静步
```

两种状态。

默认互斥：

```text
静步 ON
↓
进入自动跑
↓
先关闭静步
↓
自动跑 ON
```

反过来：

```text
自动跑 ON
↓
开启静步
↓
先关闭自动跑
↓
静步 ON
```

避免出现两个逻辑状态同时保持的问题。

---

# 可视化宏预设

## 16. 顶部宏预设

原 scrcpy-mask 已经拥有 Script 脚本执行系统。

LowCast Enhanced 没有重复实现一套脚本引擎，而是在原有 Script 之上增加了：

```text
⚡ 宏预设
```

可视化编辑器。

例如：

```text
宏名称：
跳跃 + 技能

触发键：
Numpad4

动作：
1. 跳跃
2. 等待 60ms
3. 技能
```

最终执行：

```text
Numpad4
↓
跳跃
↓
等待 60ms
↓
技能
```

---

## 17. 宏动作类型

目前宏预设支持：

- 引用已有键位
- 指定坐标点击
- 指定坐标长按
- Wait / 延迟
- 动作顺序调整
- 删除动作
- 防止执行中的宏重复叠加

其中：

> 引用已有键位时，会在保存时读取当前键位的 XY。

因此如果之后：

```text
拖动“跳跃”键位
```

宏重新保存时可以继续使用新的位置，而不需要手动重新填写坐标。

---

# 设置页面重构

原项目设置能力较多，但页面主要以连续配置项展示。

LowCast Enhanced 将设置重新分组：

```text
设置

├─ 基础 / 窗口
├─ 键盘映射
└─ 连接 / 高级

左侧独立页面

└─ Scrcpy 预设 / 完整参数调试中心
   ├─ 视频与音频通道
   ├─ 虚拟屏幕与应用启动
   ├─ scrcpy 4.0 Server 参数
   ├─ Client Only 参数记录
   └─ 可编辑命令导入 / 预览
```

- 设置页只保留通用窗口、键位映射和连接设置
- 所有 scrcpy 视频、音频、设备行为与虚拟屏参数集中在预设页
- 参数调试与日常设置拥有明确边界

---

# scrcpy 参数预设模块

左侧边栏新增独立的“Scrcpy 预设”页面，作为“关于 scrcpy / 完整参数调试中心”，用于把媒体通道、scrcpy 参数、虚拟屏幕和应用启动行为保存成可复用预设。设置页不再重复显示虚拟屏幕、视频、音频和设备行为参数。

内置的 Qualcomm H.265 低延迟示例等价于：

```text
scrcpy --video-codec=h265 --video-encoder=c2.qti.hevc.encoder.cq --video-bit-rate=5M --max-fps=60 --no-audio --mouse=uhid --video-buffer=0
```

其中：

- `video_codec`、`video_encoder`、`video_bit_rate`、`max_fps` 会覆盖对应 scrcpy server 参数。
- `--no-audio` 由预设中的音频开关控制。
- `mouse=uhid` 与 `video_buffer=0` 属于官方桌面客户端参数，在 LowCast 中标记为 `Client Only`，只用于预览和记录；LowCast 使用自己的键鼠控制与 latest-frame-only 视频管线。
- 参数模块默认启用；关闭后使用 scrcpy 默认值，不附加视频、音频、虚拟屏或设备行为等可选调试参数（LowCast 建立连接所需的 server 版本和 `scid` 仍由程序管理）。
- 可以新建、复制、删除预设，并逐项启用、禁用、新增或编辑参数。
- 命令预览可以直接编辑；粘贴别人的 `scrcpy ...` 命令后可解析到当前预设，支持 `--参数=值` 与 `--参数 值` 两种常见写法。
- 参数目录以 scrcpy 4.0 server `Options.java` 为基线，分成视频、摄像头、音频、显示、设备、诊断和 Client Only 七组。
- 每套预设独立保存虚拟屏开关、尺寸、DPI、Keep Active、内容销毁策略、系统装饰、启动包名和 Force Stop。
- `scid`、控制通道、隧道方向和流元数据等 LowCast 协议参数由程序管理，不能在预设里覆盖。
- 自定义 Server 参数会在保存时校验，禁止覆盖连接标识等关键传输参数，也禁止包含 shell 注入字符。
- 参数在下一次连接或重新连接设备时生效。

---

# 原作者已有能力说明

为了明确项目归属，以下能力属于 scrcpy-mask 原有设计，并非scrcpy-mask-enhanced-xyblue 从零实现：

## FFmpeg LOW_DELAY

原项目已经启用 FFmpeg：

```text
LOW_DELAY
```

LowCast Enhanced 保留这一能力。

---

## Latest Frame Only

原项目已经使用 LatestVideoFrame 单槽设计：

```text
新视频帧
↓
替换尚未显示的旧 Pending Frame
```

LowCast Enhanced 主要增加：

- Dropped Frame 统计
- Delivered Frame 统计
- 视频阶段延迟追踪

而不是重新发明 latest-frame-only。

---

## 基础虚拟屏

原项目已经支持：

- New Display
- Width
- Height
- DPI

LowCast Enhanced 增强的是：

- START_APP
- 应用包名
- Force Stop
- Keep Active
- App Task 保留
- 虚拟屏截图修复
- realme / Android ROM 兼容性

---

## Script 脚本系统

Script 执行器本身属于 scrcpy-mask 原有功能。

LowCast Enhanced 新增的是：

> 面向普通用户的可视化“宏预设”管理层。

---

# 推荐配置

针对 Qualcomm / realme 低延迟游戏投屏，可从以下配置开始测试：

```text
Video Codec:
H.264

Video Encoder:
c2.qti.avc.encoder

Bitrate:
12 Mbps

FPS:
60

Video Buffer:
低延迟模式

Audio:
按需求开启

Qualcomm Low Latency:
实验性，根据设备实际情况测试
```

如果设备、编码器、USB 和 PC 性能足够，可以继续测试：

```text
90 FPS
120 FPS
```

不建议单纯认为 FPS 越高延迟一定越低，应结合：

- 手机编码延迟
- 手机发热
- USB 带宽
- PC 解码
- Dropped Frames
- Client Latency

综合判断。

---

# 构建

## 前端

如果修改了：

```text
frontend/
```

先执行：

```powershell
cd frontend
pnpm install
pnpm build
```

前端构建结果会输出到项目使用的 Web 静态资源目录。

---

## Rust

回到项目根目录：

```powershell
cargo run
```

`cargo run` 会自动检查 Rust 源码是否需要重新编译：

```text
需要编译
→ build
→ run

不需要重新编译
→ 直接运行已有 debug 程序
```

因此开发阶段一般不需要先：

```powershell
cargo build
```

再：

```powershell
cargo run
```

---

## Release

发布版本建议：

```powershell
cargo build --release
```

或使用仓库已有的构建 / 打包脚本。

---

# 分支说明

建议：

```text
scrcpy-mask-src
```

保留为原作者功能基线。

```text
dev
```

作为scrcpy-mask-enhanced-xyblue 的主要开发分支。

在新增功能或重构时，可以通过：

```bash
git diff scrcpy-mask-src..dev
```

持续确认：

- 哪些是原项目能力
- 哪些是scrcpy-mask-enhanced-xyblue 新增功能
- 哪些是 Bug 修复
- 哪些是性能优化

---

# 项目方向

LowCast Enhanced 当前重点不是增加大量与投屏无关的功能，而是围绕以下几个方向继续迭代：

```text
更低的视频延迟
+
更稳定的 Windows 显示
+
更可靠的虚拟屏
+
更适合手游的键鼠映射
+
更方便的键位编辑
+
更清晰的性能观测
```

后续可继续研究：

- Windows Raw Input
- 更多游戏鼠标侧键
- D3D11VA 硬件解码
- 减少 CPU → GPU 视频帧复制
- D3D11 / DXGI 更直接的 Present 路径
- 虚拟屏保持时暂停视频编码/传输
- 宏并行动作
- 更多移动辅助模式

---

# 致谢与上游项目

LowCast Enhanced 基于：

- **scrcpy**
- **scrcpy-mask**

进行开发。

感谢原作者提供 scrcpy-mask 的：

- 键鼠映射框架
- Script 系统
- 虚拟屏基础能力
- Web 配置界面
- scrcpy 视频与控制集成

LowCast Enhanced 的目标是在尊重原项目设计与功能归属的前提下，对 Windows 低延迟投屏和手游键鼠使用场景进行持续增强。

---

# License

本项目继承并遵循上游项目的许可证要求。

使用、修改和再发布前，请同时查看仓库中的 LICENSE 文件以及上游项目许可证。
