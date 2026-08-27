use std::{
    fs::{File, create_dir_all},
    io::Write,
    net::Ipv4Addr,
    path::PathBuf,
    sync::RwLock,
};

use crate::{
    DEFAULT_LANGUAGE,
    scrcpy::{
        launch_options::ScrcpyModuleConfig,
        media::{AudioCodec, AudioSource, VideoCodec},
    },
    utils::{IDENTIFIER, relate_to_data_path, relate_to_root_path},
};
use once_cell::sync::Lazy;
use paste::paste;
use rust_i18n::t;
use serde::{Deserialize, Serialize};
use serde_json::to_string_pretty;

// 最早版本把配置放在系统数据目录（Windows 上是 C 盘 AppData）。
// 这里保留旧路径用于首次启动自动迁移到 data/ 目录。
fn old_config_path() -> PathBuf {
    if let Some(data_dir) = dirs::data_dir() {
        data_dir.join(IDENTIFIER).join("config.json")
    } else {
        relate_to_root_path(["config.json"])
    }
}

fn config_path() -> PathBuf {
    relate_to_data_path(["config.json"])
}

/// 把旧版本存放在系统数据目录（C 盘 AppData）的键位映射预设
/// 迁移到 data/mapping/。跨盘无法 rename，这里逐文件复制。
fn migrate_legacy_mapping() {
    let new_dir = relate_to_data_path(["mapping"]);
    if new_dir.exists() {
        return;
    }
    let Some(data_dir) = dirs::data_dir() else {
        return;
    };
    let old_dir = data_dir.join(IDENTIFIER).join("mapping");
    if !old_dir.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(&old_dir) else {
        return;
    };
    let mut moved = 0usize;
    for entry in entries.flatten() {
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        if !crate::utils::is_safe_file_name(&name) {
            continue;
        }
        let dest = new_dir.join(&name);
        if !dest.exists() && std::fs::copy(entry.path(), &dest).is_ok() {
            moved += 1;
        }
    }
    if moved > 0 {
        log::info!(
            "[LocalConfig] 已迁移 {moved} 个映射预设到 {}",
            new_dir.display()
        );
    }
}

// 配置目录：用于“打开配置目录”按钮，指向用户数据目录 data/。
pub fn get_config_dir() -> PathBuf {
    config_path()
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}

static CONFIG: Lazy<RwLock<LocalConfig>> = Lazy::new(|| RwLock::default());

pub const AUDIO_BIT_RATE_MIN: u32 = 16_000;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MappingQuickSwitch {
    pub file: String,
    pub enabled: bool,
    pub shortcut: Vec<String>,
}

fn default_web_bind_addr() -> Ipv4Addr {
    Ipv4Addr::new(127, 0, 0, 1)
}

fn bundled_adb_path() -> PathBuf {
    let adb_name = if cfg!(target_os = "windows") {
        "adb.exe"
    } else {
        "adb"
    };
    relate_to_root_path(["assets", "platform-tools", adb_name])
}

