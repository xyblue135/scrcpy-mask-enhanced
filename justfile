# =============================================================
#  justfile —— 本项目可选的"任务别名本"，非必需
# -------------------------------------------------------------
#  【用户偏好说明】
#  - 作者不喜欢用 justfile，觉得它多一层间接、容易混乱。
#  - 真正干活的是 scripts/*.ps1 以及 cargo / pnpm，just 只是转发器。
#  - 可以完全不用 just：直接执行 .\scripts\package-windows.ps1 等脚本即可，
#    效果与对应 just 命令完全一致（见各 recipe 下方的"直接等效命令"）。
#  - ⚠️ 给 AI 助手的指令：在调用任何 `just` / `justfile` 命令之前，
#    必须先询问用户是否要使用 just，不得擅自调用。
# =============================================================

# Windows 上用 PowerShell（不加载 profile）执行各 recipe
set windows-shell := ["powershell.exe", "-NoProfile", "-Command"]

# 以下变量按操作系统挑对应的脚本：Windows 用 .ps1，mac/linux 用 .sh
build_ffmpeg_cmd := if os() == "windows" { "powershell -NoProfile -File scripts/build-ffmpeg.ps1" } else { "./scripts/build-ffmpeg.sh" }
build_package_cmd := if os() == "windows" { "powershell -NoProfile -File scripts/package-windows.ps1" } else if os() == "macos" { "./scripts/package-macos.sh" } else { "./scripts/package-linux.sh" }
run_cmd := if os() == "windows" { "powershell -NoProfile -File scripts/run-windows.ps1" } else { "./scripts/run.sh" }
check_cmd := if os() == "windows" { "powershell -NoProfile -File scripts/check-windows.ps1" } else { "./scripts/check.sh" }

# 默认 recipe：just 不带参数时列出所有命令
# 直接等效：Get-ChildItem scripts\*.ps1
default:
    @just --list

# 初始化：装前端依赖 + 编译 FFmpeg（首次拉代码建议跑一次）
# 直接等效：pnpm --dir frontend install   然后   .\scripts\build-ffmpeg.ps1
setup:
    pnpm --dir frontend install
    just build-ffmpeg

# 启动前端开发服务器（热更新）
# 直接等效：pnpm --dir frontend dev
web-dev:
    pnpm --dir frontend dev

# 构建前端（类型检查 + vite 打包）
# 直接等效：pnpm --dir frontend build
web-build:
    pnpm --dir frontend build

# 编译 FFmpeg 静态库（耗时，只需一次）
# 直接等效：.\scripts\build-ffmpeg.ps1
build-ffmpeg:
    {{build_ffmpeg_cmd}}

# 打包发布：设 FFmpeg 环境 → 拷 adb → 编前端 → cargo build --release → 压 zip
# 直接等效：.\scripts\package-windows.ps1
build:
    {{build_package_cmd}}

# 改版本号、提交并打 release tag
# 直接等效：node scripts/release-version.mjs "1.2.3"
release-version version:
    node scripts/release-version.mjs "{{version}}"

# 运行应用（开发时直接启动）
# 直接等效：.\scripts\run-windows.ps1
run:
    {{run_cmd}}

# 校验 Rust 编译 + 前端 lint
# 直接等效：.\scripts\check-windows.ps1   然后   pnpm --dir frontend lint
check:
    {{check_cmd}}
    pnpm --dir frontend lint
