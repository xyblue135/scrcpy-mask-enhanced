# scrcpy-mask-enhanced

> 基于 **scrcpy-mask** 的 Windows 低延迟增强分支，专注手游键鼠投屏体验。
> 在保留原项目键鼠映射、脚本系统、虚拟屏与 Web 配置能力的基础上，重点增强了 **Qualcomm 设备视频参数优化、Windows 全屏/最大化与等比例显示、虚拟屏应用生命周期管理、键位编辑体验，以及自动跑、静步和可视化宏预设等手游键鼠功能**。
<img width="2300" height="961" alt="image" src="https://github.com/user-attachments/assets/b227c41c-8b40-4373-a942-ead9c921d898" />
<img width="2239" height="290" alt="image" src="https://github.com/user-attachments/assets/a15877bd-12bb-470b-acf3-1ede100cdf5f" />
<img width="568" height="589" alt="image" src="https://github.com/user-attachments/assets/ee93cb39-2a15-49f1-82d3-89ef4609740b" />
<img width="1411" height="874" alt="image" src="https://github.com/user-attachments/assets/1b178524-c8e6-45d6-8e59-7d9a61509475" />


虽测试延迟为画面延迟和10ms和10ms键鼠延迟 但说实话玩fps依旧存在顿挫感，如果需要更低的延迟 依旧推荐使用带投屏协议的手机输出口 配合其他映射 带高刷的欺骗器解锁手机投屏上限60fps【刷新率越高投屏玩游戏越跟手】
## 目录

