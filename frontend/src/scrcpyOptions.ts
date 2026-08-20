import type {
  ScrcpyParameter,
  ScrcpyParameterScope,
  ScrcpyPreset,
} from "./store/localConfig";

export type ScrcpyOptionGroup =
  | "video"
  | "camera"
  | "audio"
  | "display"
  | "device"
  | "diagnostics"
  | "client";

export interface ScrcpyOptionDefinition {
  key: string;
  label: string;
  group: ScrcpyOptionGroup;
  scope: ScrcpyParameterScope;
  defaultValue: string;
  description: string;
  choices?: string[];
}

const server = "server" as const;
const clientOnly = "clientOnly" as const;

export const SCRCPY_OPTION_GROUPS: Array<{ key: ScrcpyOptionGroup; label: string }> = [
  { key: "video", label: "视频编码" },
  { key: "camera", label: "摄像头视频源" },
  { key: "audio", label: "音频" },
  { key: "display", label: "显示 / 方向 / 输入法" },
  { key: "device", label: "设备与生命周期" },
  { key: "diagnostics", label: "诊断与枚举" },
  { key: "client", label: "官方桌面客户端参数（仅记录）" },
];

// Server keys are taken from scrcpy v4.0 server Options.java. LowCast-managed
// transport keys (scid/video/audio/control/tunnel/meta/raw_stream) and virtual
// display keys are intentionally edited through dedicated controls instead.
export const SCRCPY_OPTIONS: ScrcpyOptionDefinition[] = [
  { key: "video_codec", label: "视频编码格式", group: "video", scope: server, defaultValue: "h264", choices: ["h264", "h265", "av1"], description: "Android 视频编码格式。" },
  { key: "video_source", label: "视频源", group: "video", scope: server, defaultValue: "display", choices: ["display", "camera"], description: "屏幕或摄像头。" },
  { key: "video_encoder", label: "视频编码器", group: "video", scope: server, defaultValue: "", description: "MediaCodec 编码器名称；留空自动选择。" },
  { key: "video_bit_rate", label: "视频码率", group: "video", scope: server, defaultValue: "8000000", description: "单位 bps，server 需要纯数字。" },
  { key: "video_codec_options", label: "视频 Codec Options", group: "video", scope: server, defaultValue: "", description: "逗号分隔的 MediaCodec 参数。" },
  { key: "max_size", label: "最大尺寸", group: "video", scope: server, defaultValue: "0", description: "0 表示不限制。" },
  { key: "min_size_alignment", label: "尺寸对齐", group: "video", scope: server, defaultValue: "1", choices: ["1", "2", "4", "8", "16"], description: "编码尺寸对齐要求。" },
  { key: "max_fps", label: "最大 FPS", group: "video", scope: server, defaultValue: "60", description: "0 表示不限制。" },
  { key: "angle", label: "视频角度", group: "video", scope: server, defaultValue: "0", description: "额外旋转角度。" },
  { key: "crop", label: "裁剪区域", group: "video", scope: server, defaultValue: "", description: "例如 1920:1080:0:0。" },

  { key: "camera_id", label: "Camera ID", group: "camera", scope: server, defaultValue: "", description: "video_source=camera 时使用。" },
  { key: "camera_size", label: "摄像头尺寸", group: "camera", scope: server, defaultValue: "", description: "例如 1920x1080。" },
  { key: "camera_facing", label: "摄像头方向", group: "camera", scope: server, defaultValue: "", choices: ["", "front", "back", "external"], description: "按朝向选择摄像头。" },
  { key: "camera_ar", label: "摄像头宽高比", group: "camera", scope: server, defaultValue: "", description: "如 16:9、4:3 或 sensor。" },
  { key: "camera_zoom", label: "摄像头缩放", group: "camera", scope: server, defaultValue: "1", description: "摄像头数字缩放倍数。" },
  { key: "camera_fps", label: "摄像头 FPS", group: "camera", scope: server, defaultValue: "0", description: "摄像头采集帧率。" },
  { key: "camera_high_speed", label: "高速摄像头", group: "camera", scope: server, defaultValue: "false", choices: ["false", "true"], description: "请求高速摄像头模式。" },
  { key: "camera_torch", label: "摄像头闪光灯", group: "camera", scope: server, defaultValue: "false", choices: ["false", "true"], description: "开启 torch。" },

  { key: "audio_codec", label: "音频编码格式", group: "audio", scope: server, defaultValue: "opus", choices: ["opus", "aac", "flac", "raw"], description: "Android 音频编码格式。" },
  { key: "audio_source", label: "音频源", group: "audio", scope: server, defaultValue: "output", choices: ["output", "playback", "mic"], description: "设备输出、应用回放或麦克风。" },
  { key: "audio_dup", label: "复制播放音频", group: "audio", scope: server, defaultValue: "false", choices: ["false", "true"], description: "playback 源下复制设备播放。" },
  { key: "audio_bit_rate", label: "音频码率", group: "audio", scope: server, defaultValue: "128000", description: "单位 bps。" },
  { key: "audio_codec_options", label: "音频 Codec Options", group: "audio", scope: server, defaultValue: "", description: "逗号分隔的 MediaCodec 参数。" },
  { key: "audio_encoder", label: "音频编码器", group: "audio", scope: server, defaultValue: "", description: "MediaCodec 音频编码器名称。" },

  { key: "display_id", label: "物理显示 ID", group: "display", scope: server, defaultValue: "0", description: "未启用虚拟屏时选择显示。" },
  { key: "capture_orientation", label: "采集方向", group: "display", scope: server, defaultValue: "0", description: "支持 0、90、180、270 及锁定语法。" },
  { key: "display_ime_policy", label: "虚拟显示输入法策略", group: "display", scope: server, defaultValue: "-1", choices: ["-1", "0", "1"], description: "-1 默认，0 本地，1 回退显示。" },
  { key: "show_touches", label: "显示触摸点", group: "display", scope: server, defaultValue: "false", choices: ["false", "true"], description: "Android 开发者触摸点显示。" },
  { key: "flex_display", label: "Flex Display", group: "display", scope: server, defaultValue: "false", choices: ["false", "true"], description: "允许动态适配显示尺寸。" },

  { key: "stay_awake", label: "保持唤醒", group: "device", scope: server, defaultValue: "false", choices: ["false", "true"], description: "连接期间保持设备唤醒。" },
  { key: "screen_off_timeout", label: "息屏超时", group: "device", scope: server, defaultValue: "-1", description: "毫秒；-1 保持设备设置。" },
  { key: "power_off_on_close", label: "关闭时熄屏", group: "device", scope: server, defaultValue: "false", choices: ["false", "true"], description: "server 结束时关闭屏幕。" },
  { key: "clipboard_autosync", label: "剪贴板自动同步", group: "device", scope: server, defaultValue: "true", choices: ["false", "true"], description: "允许 server 端剪贴板同步。" },
  { key: "downsize_on_error", label: "编码错误时降分辨率", group: "device", scope: server, defaultValue: "true", choices: ["false", "true"], description: "编码失败时自动缩小尺寸重试。" },
  { key: "cleanup", label: "退出时清理", group: "device", scope: server, defaultValue: "true", choices: ["false", "true"], description: "恢复 server 修改的设备状态。" },
  { key: "power_on", label: "连接时唤醒屏幕", group: "device", scope: server, defaultValue: "true", choices: ["false", "true"], description: "启动 server 时点亮设备。" },

  { key: "log_level", label: "Server 日志级别", group: "diagnostics", scope: server, defaultValue: "debug", choices: ["verbose", "debug", "info", "warn", "error"], description: "调试 server 行为。" },
  { key: "list_encoders", label: "列出编码器", group: "diagnostics", scope: server, defaultValue: "false", choices: ["false", "true"], description: "诊断命令：启用后 server 会列出信息并退出，普通投屏会断开。" },
  { key: "list_displays", label: "列出显示器", group: "diagnostics", scope: server, defaultValue: "false", choices: ["false", "true"], description: "诊断命令：启用后 server 会列出信息并退出。" },
  { key: "list_cameras", label: "列出摄像头", group: "diagnostics", scope: server, defaultValue: "false", choices: ["false", "true"], description: "诊断命令：启用后 server 会列出信息并退出。" },
  { key: "list_camera_sizes", label: "列出摄像头尺寸", group: "diagnostics", scope: server, defaultValue: "false", choices: ["false", "true"], description: "诊断命令：启用后 server 会列出信息并退出。" },
  { key: "list_apps", label: "列出应用", group: "diagnostics", scope: server, defaultValue: "false", choices: ["false", "true"], description: "诊断命令：启用后 server 会列出信息并退出。" },

  { key: "mouse", label: "鼠标模式", group: "client", scope: clientOnly, defaultValue: "uhid", choices: ["sdk", "uhid", "aoa", "disabled"], description: "官方桌面客户端选项；LowCast 当前使用自己的触摸/映射控制链路。" },
  { key: "keyboard", label: "键盘模式", group: "client", scope: clientOnly, defaultValue: "uhid", choices: ["sdk", "uhid", "aoa", "disabled"], description: "官方桌面客户端选项，不会传给 Android server。" },
  { key: "gamepad", label: "手柄模式", group: "client", scope: clientOnly, defaultValue: "uhid", choices: ["uhid", "aoa", "disabled"], description: "官方桌面客户端选项。" },
  { key: "video_buffer", label: "视频缓冲", group: "client", scope: clientOnly, defaultValue: "0", description: "官方客户端缓冲；LowCast 使用 latest-frame-only。" },
  { key: "audio_buffer", label: "音频缓冲", group: "client", scope: clientOnly, defaultValue: "50", description: "官方客户端参数；LowCast 有独立音频缓冲器。" },
  { key: "time_limit", label: "运行时限", group: "client", scope: clientOnly, defaultValue: "0", description: "官方客户端会话时限。" },
  { key: "record", label: "录制文件", group: "client", scope: clientOnly, defaultValue: "", description: "LowCast 当前没有接入官方客户端录制器。" },
  { key: "fullscreen", label: "客户端全屏", group: "client", scope: clientOnly, defaultValue: "false", choices: ["false", "true"], description: "LowCast 请使用 F11。" },
  { key: "always_on_top", label: "客户端置顶", group: "client", scope: clientOnly, defaultValue: "false", choices: ["false", "true"], description: "LowCast 使用自身窗口置顶设置。" },
  { key: "window_title", label: "客户端窗口标题", group: "client", scope: clientOnly, defaultValue: "", description: "仅用于官方 scrcpy 客户端。" },
];

export const SCRCPY_OPTION_BY_KEY = new Map(
  SCRCPY_OPTIONS.map((definition) => [definition.key, definition]),
);

export function withCompleteScrcpyOptions(preset: ScrcpyPreset): ScrcpyPreset {
  const existing = new Map(preset.parameters.map((parameter) => [parameter.key, parameter]));
  const known: ScrcpyParameter[] = SCRCPY_OPTIONS.map((definition) => {
    const parameter = existing.get(definition.key);
    existing.delete(definition.key);
    return parameter
      ? { ...parameter, scope: definition.scope }
      : {
          id: `official-${definition.key.replaceAll("_", "-")}`,
          enabled: false,
          key: definition.key,
          value: definition.defaultValue,
          scope: definition.scope,
        };
  });
  return { ...preset, parameters: [...known, ...existing.values()] };
}
