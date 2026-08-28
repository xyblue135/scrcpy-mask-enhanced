//! 子预设（Mapping Override）：在主预设基础上**只覆盖部分按钮的位置**。
//!
//! ## 设计目标
//!
//! 解决"按快捷键全套切换预设"在以下场景的痛点：
//! 1. 切换键位和映射功能键冲突时（如 X 既是切换键、又是单击按钮）
//! 2. 不同游戏状态（持枪 / 瞄准 / 开车）只想挪动**少数**按钮位置，但整体切换会把
//!    其他不需要变的按钮也换掉
//!
//! ## 数据格式
//!
//! 主预设（不变，仍是 `MappingConfig` JSON）和子预设（`MappingOverrideConfig`）
//! 用 `kind` 字段区分。子预设引用主预设的 `parent` 文件名，**只存被覆盖的按钮 id
//! 和新位置**：
//!
//! ```jsonc
//! // 1持枪_瞄准.override.json
//! {
//!   "kind": "override",
//!   "version": "0.0.1",
//!   "parent": "1持枪.json",
//!   "overrides": [
//!     { "id": "aim",  "x": 2150, "y": 1180 },
//!     { "id": "fire", "x": 1800, "y": 1240 }
//!   ]
//! }
//! ```
//!
//! ## 行为
//!
//! 加载子预设时先加载 `parent`（递归：如果 parent 也是 override 就继续往父层找），
//! 然后按 id 覆盖同名按钮的 `position`。未在 parent 中找到的 id 仅记录日志，
//! 不报错（parent 后续添加新按钮时，旧 override 不会因此失效）。

use std::path::Path;

use bevy_ineffable::config::InputConfig;
use serde::{Deserialize, Serialize};

use crate::mask::mapping::config::{BindMappingConfig, MappingConfig};
use crate::mask::mapping::utils::Position;
use crate::utils::{is_safe_file_name, relate_to_data_path};

/// 子预设文件 / 主预设文件 判别字段。
/// 旧版主预设 JSON 没有此字段，`serde(default)` 视为 `"base"`，保持向后兼容。
pub const KIND_BASE: &str = "base";
pub const KIND_OVERRIDE: &str = "override";

/// 单个按钮的位置覆盖。
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PositionOverride {
    pub id: String,
    pub x: i32,
    pub y: i32,
}

impl PositionOverride {
    pub fn position(&self) -> Position {
        Position { x: self.x, y: self.y }
    }
}

/// 子预设文件 schema。
///
/// 与 `MappingConfig`（主预设）的核心区别：
/// - 多了 `parent` 字段（主预设文件名）
/// - 多了 `kind: "override"` 判别字段
/// - `overrides` 列表只存被覆盖的按钮 id + 新位置
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MappingOverrideConfig {
    /// 必须是 `"override"`，用于反序列化时区分主/子预设。
    #[serde(default = "default_kind_override")]
    pub kind: String,
    pub version: String,
    /// 主预设文件名（如 `"1持枪.json"`）。加载时会先加载它，再应用 overrides。
    pub parent: String,
    #[serde(default)]
    pub overrides: Vec<PositionOverride>,
}

fn default_kind_override() -> String {
    KIND_OVERRIDE.to_string()
}

/// 加载结果：主预设直接得到 BindMappingConfig + InputConfig；
/// 子预设带着 parent 名和原始 override 列表（供上层决定是否在 UI 上提示"这是子预设"）。
#[derive(Debug)]
pub enum LoadedMapping {
    /// 加载到的是主预设。
    Base {
        bind: BindMappingConfig,
        input: InputConfig,
    },
    /// 加载到的是子预设；`resolved_*` 是已经合并 parent + override 的最终结果。
    /// `parent` / `raw_overrides` 保留原始引用，方便诊断与"重新对齐"功能。
    Override {
        parent_file: String,
        raw_overrides: Vec<PositionOverride>,
        bind: BindMappingConfig,
        input: InputConfig,
    },
}

