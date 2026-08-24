$ErrorActionPreference = "Stop"

$ProjectDir = Resolve-Path "$PSScriptRoot\.."
$OutputDir = Join-Path $ProjectDir "assets\platform-tools"

# 自动从PATH识别adb
$AdbCommand = Get-Command adb -CommandType Application -ErrorAction SilentlyContinue
if (-not $AdbCommand) {
    throw "adb 未在系统PATH中找到，请安装官方 Android SDK Platform‑Tools 并加入环境变量。"
}

$AdbPath = Resolve-Path $AdbCommand.Source
$AdbDir = Split-Path -Parent $AdbPath
Write-Host "检测到adb路径: $AdbPath`nadb所在目录: $AdbDir"

# 清理输出目录
if (Test-Path $OutputDir) {
    Remove-Item $OutputDir -Recurse -Force
}
New-Item -ItemType Directory -Path $OutputDir | Out-Null

# 复制主程序adb.exe
Copy-Item $AdbPath (Join-Path $OutputDir "adb.exe")

# 必须的dll，缺失直接报错（必须官方platform‑tools，精简包没有）
foreach ($File in @("AdbWinApi.dll", "AdbWinUsbApi.dll")) {
    $Source = Join-Path $AdbDir $File
    if (-not (Test-Path $Source)) {
        throw "【缺失依赖】$File 在 $AdbDir 中不存在！`n请使用谷歌官方 Android SDK Platform‑Tools，不要使用第三方精简adb包。"
    }
    Copy-Item $Source $OutputDir
}

# 可选文件，不存在直接跳过，不报错
foreach ($File in @("NOTICE.txt", "source.properties")) {
    $Source = Join-Path $AdbDir $File
    if (Test-Path $Source) {
        Copy-Item $Source $OutputDir
        Write-Host "复制可选文件: $File"
    } else {
        Write-Host "跳过可选文件: $File (本机未找到)"
    }
}

Write-Host "`n✅ 完成，已打包adb：$AdbPath"