- [项目定位](#项目定位)
- [功能总览](#功能总览)
- [核心增强](#核心增强)
- [便捷功能一览](#便捷功能一览)
- [原作者已有能力说明](#原作者已有能力说明)
- [推荐配置](#推荐配置)
- [快速开始](#快速开始)
- [编译流程详解](#编译流程详解面向-rust-初学者)
- [发布到 GitHub Release](#发布到-github-release)
- [配置文件位置](#配置文件位置)
- [部署与维护](#部署与维护)
- [分支说明](#分支说明)
- [项目方向](#项目方向)
- [致谢与上游项目](#致谢与上游项目)

---

## 项目定位

LowCast Enhanced 并不是重新实现一套 scrcpy，也不是替代原项目的键鼠映射框架。项目整体关系可以理解为：

```
scrcpy
  ↓
scrcpy-mask
  ↓
scrcpy-mask-enhanced-xyblue
```

| 层级 | 提供能力 |
|------|----------|
| **scrcpy** | Android 屏幕捕获、编码、传输与控制 |
| **scrcpy-mask** | 键鼠映射、脚本、虚拟屏、Web 配置等完整功能 |
| **本分支** | 针对 Windows、Qualcomm / realme 设备及低延迟手游投屏场景的进一步增强 |

---

## 功能总览

按模块速览本分支的全部增强能力（详情见后文）：

| 模块 | 功能 | 一句话说明 |
|------|------|-----------|
| 视频与延迟 | Windows 低延迟视频优化 | AutoNoVsync、H.264、码率/帧率可调、Qualcomm LL |
| 视频与延迟 | PC 端视频延迟观测 | 全链路延迟与丢帧统计 |
| 窗口显示 | F11 真全屏 / 最大化 / 等比例 | 全屏与最大化分离，画面不再拉伸 |
| 窗口显示 | Windows -32000 坐标修复 | 最小化异常坐标不再污染窗口配置 |
| 虚拟屏 | 包名启动应用 / Force Stop | 解决部分 ROM 虚拟桌面打不开应用 |
| 虚拟屏 | 常驻与状态保持 | Alt+Tab / 最小化 / F11 均不销毁 |
| 虚拟屏 | 背景截图修复 | 从视频帧取图，主屏/虚拟屏背景正确 |
| 键鼠映射 | 映射总开关 / 键位拖动 / 按钮大小 | 编辑体验与开关控制增强 |
| 移动辅助 | 自动跑 / 静步 / 冲突管理 | 手游常用移动辅助 |
| 宏与脚本 | 宏预设 / 内置函数 / 钩子 / 抖动 | 可视化宏 + 脚本进阶能力 |
| 输入模式 | 原始输入模式 / 轮盘按钮映射 | 输入透传与径向轮盘 |
| 设置界面 | 设置页重构 / Scrcpy 预设 / 检查更新 | 参数调试中心与便捷更新 |

---

## 核心增强

以下为改动较大的核心能力，按模块给出详细说明。

### 1. Windows 低延迟视频优化

对视频参数进行了更偏向低延迟游戏场景的调整：

| 项目 | 默认值 / 能力 |
|------|--------------|
| 渲染模式 | `AutoVsync` → `AutoNoVsync` |
| 编码 | 默认 H.264 |
| 硬件编码器（Qualcomm） | 可指定，默认推荐 `c2.qti.avc.encoder` |
| 码率 | 默认 12 Mbps |
| 帧率上限 | 默认 60 FPS 帧率越高手机性能越好的情况下相对延迟越低 |
| FPS 档位 | 跟随设备 / 不限制 / 30 / 60 / 90 / 120 / 自定义 |
| Video Encoder | 支持自定义 |
| Codec Options | 支持 |
| Qualcomm Low Latency | 实验开关 |

> FPS 设置是视频编码帧率上限，并不会关闭手机自身的动态刷新率机制。

### 2. PC 端视频延迟观测

在低延迟视频链路基础上增加客户端延迟追踪，用于后续继续优化：

```
Socket Receive → Decoder Submit → Decode → YUV Copy → Latest Frame Slot → UI Take → Texture Update
```

| 观测项 | 说明 |
|--------|------|
| 延迟统计 | Decode / Copy / UI Wait / Client Total |
| 帧统计 | Delivered Frames / Dropped Frames |

> 仅用于性能分析，不改变 scrcpy-mask 原有的 latest-frame-only 思路。

### 3. Windows 窗口体验优化

| 操作 | 行为 |
|------|------|
| **F11** | 真正的无边框全屏，与普通最大化完全分离 |
| **右上角最大化** | 普通 Windows 最大化（保留任务栏），**≠ F11** |
| **窗口缩放** | 保持视频原始比例等比例缩放、四周留黑边，不再拉伸画面 |

```
┌─────────────────────────────┐
│           黑边              │
│   ┌─────────────────────┐   │
│   │     手机画面         │   │
│   └─────────────────────┘   │
│           黑边              │
└─────────────────────────────┘
```

等比例缩放后，以下坐标已同步修正：

- 普通鼠标 / FPS 鼠标 / 虚拟鼠标
- 键位映射标签
- 黑边偏移后的触摸位置

**Windows -32000 最小化坐标修复**：

- 不保存 Windows 最小化特殊坐标（`-32000, -32000`）
- 不保存异常极小窗口尺寸
- F11 / 最大化状态不覆盖普通窗口尺寸
- 已污染的异常位置可恢复到正常坐标

### 4. 虚拟屏增强

| 能力 | 说明 |
|------|------|
| 指定包名启动应用 | 新增 START_APP，通过 scrcpy Control Socket 直接启动指定 Android 包名，解决部分 ROM 虚拟屏创建成功但无法从虚拟桌面打开应用的问题 |
| 可选 Force Stop | 支持 Start App / Force Stop 两种行为；默认 **Start App ON、Force Stop OFF**，避免每次都强制杀进程重载 |

**虚拟屏常驻与应用状态保持**（`keep_active=true`、`vd_destroy_content=false`）：

- Alt+Tab 不销毁虚拟屏
- 最小化不销毁虚拟屏
- F11 切换不销毁虚拟屏
- 普通最大化不销毁虚拟屏
- 打开设置不主动销毁虚拟屏
- 尽可能保留 Android App Task

> 只有真正断开设备、关闭会话或异常重连时才需要重新创建 Virtual Display。

### 5. 脚本系统与进阶能力

**内置函数**（在原有 `tap / swipe / wait / print` 基础上新增）：

| 分类 | 函数 | 说明 |
|------|------|------|
| 跨脚本共享状态 | `state_set(name, value)` | 写一个共享状态 |
| | `state_get(name, default)` | 读一个共享状态 |
| | `state_has(name)` | 判断是否存在 |
| | `state_delete(name)` | 删除 |
| | `state_clear()` | 清空所有 |
| 文本与按键 | `paste_text("内容")` | 通过 ADB 粘贴文本到手机 |
| | `send_key(键名)` | 向手机发送一个按键 |
| 运行时模式切换 | `enter_fps(id) / exit_fps()` | FPS 鼠标视角模式 |
| | `enter_raw_input() / exit_raw_input()` | 原始输入模式 |
| | `cancel_cast(id) / release_cast()` | 施法控制 |

**其它脚本能力**：

- 脚本钩子：每个映射类型支持 Before Script / After Script，在按下/松开前后执行脚本
- 随机偏移 / 微抖动：方向轮盘、施法、滑动等操作支持 Random Offset 和 Micro Jitter，模拟真人触控轨迹

### 6. 设置页面重构

```
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

**Scrcpy 参数预设模块**：内置多套 scrcpy 预设，开箱即可按需切换。

| 预设 | 关键参数 |
|------|----------|
| Qualcomm H.265 低延迟 | `--video-codec=h265 --video-encoder=c2.qti.hevc.encoder.cq --video-bit-rate=5M --max-fps=60 --no-audio --mouse=uhid --video-buffer=0` |
| H.264 通用均衡（默认） | `--video-codec=h264 --video-encoder=c2.qti.avc.encoder --video-bit-rate=12M --max-fps=60 --audio-codec=opus --mouse=uhid --video-buffer=0` |
| 高码率清晰画质 | 24M 码率、120 FPS |
| 低带宽 / 远程网络 | 3M 码率、1024 最大尺寸、30 FPS |
| 虚拟显示 / 办公分屏 | 开启虚拟屏、指定尺寸与启动应用 |

支持能力：新建 / 复制 / 删除预设、逐项启禁用参数、命令预览编辑、`scrcpy ...` 命令导入解析。参数目录以 scrcpy 4.0 server Options.java 为基线，分为视频、摄像头、音频、显示、设备、诊断和 Client Only 七组。

---

## 便捷功能一览

以下为相对轻量的增强，汇总成表方便查阅：

| 功能 | 说明 |
|------|------|
| **键位映射背景截图修复** | 改为读取当前视频帧（YUV→RGB→PNG），不再依赖 `adb screencap` 往返；主屏/虚拟屏背景各自正确，F11/最大化黑边不会被截入背景 |
| **键盘映射总开关** | 默认开启；关闭后真正停止映射状态而非仅隐藏 UI；每套预设可单独配置 Ctrl/Alt+F1~F12 快捷切换，快捷键在普通游戏映射前被消费，不会误触发 |
| **键位位置锁定 / 拖动调整** | 显式模式切换（默认锁定）；解锁后可直接拖动键位更新 XY，无需删除重建 |
| **方向轮盘自动跑** | 基于方向轮盘向上延长能力，一键切换自动跑 |
| **静步按键** | Toggle 类型：第一次按点击静步按钮（ON），再按再次点击（OFF）；支持自定义取消键（WASD/Shift 等），按下时自动取消静步 |
| **自动跑 / 静步冲突管理** | Movement Assist 统一协调，二者默认互斥，避免两个逻辑状态同时保持 |
| **可视化宏预设** | 图形化编辑宏动作（引用键位 / 坐标点击长按 / Wait / 顺序调整 / 删除），防执行中宏重复叠加 |
| **原始输入模式** | 独立映射运行状态，键盘输入直接透传手机（中文输入法可用），退出恢复普通映射 |
| **轮盘按钮映射（Wheel）** | 适配游戏径向物品/技能轮盘，按住拖向扇区方向松开选中；可配中心/半径/随机偏移/初始滑动时长 |
| **检查更新** | 设置页「关于」请求 GitHub Release 对比版本，有更新时弹出更新对话框 |
| **映射按钮显示大小调节** | 设置页「键盘映射」滑块 0.5x~2.0x 调整显示大小；仅改显示，adb 实际点击仍在按钮中心，不影响精度 |

**方向轮盘自动跑键序**：

```
第一次按 Shift → 开启自动跑
松开第一次 Shift → 继续保持自动跑
A / D → 不取消
S → 立即取消
再次按下 Shift → 松开这次 Shift → 取消自动跑
```

**可视化宏预设示例**：

```
宏名称：跳跃 + 技能
触发键：Numpad4
动作：
  1. 跳跃
  2. 等待 60ms
  3. 技能
```

支持的动作类型：引用已有键位（保存时读取当前 XY，拖动后重新保存自动更新）、指定坐标点击/长按、Wait/延迟、动作顺序调整/删除、防止执行中的宏重复叠加。

**轮盘按钮映射流程**：

```
按住绑定键 → 鼠标拖向轮盘某一扇区方向 → 松开
→ 触摸落在光标方向（限制在轮盘半径内）
→ 游戏选中手指下的物品
```

---

## 原作者已有能力说明

以下能力属于 scrcpy-mask 原有设计，并非本分支从零实现：

| 能力 | 说明 |
|------|------|
| FFmpeg LOW_DELAY | 原项目已启用，本分支保留 |
| Latest Frame Only | 原项目已有 LatestVideoFrame 单槽设计；本分支增加 Dropped / Delivered Frame 统计和视频阶段延迟追踪，而非重新发明 latest-frame-only |
| 基础虚拟屏 | 原项目已支持 New Display、Width、Height、DPI；本分支增强 START_APP、包名、Force Stop、Keep Active、App Task 保留、截图修复与 realme/ROM 兼容性 |
| Script 脚本系统 | Script 执行器为原项目功能；本分支新增面向普通用户的可视化「宏预设」管理层 |

---

## 推荐配置

针对 Qualcomm / realme 低延迟游戏投屏，可从以下配置开始测试：

| 参数 | 推荐值 |
|------|--------|
| Video Codec | H.264 |
| Video Encoder | `c2.qti.avc.encoder` |
| Bitrate | 12 Mbps |
| FPS | 60 |
| Video Buffer | 低延迟模式 |
| Audio | 按需求开启 |
| Qualcomm LL | 实验性，根据设备测试 |

> 设备性能足够时可继续测试 90 / 120 FPS。不建议单纯认为 FPS 越高延迟一定越低，应结合手机编码延迟、发热、USB 带宽、PC 解码、Dropped Frames 和 Client Latency 综合判断。

---

## 快速开始

### 前置依赖

| 工具 | 用途 | 安装方式 |
|------|------|----------|
| Rust 工具链（≥ 1.85） | 编译后端 | https://rustup.rs |
| Node.js 18+ + pnpm | 构建前端 | Node: nodejs.org / pnpm: `corepack enable` |
| ADB platform-tools | 连接设备 | 系统 PATH 或程序内指定路径 |
| FFmpeg 7.1.2 静态库 | 视频解码（编译时） | 由 `just build-ffmpeg` 编译 |
| MSYS2（Windows） | 编译 FFmpeg | https://www.msys2.org |

### 快速构建

```powershell
# 1. 安装前端依赖
cd frontend
pnpm install
# 2. 构建前端产物到 assets/web
pnpm build
cd ..
# 3. 准备 ADB 运行环境
.\scripts\package-windows.ps1
# 4. 编译并运行（开发模式）
cargo run
# 或编译发布版本
cargo build --release
```

---

## 编译流程详解（面向 Rust 初学者）

本项目是「Rust 后端 + React 前端」的组合：**Rust 负责连接 ADB / scrcpy、视频解码与键鼠映射；React 前端只是一个被内置 Web 服务器托管的配置界面**。编译分两条线，最后由 Rust 把前端打包产物一起跑起来。

### 1. 三个工具分别干什么

| 工具 | 角色 | 管什么 |
|------|------|--------|
| `cargo` | Rust 官方构建工具 | 编译 Rust 后端（src/ 下所有 .rs），产出可执行文件 |
| `pnpm` | Node 包管理器 | 安装并构建前端（frontend/ 下的 React/TypeScript） |
| `just` | 命令包装器 | 把零散命令串成易记的配方，一键执行 |

### 2. 两条编译线如何衔接

```
frontend/  (React + TypeScript)
   │  pnpm install → 下载依赖
   │  pnpm build   → tsc 类型检查 + vite 打包
   ▼
assets/web/  (HTML/JS/CSS 静态文件)
   │
   │  Rust 后端通过 src/web/mod.rs 的 ServeDir 托管
   ▼
src/  (Rust 后端)
   │  cargo run / cargo build
   ▼
可执行程序 (启动后监听 27799 端口，浏览器自动打开)
```

关键衔接点：

- 前端 `pnpm build` 的产物必须先生成到 `assets/web`，后端才看得到界面
- 后端 `src/web/mod.rs` 的 `relate_to_root_path(["assets", "web"])` 就是去程序目录下的 `assets/web` 找网页根目录
- 开发模式下，前端 `pnpm dev` 会启动 Vite 热更新服务器，并把 `/api` 请求反向代理到 Rust 后端的 `localhost:27799`

### 3. 工具链安装（一次性）

1. **Rust 工具链**：访问 https://rustup.rs 安装 `rustup`
2. **Node.js + pnpm**：安装 Node 18+，然后 `corepack enable && pnpm --version`
3. **just**：`cargo install just`
4. **ADB**：把 adb.exe 放进系统 PATH，或后续在程序设置里手动指定路径
5. **FFmpeg 静态库**：Windows 需要 MSYS2 和 Visual Studio Build Tools

### 4. 标准编译步骤

**方式 A：用 just（推荐，省心）**

```powershell
# 第一次：装前端依赖 + 编译 FFmpeg 静态库（二者都耗时，且只需一次）
just setup
# 构建前端到 assets/web
just web-build
# 运行
just run
# 仅做编译/类型检查，不运行
just check
```

**方式 B：手动跑每一步（便于理解）**

```powershell
# 1. 前端：装依赖
cd frontend
pnpm install
# 2. 前端：类型检查 + 打包 → 输出到 ../assets/web
pnpm build
cd ..
# 3. 后端：编译并运行
cargo run
# 或者只要发布版：
cargo build --release
```

> 常见坑：`cargo run` 之前忘记先 `pnpm build`，后果是 `assets/web` 是空的，浏览器打开空白/404。

### 5. justfile 配方说明

| 配方 | 实际执行 | 说明 |
|------|----------|------|
| `just`（无参数） | `just --list` | 列出所有可用配方 |
| `just setup` | `pnpm --dir frontend install` + `just build-ffmpeg` | 初始化前端依赖并编译 FFmpeg |
| `just web-dev` | `pnpm --dir frontend dev` | 启动前端热更新服务器 |
| `just web-build` | `pnpm --dir frontend build` | 前端类型检查 + 打包到 assets/web |
| `just build-ffmpeg` | `scripts/build-ffmpeg.ps1` | 编译 FFmpeg 静态库 |
| `just build` | `scripts/package-windows.ps1` | 打包发布 |
| `just run` | `scripts/run-windows.ps1` | 注入 PATH 后 cargo run |
| `just check` | `scripts/check-windows.ps1` + `pnpm lint` | Rust 编译检查 + 前端 lint |
| `just release-version x.y.z` | `node scripts/release-version.mjs` | 更新版本号并打 tag |

### 6. FFmpeg 与 ADB 的依赖

- **FFmpeg（编译期）**：`Cargo.toml` 里 `ffmpeg-next` 开了 `static` feature，编译时需要链接 FFmpeg 静态库。由 `just build-ffmpeg` 生成到 `assets/lib`。
- **ADB（运行期）**：后端在运行时查找 adb，编译不需要。adb.exe 需在 PATH 或在程序设置里指定路径。
- **build.rs（Linux 专属）**：用 pkg-config 探测 x11/vdpau/libva，Windows 下不执行。

### 7. 新手常见报错速查

| 现象 | 原因 | 解决 |
|------|------|------|
| `cargo run` 后网页空白 | 没跑 `pnpm build`，assets/web 为空 | 先 `just web-build` 再 `cargo run` |
| `error: failed to find libX11` | Linux 缺系统库 | 安装对应 dev 包；Windows 忽略 |
| `cl.exe 未找到` | 编 FFmpeg 没装 MSVC 工具链 | 装 VS Build Tools 或跳过 build-ffmpeg |
| `MSYS2 bash is required` | 编 FFmpeg 没装 MSYS2 | 装 MSYS2 或设 MSYS2_BASH 环境变量 |
| `pnpm: command not found` | 没装 pnpm | `corepack enable` 或 `npm i -g pnpm` |
| 编译极慢 | 首次编译拉取 Bevy/wgpu 等大量依赖 | 正常，后续增量编译快很多 |

---

## 发布到 GitHub Release

```powershell
# 1. 构建前端
cd frontend
pnpm install && pnpm build
cd ..
# 2. 准备 ADB 运行环境
.\scripts\package-windows.ps1
# 3. 编译 Release 版本
# 个人环境变量配置
$env:PATH = "C:\msys64\mingw64\bin;" + $env:PATH
$env:PKG_CONFIG_PATH = "...\ffmpeg-7.1.2\ffmpeg-windows-x64\lib\pkgconfig"
$env:FFMPEG_DIR = "...\ffmpeg-7.1.2\ffmpeg-windows-x64"
$env:SCRCPY_MASK_OS = "windows-x64"
cargo build --release
# 4. 打包为 zip
# 需要包含以下内容：
#   target/release/scrcpy-mask.exe     ← 主程序
#   assets/                             ← 整个资源目录
#     ├─ locales/                       ← 多语言翻译文件
#     ├─ shaders/                       ← 着色器
#     ├─ icons/                         ← 图标
#     ├─ web/                           ← 前端页面（由 pnpm build 生成）
#     ├─ platform-tools/                ← ADB 运行时（由 package-windows.ps1 准备）
#     ├─ lib/                           ← FFmpeg 运行时库
#     ├─ overlay/                       ← 叠加层资源
#     ├─ perf_monitor/                  ← 性能监控工具
#     └─ scrcpy-mask-server-v4.0       ← scrcpy server
#   config.example.json                 ← 配置示例（可选）
```

**在 GitHub 上创建 Release**：

1. 进入仓库页面 → 右侧 **Releases** → **Create a new release**
2. Tag: `v0.9.0`（与脚本打的一致）
3. Release title: `Scrcpy Mask Enhanced v0.9.0`
4. 编写发布说明（可从 README 或 commit log 中提取）
5. 上传打包好的 zip 文件
6. 点击 **Publish release**

> 之后程序内的「检查更新」功能会自动检测到这个新版本。

---

## 配置文件位置

从本次维护起，配置文件 `config.json` 不再存放在系统 C 盘（原路径为 `C:\Users\<用户>\AppData\Roaming\com.akichase.scrcpy-mask\config.json`），而是存放到**程序（源码）同级目录**：

```
程序所在目录 / config.json
```

| 运行方式 | 配置位置 |
|----------|----------|
| Debug 运行（`cargo run`） | 项目根目录（与 Cargo.toml 同级） |
| Release 运行 | `scrcpy-mask.exe` 所在目录 |

行为说明：

- 首次启动时，若新位置没有配置，但旧 C 盘位置存在，会自动把旧配置迁移过来
- 设置页「连接 / 高级」中的「打开配置目录」按钮会直接打开新的配置目录
- 仓库根目录提供 `config.example.json` 作为示例副本

---

## 部署与维护

### 部署

1. 安装依赖：Node（pnpm）、Rust 工具链、ADB
2. 构建前端并放入 Web 静态资源目录
3. 构建运行后端（`cargo run` 或 `cargo build --release`）
4. 发布时，把 `target/release` 下的可执行文件与 `assets/` 资源目录整体拷贝到目标机器，配置文件会在首次运行时自动生成

### 维护

| 事项 | 说明 |
|------|------|
| 配置迁移 | 升级到本版本后首次启动会自动从旧 C 盘路径迁移配置 |
| 配置备份 | 直接复制程序目录下的 `config.json` 即可备份 |
| 恢复默认 | 删除 `config.json` 后重启，程序会使用内置默认配置重新生成 |
| scrcpy 预设 | 内置多套预设可直接选用，也可在「Scrcpy 预设」页新建/复制/编辑/删除 |
| 按钮大小 | 在设置页「键盘映射」中调整，仅影响显示不改点击精度 |

---

## 分支说明

| 分支 | 说明 |
|------|------|
| `master` | 当前开发分支（scrcpy-mask-enhanced-xyblue 的主要开发分支） |
| `scrcpy-mask-src` | 保留为原作者功能基线 |

> 在新增功能或重构时，可以通过 `git diff scrcpy-mask-src..master` 持续确认哪些是原项目能力、哪些是本分支新增功能、哪些是 Bug 修复和性能优化。

---

## 项目方向

当前重点不是增加大量与投屏无关的功能，而是围绕以下几个方向继续迭代：

```
更低的视频延迟
+ 更稳定的 Windows 显示
+ 更可靠的虚拟屏
+ 更适合手游的键鼠映射
+ 更方便的键位编辑
+ 更清晰的性能观测
```

**后续可继续研究的方向**：

| 方向 | 说明 |
|------|------|
| Windows Raw Input | 更底层的输入通道 |
| 更多游戏鼠标侧键 | 扩展鼠标按键 |
| D3D11VA 硬件解码 | 降低解码开销 |
| 减少 CPU → GPU 视频帧复制 | 降低拷贝开销 |
| D3D11 / DXGI 更直接的 Present 路径 | 降低渲染延迟 |
| 虚拟屏保持时暂停视频编码/传输 | 节省资源 |
| 宏并行动作 | 宏能力扩展 |
| 更多移动辅助模式 | 功能扩展 |

---

## 致谢与上游项目

本分支基于以下项目进行开发：

- **scrcpy** — https://github.com/Genymobile/scrcpy
- **scrcpy-mask** — https://github.com/AkiChase/scrcpy-mask

感谢原作者提供 scrcpy-mask 的：键鼠映射框架、Script 系统、虚拟屏基础能力、Web 配置界面、scrcpy 视频与控制集成。

本分支的目标是在尊重原项目设计与功能归属的前提下，对 Windows 低延迟投屏和手游键鼠使用场景进行持续增强。

---

## License

本项目继承并遵循上游项目的许可证要求。使用、修改和再发布前，请同时查看仓库中的 LICENSE 文件以及上游项目许可证。
