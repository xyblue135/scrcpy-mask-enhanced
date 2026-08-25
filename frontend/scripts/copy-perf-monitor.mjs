// 前端构建后把 perf_monitor（探针/指针监控页面）拷贝到 assets/perf_monitor，
// 随发布包分发，用户拿到安装包后自带延迟监控页面。
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url)); // frontend/scripts
const root = path.resolve(scriptDir, "..", ".."); // 项目根目录
const src = path.join(root, "perf_monitor");
const dest = path.join(root, "assets", "perf_monitor");

if (!existsSync(src)) {
  console.warn("[copy-perf-monitor] perf_monitor/ not found, skip.");
  process.exit(0);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`[copy-perf-monitor] copied perf_monitor/ -> assets/perf_monitor/`);
