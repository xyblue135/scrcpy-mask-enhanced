# LowCast 干净重建版说明

本仓库以完整、干净的 `scrcpy-mask v0.9.0` 源码树重新搭建，再把已经确认采用的 LowCast 修改逐项合入。没有把历史补丁包、备份文件或 `src.zip` 混进源码目录。

## 已合入功能

- 低延迟视频默认项：H.264、`c2.qti.avc.encoder`、12 Mbps、默认 60 FPS；FPS、编码器、Codec Options 可在设置页调整，并保留 Qualcomm 低延迟实验开关。
- Windows 渲染优先 `AutoNoVsync`；F11 无边框全屏与普通 Windows 最大化分离。
- 全屏/最大化时保持手机画面宽高比，多余位置显示黑边；鼠标和键位坐标使用实际视频区域，不按整个窗口错误拉伸。
- 键盘映射总开关，默认开启，可关闭并保存状态。
- 虚拟屏支持独立尺寸/DPI、指定包名启动、可选 Force Stop；启用 `keep_active=true` 和 `vd_destroy_content=false` 以尽量保留虚拟屏/App 状态。
- 键位背景刷新不再使用 `adb screencap`，直接保存 LowCast 当前正在显示的解码视频帧，因此主屏/虚拟屏与当前画面天然一致。
- 设置页按“基础/窗口、键盘映射、虚拟屏幕、视频/低延迟、音频、设备行为、连接/高级”分组。
- 新增“方向轮盘（非按住跑步）”和“静步按键”，自动跑与静步共享移动辅助状态并互斥，避免状态冲突。
- 键位编辑器新增“位置锁定/拖动调整”，默认锁定；解锁后可直接拖动已有键位，不再删除重建。
- 顶部新增“宏预设”：可把一个触发键（例如 Numpad4）绑定到“已有键位、坐标点击、长按、等待”等顺序动作。宏复用现有 Script 运行时，并在画布中隐藏，不额外制造一套触摸协议。

## 开发运行

改过前端时：

```powershell
cd frontend
pnpm build
cd ..
cargo run
```

只改 Rust 时直接：

```powershell
cargo run
```

`cargo run` 会自动重新编译发生变化的 Rust 代码。

## 仓库清理规则

不要提交 `target/`、`assets/web/`、根目录 `src.zip`、`.patch` 和 `.bak`。这些本地构建/合并产物已经加入 `.gitignore` 防止再次误提交。
