use std::collections::HashSet;

use serde::{Deserialize, Serialize};

const MAX_PRESETS: usize = 32;
const MAX_PARAMETERS_PER_PRESET: usize = 96;
const RESERVED_SERVER_KEYS: &[&str] = &[
    "scid",
    "video",
    "audio",
    "control",
    "tunnel_forward",
    "new_display",
    "vd_destroy_content",
    "vd_system_decorations",
    "keep_active",
    "send_device_meta",
    "send_frame_meta",
    "send_dummy_byte",
    "send_stream_meta",
    "raw_stream",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ScrcpyParameterScope {
    #[default]
    Server,
    /// Kept in the preset and command preview, but not sent to Android's
    /// scrcpy server. For example, official scrcpy's `--video-buffer` is a
    /// desktop-client option while LowCast uses its own latest-frame pipeline.
    ClientOnly,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ScrcpyParameter {
    pub id: String,
    pub enabled: bool,
    pub key: String,
    pub value: String,
    pub scope: ScrcpyParameterScope,
}

impl Default for ScrcpyParameter {
    fn default() -> Self {
        Self {
            id: "parameter".to_string(),
            enabled: true,
            key: String::new(),
            value: String::new(),
            scope: ScrcpyParameterScope::Server,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ScrcpyVirtualDisplayConfig {
    pub enabled: bool,
    pub use_main_size: bool,
    pub width: u32,
    pub height: u32,
    pub dpi: u32,
    pub keep_active: bool,
    pub destroy_content: bool,
    pub system_decorations: bool,
    pub start_app_enabled: bool,
    pub start_app_package: String,
    pub start_app_force_stop: bool,
}

impl Default for ScrcpyVirtualDisplayConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            use_main_size: true,
            width: 1280,
            height: 720,
            dpi: 240,
            keep_active: true,
            destroy_content: false,
            system_decorations: true,
            start_app_enabled: false,
            start_app_package: String::new(),
            start_app_force_stop: false,
        }
    }
}

impl ScrcpyVirtualDisplayConfig {
    fn validate(&self) -> Result<(), String> {
        if self.enabled && !self.use_main_size {
            if self.width == 0 || self.height == 0 || self.dpi == 0 {
                return Err("virtual display width, height and dpi must be greater than 0".to_string());
            }
            if self.width > 16_384 || self.height > 16_384 || self.dpi > 2_000 {
                return Err("virtual display size or dpi is outside the supported range".to_string());
            }
        }
        if self.start_app_enabled {
            let package = self.start_app_package.trim();
            if !is_valid_package_name(package) {
                return Err(format!("invalid virtual-display app package: {package}"));
            }
        }
        Ok(())
    }

    pub fn server_args(&self) -> Vec<String> {
        if !self.enabled {
            return Vec::new();
        }
        let new_display = if self.use_main_size {
            "new_display=".to_string()
        } else {
            format!("new_display={}x{}/{}", self.width, self.height, self.dpi)
        };
        vec![
            new_display,
            format!("keep_active={}", self.keep_active),
            format!("vd_destroy_content={}", self.destroy_content),
            format!("vd_system_decorations={}", self.system_decorations),
        ]
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ScrcpyPreset {
    pub id: String,
    pub name: String,
    pub video: bool,
    pub audio: bool,
    pub virtual_display: ScrcpyVirtualDisplayConfig,
    pub parameters: Vec<ScrcpyParameter>,
}

impl Default for ScrcpyPreset {
    fn default() -> Self {
        Self {
            id: "custom".to_string(),
            name: "自定义预设".to_string(),
            video: true,
            audio: true,
            virtual_display: ScrcpyVirtualDisplayConfig::default(),
            parameters: Vec::new(),
        }
    }
}

impl ScrcpyPreset {
    pub fn qualcomm_hevc_low_latency() -> Self {
        let server = ScrcpyParameterScope::Server;
        Self {
            id: "qualcomm-hevc-low-latency".to_string(),
            name: "Qualcomm H.265 低延迟".to_string(),
            video: true,
            audio: false,
            virtual_display: ScrcpyVirtualDisplayConfig::default(),
            parameters: vec![
                parameter("video-codec", "video_codec", "h265", server),
                parameter(
                    "video-encoder",
                    "video_encoder",
                    "c2.qti.hevc.encoder.cq",
                    server,
                ),
                parameter("video-bit-rate", "video_bit_rate", "5000000", server),
                parameter("max-fps", "max_fps", "60", server),
                parameter(
                    "mouse",
                    "mouse",
                    "uhid",
                    ScrcpyParameterScope::ClientOnly,
                ),
                parameter(
                    "video-buffer",
                    "video_buffer",
                    "0",
                    ScrcpyParameterScope::ClientOnly,
                ),
            ],
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if !is_valid_id(&self.id) {
            return Err(format!("invalid preset id: {}", self.id));
        }
        if self.name.trim().is_empty() || self.name.chars().count() > 80 {
            return Err("preset name must contain 1 to 80 characters".to_string());
        }
        if self.parameters.len() > MAX_PARAMETERS_PER_PRESET {
            return Err(format!(
                "preset '{}' has more than {MAX_PARAMETERS_PER_PRESET} parameters",
                self.name
            ));
        }
        self.virtual_display.validate()?;

        let mut ids = HashSet::new();
        let mut server_keys = HashSet::new();
        for parameter in &self.parameters {
            if !is_valid_id(&parameter.id) || !ids.insert(parameter.id.as_str()) {
                return Err(format!(
                    "preset '{}' contains an invalid or duplicate parameter id",
                    self.name
                ));
            }
            if !parameter.enabled {
                continue;
            }
            let key = normalize_key(&parameter.key)?;
            validate_value(&parameter.value)?;
            if parameter.scope == ScrcpyParameterScope::Server {
                if RESERVED_SERVER_KEYS.contains(&key.as_str()) {
                    return Err(format!(
                        "server option '{key}' is managed by LowCast and cannot be overridden"
                    ));
                }
                if !server_keys.insert(key.clone()) {
                    return Err(format!(
                        "preset '{}' contains duplicate server option '{key}'",
                        self.name
                    ));
                }
            }
        }
        Ok(())
    }

    pub fn apply_server_parameters(&self, args: &mut Vec<String>) -> Result<(), String> {
        self.validate()?;
        for parameter in self
            .parameters
            .iter()
            .filter(|parameter| parameter.enabled)
            .filter(|parameter| parameter.scope == ScrcpyParameterScope::Server)
        {
            let key = normalize_key(&parameter.key)?;
            upsert_server_arg(args, &key, &parameter.value);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ScrcpyModuleConfig {
    pub enabled: bool,
    pub active_preset_id: String,
    pub presets: Vec<ScrcpyPreset>,
}

impl Default for ScrcpyModuleConfig {
    fn default() -> Self {
        let preset = ScrcpyPreset::qualcomm_hevc_low_latency();
        Self {
            enabled: true,
            active_preset_id: preset.id.clone(),
            presets: vec![preset],
        }
    }
}

impl ScrcpyModuleConfig {
    pub fn active_preset(&self) -> Option<&ScrcpyPreset> {
        if !self.enabled {
            return None;
        }
        self.presets
            .iter()
            .find(|preset| preset.id == self.active_preset_id)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.presets.is_empty() || self.presets.len() > MAX_PRESETS {
            return Err(format!(
                "scrcpy module must contain 1 to {MAX_PRESETS} presets"
            ));
        }
        let mut ids = HashSet::new();
        for preset in &self.presets {
            preset.validate()?;
            if !ids.insert(preset.id.as_str()) {
                return Err(format!("duplicate preset id: {}", preset.id));
            }
        }
        if !ids.contains(self.active_preset_id.as_str()) {
            return Err("active scrcpy preset does not exist".to_string());
        }
        Ok(())
    }
}

fn parameter(id: &str, key: &str, value: &str, scope: ScrcpyParameterScope) -> ScrcpyParameter {
    ScrcpyParameter {
        id: id.to_string(),
        enabled: true,
        key: key.to_string(),
        value: value.to_string(),
        scope,
    }
}

fn is_valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
}

fn normalize_key(value: &str) -> Result<String, String> {
    let key = value
        .trim()
        .trim_start_matches('-')
        .replace('-', "_")
        .to_ascii_lowercase();
    if key.is_empty()
        || key.len() > 80
        || !key
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
    {
        return Err(format!("invalid scrcpy option key: {value}"));
    }
    Ok(key)
}

fn validate_value(value: &str) -> Result<(), String> {
    if value.len() > 512 {
        return Err("scrcpy option value is too long".to_string());
    }
    if value.chars().any(|ch| {
        ch.is_whitespace()
            || ch.is_control()
            || matches!(ch, ';' | '&' | '|' | '`' | '$' | '<' | '>' | '\'' | '"')
    }) {
        return Err(format!(
            "scrcpy option value contains unsupported shell characters: {value}"
        ));
    }
    Ok(())
}

fn is_valid_package_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && value.split('.').all(|part| {
            !part.is_empty()
                && part
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
        })
}

fn upsert_server_arg(args: &mut Vec<String>, key: &str, value: &str) {
    let prefix = format!("{key}=");
    let replacement = format!("{key}={value}");
    if let Some(existing) = args.iter_mut().find(|arg| arg.starts_with(&prefix)) {
        *existing = replacement;
    } else {
        args.push(replacement);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_preset_matches_requested_command() {
        let preset = ScrcpyPreset::qualcomm_hevc_low_latency();
        assert!(!preset.audio);
        assert!(preset.validate().is_ok());

        let mut args = vec![
            "video_codec=h264".to_string(),
            "video_bit_rate=12000000".to_string(),
        ];
        preset.apply_server_parameters(&mut args).unwrap();
        assert!(args.contains(&"video_codec=h265".to_string()));
        assert!(args.contains(&"video_encoder=c2.qti.hevc.encoder.cq".to_string()));
        assert!(args.contains(&"video_bit_rate=5000000".to_string()));
        assert!(args.contains(&"max_fps=60".to_string()));
        assert!(!args.iter().any(|arg| arg.starts_with("mouse=")));
        assert!(!args.iter().any(|arg| arg.starts_with("video_buffer=")));
    }

    #[test]
    fn rejects_transport_override_and_shell_characters() {
        let mut preset = ScrcpyPreset::default();
        preset.parameters.push(parameter(
            "bad-key",
            "scid",
            "1234",
            ScrcpyParameterScope::Server,
        ));
        assert!(preset.validate().is_err());

        preset.parameters[0].key = "encoder".to_string();
        preset.parameters[0].value = "ok;rm".to_string();
        assert!(preset.validate().is_err());
    }

    #[test]
    fn virtual_display_builds_server_options_and_validates_package() {
        let mut display = ScrcpyVirtualDisplayConfig {
            enabled: true,
            use_main_size: false,
            width: 1920,
            height: 1080,
            dpi: 420,
            start_app_enabled: true,
            start_app_package: "com.example.game".to_string(),
            ..Default::default()
        };
        assert!(display.validate().is_ok());
        assert!(display
            .server_args()
            .contains(&"new_display=1920x1080/420".to_string()));

        display.start_app_package = "bad package".to_string();
        assert!(display.validate().is_err());
    }
}