/// 从原始 JSON 字符串判定文件类型，并返回：
/// - `MappingConfig`（主预设）；或
/// - `MappingOverrideConfig`（子预设，parent 字段还没展开）
fn parse_file(json: &str) -> Result<EitherConfig, String> {
    // 用 `kind` 字段判定；旧文件无 `kind` 视为 base。
    let kind_hint: Option<String> = serde_json::from_str::<serde_json::Value>(json)
        .ok()
        .and_then(|v| v.get("kind").and_then(|k| k.as_str()).map(str::to_string));

    match kind_hint.as_deref() {
        Some(KIND_OVERRIDE) => serde_json::from_str::<MappingOverrideConfig>(json)
            .map(EitherConfig::Override)
            .map_err(|e| format!("invalid override config: {e}")),
        _ => serde_json::from_str::<MappingConfig>(json)
            .map(EitherConfig::Base)
            .map_err(|e| format!("invalid mapping config: {e}")),
    }
}

pub enum EitherConfig {
    Base(MappingConfig),
    Override(MappingOverrideConfig),
}

/// 从文件加载映射配置，自动识别主预设 / 子预设。
///
/// - 主预设：直接返回 `LoadedMapping::Base`
/// - 子预设：递归加载 parent（防止"override 的 parent 也是 override"），合并 overrides，
///   返回 `LoadedMapping::Override`
///
/// 包含「在 data 目录中查找文件 + 安全文件名校验 + 递归父级解析」所有动作，
/// 供 `quick_switch.rs` 和 `main.rs` 启动加载共用。
pub fn load_mapping_with_overrides(
    file_name: impl AsRef<str>,
) -> Result<LoadedMapping, String> {
    if !is_safe_file_name(file_name.as_ref()) {
        return Err(format!("unsafe file name: {}", file_name.as_ref()));
    }

    let path = relate_to_data_path(["mapping", file_name.as_ref()]);
    if !path.exists() {
        return Err(format!("mapping config not found: {}", file_name.as_ref()));
    }
    let json = std::fs::read_to_string(&path)
        .map_err(|e| format!("read mapping config failed: {e}"))?;

    load_from_json(&json, file_name.as_ref(), 0)
}

fn load_from_json(
    json: &str,
    file_name: &str,
    depth: u32,
) -> Result<LoadedMapping, String> {
    // 防递归过深：override 的 parent 不允许再指向 override（保持简单）。
    // 实际上允许一层 override-of-override 也行，但 MVP 限制一层。
    if depth > 4 {
        return Err("override nesting too deep (max 4)".to_string());
    }

    match parse_file(json)? {
        EitherConfig::Base(config) => {
            validate_minimal(&config)?;
            let bind: BindMappingConfig = config.into();
            let input = InputConfig::from(&bind);
            Ok(LoadedMapping::Base { bind, input })
        }
        EitherConfig::Override(ov) => {
            if ov.parent.trim().is_empty() {
                return Err(format!("override '{file_name}' has empty parent"));
            }
            if !is_safe_file_name(&ov.parent) {
                return Err(format!(
                    "override '{file_name}' has unsafe parent name: {}",
                    ov.parent
                ));
            }
            // 1. 加载 parent（注意：parent 本身也可能是 override，但 MVP 限制为 base）
            let parent_path = relate_to_data_path(["mapping", &ov.parent]);
            if !parent_path.exists() {
                return Err(format!(
                    "override '{file_name}' parent not found: {}",
                    ov.parent
                ));
            }
            let parent_json = std::fs::read_to_string(&parent_path)
                .map_err(|e| format!("read parent mapping config failed: {e}"))?;
            let LoadedMapping::Base { mut bind, input: parent_input } =
                load_from_json(&parent_json, &ov.parent, depth + 1)?
            else {
                return Err(format!(
                    "override '{}' parent '{}' must be a base mapping, not another override",
                    file_name, ov.parent
                ));
            };

            // 2. 应用 overrides 到 bind
            let unknown = apply_position_overrides_to_bind(&mut bind, &ov.overrides);
            if !unknown.is_empty() {
                log::warn!(
                    "[Mapping] override '{file_name}' references unknown ids (ignored): {unknown:?}"
                );
            }
            let input = InputConfig::from(&bind);
            // parent_input 是 parent 的 InputConfig，已经被 bind 覆盖后不需要了
            let _ = parent_input;

            Ok(LoadedMapping::Override {
                parent_file: ov.parent,
                raw_overrides: ov.overrides,
                bind,
                input,
            })
        }
    }
}