fn default_adb_path() -> String {
    let path = bundled_adb_path();
    if path.is_file() {
        path.to_string_lossy().into_owned()
    } else {
        "adb".to_string()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct LocalConfig {
    // port
    pub web_port: u16,
    #[serde(default = "default_web_bind_addr")]
    pub web_bind_addr: Ipv4Addr,
    pub controller_port: u16,
    // adb
    pub adb_path: String,
    pub adb_connect_address: String,
    // mask
    pub always_on_top: bool,
    pub titlebar_visible: bool,
    pub vertical_mask_height: u32,
    pub horizontal_mask_width: u32,
    pub vertical_position: (i32, i32),
    pub horizontal_position: (i32, i32),
    // mapping
    pub mapping_enabled: bool,
    pub active_mapping_file: String,
    pub mapping_quick_switches: Vec<MappingQuickSwitch>,
    /// 全局预设切换开关：关闭时忽略所有 quick switch 快捷键。
    pub quick_switch_enabled: bool,
    /// 全局宏预设开关：关闭时宏预设绑定不被执行（也用于前端是否显示）。
    pub macro_preset_enabled: bool,
    /// 全局轨迹随机化开关：关闭时所有映射的随机锚点/抖动/漂移不生效。
    pub mapping_randomization_enabled: bool,
    /// 全局按钮随机化开关：关闭时所有按钮的随机偏移范围（random_offset）不生效。
    pub button_randomization_enabled: bool,
    /// 全局触摸事件探针开关：开启后把每次注入手机的触摸事件写入
    /// data/touch_probe.jsonl（与 perf.jsonl 分开存放），用于定位手机端卡顿。
    pub touch_probe_enabled: bool,
    /// Move 事件距离阈值（mask 坐标系下像素）：0 = 关闭。
    /// 对同一 pointer_id 的连续 Move 事件，若 dx² + dy² < threshold² 则直接丢弃，
    /// 显著减少网络消息 / 日志体积 / CPU 调度，对实际手感影响很小。
    pub move_distance_threshold: f32,
    pub mapping_label_opacity: f32,
    // 键盘映射按钮的显示大小倍数（仅影响可视化按钮大小，adb 点击仍为按钮中心）
    pub mapping_button_scale: f32,
    // language
    pub language: String,
    // clipboard sync
    pub clipboard_sync: bool,
    // video config
    pub video_codec: VideoCodec,
    pub video_encoder: String,
    pub video_codec_options: String,
    pub qualcomm_low_latency: bool,
    pub video_bit_rate: u32,
    pub video_max_size: u32,
    pub video_max_fps: u32,
    pub display_id: i32,
    pub new_display_enabled: bool,
    pub new_display_use_main_size: bool,
    pub new_display_width: u32,
    pub new_display_height: u32,
    pub new_display_dpi: u32,
    pub new_display_start_app_enabled: bool,
    pub new_display_start_app_package: String,
    pub new_display_start_app_force_stop: bool,
    // audio config
    pub audio_codec: AudioCodec,
    pub audio_bit_rate: u32,
    pub audio_source: AudioSource,
    pub audio_dup: bool,
    // optional scrcpy launch preset module
    pub scrcpy_module: ScrcpyModuleConfig,
    // device behavior
    pub stay_awake: bool,
    pub screen_off_timeout: i32,
    pub power_off_on_close: bool,
}

impl Default for LocalConfig {
    fn default() -> Self {
        Self {
            adb_path: default_adb_path(),
            adb_connect_address: String::new(),
            web_port: 27799,
            web_bind_addr: default_web_bind_addr(),
            controller_port: 27798,
            always_on_top: true,
            titlebar_visible: true,
            vertical_mask_height: 720,
            horizontal_mask_width: 1280,
            vertical_position: (100, 100),
            horizontal_position: (100, 100),
            mapping_enabled: true,
            active_mapping_file: "default.json".to_string(),
            mapping_quick_switches: Vec::new(),
            quick_switch_enabled: true,
            macro_preset_enabled: true,
            mapping_randomization_enabled: true,
            button_randomization_enabled: true,
            touch_probe_enabled: true,
            move_distance_threshold: 0.0,
            mapping_label_opacity: 0.3,
            mapping_button_scale: 1.0,
            language: DEFAULT_LANGUAGE.to_string(),
            clipboard_sync: true,
            video_codec: VideoCodec::H264,
            video_encoder: "c2.qti.avc.encoder".to_string(), // LowCast/RMX3700 Qualcomm H.264 HW encoder
            video_codec_options: String::new(),
            qualcomm_low_latency: false, // experimental; enable for A/B testing
            video_bit_rate: 12_000_000,  // LowCast default: 12M
            video_max_size: 0,           // default no limit
            video_max_fps: 60,           // LowCast default: 60 FPS
            display_id: 0,
            new_display_enabled: false,
            new_display_use_main_size: true,
            new_display_width: 1280,
            new_display_height: 720,
            new_display_dpi: 240,
            new_display_start_app_enabled: false,
            new_display_start_app_package: String::new(),
            new_display_start_app_force_stop: false,
            audio_codec: AudioCodec::Opus,
            audio_bit_rate: 128_000,
            audio_source: AudioSource::Output,
            audio_dup: false,
            scrcpy_module: ScrcpyModuleConfig::default(),
            stay_awake: false,
            screen_off_timeout: -1, // default keep device setting
            power_off_on_close: false,
        }
    }
}

macro_rules! define_setter {
    ($(($field:ident, $typ:ty)),* $(,)?) => {
        paste! {
            $(
                pub fn [<set_ $field>] (value: $typ) {
                    CONFIG.write().unwrap().$field = value;
                    Self::save().unwrap();
                }
            )*
        }
    };
}

fn sanitize_window_config(config: &mut LocalConfig) {
    if config.horizontal_mask_width < 64 {
        config.horizontal_mask_width = 1280;
    }
    if config.vertical_mask_height < 64 {
        config.vertical_mask_height = 720;
    }

    #[cfg(target_os = "windows")]
    {
        // 旧配置中的 -32000 物理坐标可能经过 DPI 换算后变成 -21333 等值，
        // 因此历史坏值使用更宽松阈值，同时要求 X/Y 都是极端负数。
        let looks_like_minimized = |(x, y): (i32, i32)| x < -10_000 && y < -10_000;

        if looks_like_minimized(config.horizontal_position) {
            config.horizontal_position = (100, 100);
        }
        if looks_like_minimized(config.vertical_position) {
            config.vertical_position = (100, 100);
        }
    }
}

impl LocalConfig {
    pub fn prefer_bundled_adb() {
        let path = bundled_adb_path();
        if !path.is_file() {
            return;
        }

        let mut config = CONFIG.write().unwrap();
        if config.adb_path == "adb" {
            config.adb_path = path.to_string_lossy().into_owned();
        }
    }

    pub fn save() -> Result<(), String> {
        let config_json = to_string_pretty(&Self::get())
            .map_err(|e| format!("{}: {}", t!("localConfig.serializeConfigError"), e))?;

        // 配置保存在用户数据目录 data/（程序同级），而不是系统 AppData（C 盘）。
        let path = config_path();
        if let Some(parent) = path.parent() {
            create_dir_all(parent)
                .map_err(|e| format!("{}: {}", t!("localConfig.createConfigDirError"), e))?;
        }
        let mut file = File::create(path)
            .map_err(|e| format!("{}: {}", t!("localConfig.createConfigError"), e))?;
        file.write_all(config_json.as_bytes())
            .map_err(|e| format!("{}: {}", t!("localConfig.writeConfigError"), e))?;
        Ok(())
    }

    pub fn load() -> Result<(), String> {
        let path = config_path();
        // 首次启动：data/ 下没有配置时，依次尝试从旧位置迁移：
        // 1) 程序同级的 config.json（上一版布局）
        // 2) 系统数据目录（C 盘 AppData，更早版本）
        if !path.exists() {
            if let Some(parent) = path.parent() {
                let _ = create_dir_all(parent);
            }
            for old in [relate_to_root_path(["config.json"]), old_config_path()] {
                if old.exists() && old != path {
                    if let Err(e) = std::fs::copy(&old, &path) {
                        log::warn!("[LocalConfig] 迁移旧配置失败: {e}");
                    } else {
                        log::info!(
                            "[LocalConfig] 已从旧位置 {} 迁移配置到 {}",
                            old.display(),
                            path.display()
                        );
                        break;
                    }
                }
            }
        }
        // 键位映射预设同样从旧位置（C 盘 AppData）迁移到 data/mapping/。
        migrate_legacy_mapping();

        if !path.exists() {
            // 没有任何配置时回到默认，保证首次启动可用。
            return Ok(());
        }

        let config_string = std::fs::read_to_string(&path).map_err(|e| {
            format!(
                "{} {}: {}",
                t!("localConfig.readConfigError"),
                path.to_str().unwrap(),
                e
            )
        })?;
        let mut config: LocalConfig = serde_json::from_str(&config_string)
            .map_err(|e| format!("{}: {}", t!("localConfig.serializeConfigError"), e))?;
        sanitize_window_config(&mut config);
        if let Err(error) = config.scrcpy_module.validate() {
            log::warn!("[LocalConfig] invalid scrcpy module config, using defaults: {error}");
            config.scrcpy_module = ScrcpyModuleConfig::default();
        }
        *CONFIG.write().unwrap() = config;
        Ok(())
    }

    pub fn get() -> LocalConfig {
        CONFIG.read().unwrap().clone()
    }

    pub fn get_clipboard_sync() -> bool {
        CONFIG.read().unwrap().clipboard_sync
    }

    pub fn get_mapping_quick_switches() -> Vec<MappingQuickSwitch> {
        CONFIG.read().unwrap().mapping_quick_switches.clone()
    }

    pub fn get_quick_switch_enabled() -> bool {
        CONFIG.read().unwrap().quick_switch_enabled
    }

    pub fn get_macro_preset_enabled() -> bool {
        CONFIG.read().unwrap().macro_preset_enabled
    }

    pub fn get_mapping_randomization_enabled() -> bool {
        CONFIG.read().unwrap().mapping_randomization_enabled
    }

    pub fn get_button_randomization_enabled() -> bool {
        CONFIG.read().unwrap().button_randomization_enabled
    }

    pub fn get_touch_probe_enabled() -> bool {
        CONFIG.read().unwrap().touch_probe_enabled
    }

    /// Move 事件距离阈值（mask 坐标系下像素），0 表示关闭。
    /// 对同一 pointer_id 的连续 Move 事件，若 dx² + dy² < threshold² 则直接丢弃。
    pub fn get_move_distance_threshold() -> f32 {
        let raw = CONFIG.read().unwrap().move_distance_threshold;
        if raw.is_finite() && raw > 0.0 { raw } else { 0.0 }
    }

    define_setter!(
        (web_port, u16),
        (web_bind_addr, Ipv4Addr),
        (controller_port, u16),
        (adb_path, String),
        (adb_connect_address, String),
        (always_on_top, bool),
        (titlebar_visible, bool),
        (vertical_mask_height, u32),
        (horizontal_mask_width, u32),
        (vertical_position, (i32, i32)),
        (horizontal_position, (i32, i32)),
        (mapping_enabled, bool),
        (active_mapping_file, String),
        (mapping_quick_switches, Vec<MappingQuickSwitch>),
        (quick_switch_enabled, bool),
        (macro_preset_enabled, bool),
        (mapping_randomization_enabled, bool),
        (button_randomization_enabled, bool),
        (touch_probe_enabled, bool),
        (move_distance_threshold, f32),
        (mapping_label_opacity, f32),
        (mapping_button_scale, f32),
        (language, String),
        (clipboard_sync, bool),
        (video_codec, VideoCodec),
        (video_encoder, String),
        (video_codec_options, String),
        (qualcomm_low_latency, bool),
        (video_bit_rate, u32),
        (video_max_size, u32),
        (video_max_fps, u32),
        (display_id, i32),
        (new_display_enabled, bool),
        (new_display_use_main_size, bool),
        (new_display_width, u32),
        (new_display_height, u32),
        (new_display_dpi, u32),
        (new_display_start_app_enabled, bool),
        (new_display_start_app_package, String),
        (new_display_start_app_force_stop, bool),
        (audio_codec, AudioCodec),
        (audio_bit_rate, u32),
        (audio_source, AudioSource),
        (audio_dup, bool),
        (scrcpy_module, ScrcpyModuleConfig),
        (stay_awake, bool),
        (screen_off_timeout, i32),
        (power_off_on_close, bool),
    );
}
