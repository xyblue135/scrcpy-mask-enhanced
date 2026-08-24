#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$PROJECT_DIR/assets/platform-tools"

# 从PATH查找adb
ADB_BIN="$(command -v adb || true)"
if [[ -z "$ADB_BIN" ]]; then
    echo "ERROR: adb 未在PATH中找到，请安装 Android SDK Platform‑Tools" >&2
    exit 1
fi

# 解析符号链接拿到真实路径
resolve_path() {
    local path="$1"
    while [[ -L "$path" ]]; do
        local target
        target="$(readlink "$path")"
        if [[ "$target" == /* ]]; then
            path="$target"
        else
            path="$(dirname "$path")/$target"
        fi
    done
    local dir
    dir="$(cd "$(dirname "$path")" && pwd -P)"
    printf '%s/%s\n' "$dir" "$(basename "$path")"
}

ADB_BIN="$(resolve_path "$ADB_BIN")"
ADB_DIR="$(dirname "$ADB_BIN")"

echo "检测到adb: $ADB_BIN"
echo "adb目录: $ADB_DIR"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

cp "$ADB_BIN" "$OUTPUT_DIR/adb"
chmod +x "$OUTPUT_DIR/adb"

# 可选文件，不存在直接跳过
for file in NOTICE.txt source.properties; do
    if [[ -f "$ADB_DIR/$file" ]]; then
        cp "$ADB_DIR/$file" "$OUTPUT_DIR/"
        echo "复制可选文件: $file"
    else
        echo "跳过可选文件: $file (本机未找到)"
    fi
done

echo -e "\n✅ 完成，已打包adb：$ADB_BIN"