/// 最小化校验：只检查 version / original_size 不为零，避免在 override 阶段跑全套 validation
/// （完整 validation 在加载 base 时已经做过了）。
fn validate_minimal(config: &MappingConfig) -> Result<(), String> {
    if config.original_size.width == 0 || config.original_size.height == 0 {
        return Err("original_size is zero".to_string());
    }
    Ok(())
}

/// 把 PositionOverride 应用到 BindMappingConfig（按 mapping id 匹配）。
/// 返回未匹配的 id 列表（仅警告用，不报错）。
pub fn apply_position_overrides_to_bind(
    bind: &mut BindMappingConfig,
    overrides: &[PositionOverride],
) -> Vec<String> {
    use crate::mask::mapping::config::BindMappingType;

    let mut unknown: Vec<String> = Vec::new();
    // 先建一个 id -> action 的索引（mapping_id_actions）
    for ov in overrides {
        let Some(action) = bind.mapping_id_actions.get(&ov.id) else {
            unknown.push(ov.id.clone());
            continue;
        };
        let Some(mapping) = bind.mappings.get_mut(action) else {
            unknown.push(ov.id.clone());
            continue;
        };
        let new_pos = ov.position();
        match mapping {
            BindMappingType::SingleTap(m) => m.position = new_pos,
            BindMappingType::RepeatTap(m) => m.position = new_pos,
            BindMappingType::MultipleTap(m) => {
                // 多重点击：只覆盖第一个 item（多数情况下只有一个）
                if let Some(item) = m.items.first_mut() {
                    item.position = new_pos;
                }
            }
            BindMappingType::Swipe(m) => {
                // 滑动：覆盖起点（positions[0]）
                if let Some(p) = m.positions.first_mut() {
                    *p = new_pos;
                }
            }
            BindMappingType::DirectionPad(m) => m.position = new_pos,
            BindMappingType::MouseCastSpell(m) => m.position = new_pos,
            BindMappingType::PadCastSpell(m) => m.position = new_pos,
            BindMappingType::CancelCast(m) => m.position = new_pos,
            BindMappingType::Observation(m) => m.position = new_pos,
            BindMappingType::Fps(m) => m.position = new_pos,
            BindMappingType::Fire(m) => m.position = new_pos,
            BindMappingType::RawInput(m) => m.position = new_pos,
            BindMappingType::Script(m) => m.position = new_pos,
            BindMappingType::Wheel(m) => m.position = new_pos,
        }
    }
    unknown
}

/// 把 MappingOverrideConfig 写入磁盘（供 web API 调用）。
pub fn save_override_config(config: &MappingOverrideConfig, path: &Path) -> Result<(), String> {
    use std::fs::File;
    use std::io::Write;

    if !is_safe_file_name(&config.parent) {
        return Err(format!("unsafe parent name: {}", config.parent));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create mapping dir failed: {e}"))?;
    }
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("serialize override config failed: {e}"))?;
    let mut f = File::create(path).map_err(|e| format!("create file failed: {e}"))?;
    f.write_all(json.as_bytes())
        .map_err(|e| format!("write file failed: {e}"))?;
    Ok(())
}

/// 便捷函数：检测文件是主预设还是子预设（不实际加载完整内容）。
/// 用于 web API 列表展示时标注类型。
pub fn detect_kind(file_name: &str) -> Result<&'static str, String> {
    if !is_safe_file_name(file_name) {
        return Err(format!("unsafe file name: {file_name}"));
    }
    let path = relate_to_data_path(["mapping", file_name]);
    if !path.exists() {
        return Err(format!("file not found: {file_name}"));
    }
    let json = std::fs::read_to_string(&path)
        .map_err(|e| format!("read failed: {e}"))?;
    let kind: Option<String> = serde_json::from_str::<serde_json::Value>(&json)
        .ok()
        .and_then(|v| v.get("kind").and_then(|k| k.as_str()).map(str::to_string));
    Ok(match kind.as_deref() {
        Some(KIND_OVERRIDE) => KIND_OVERRIDE,
        _ => KIND_BASE,
    })
}
