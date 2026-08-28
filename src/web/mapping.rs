use std::{fs, str::FromStr};

use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use bevy::math::Vec2;
use rust_i18n::t;
use serde::Deserialize;
use serde_json::json;
use tokio::sync::oneshot;

use crate::{
    config::{LocalConfig, MappingQuickSwitch},
    mask::{
        mapping::{
            binding::MergedButton,
            config::{
                MappingConfig, MappingType, save_mapping_config,
                validate_mapping_config_diagnostics,
            },
        },
        mask_command::MaskCommand,
    },
    utils::{is_safe_file_name, relate_to_data_path},
    web::{JsonResponse, WebServerError},
};

#[derive(Debug, Clone)]
pub struct AppStatMapping {
    m_tx: crossbeam_channel::Sender<(MaskCommand, oneshot::Sender<Result<String, String>>)>,
}

pub fn routers(
    m_tx: crossbeam_channel::Sender<(MaskCommand, oneshot::Sender<Result<String, String>>)>,
) -> Router {
    Router::new()
        .route("/change_active_mapping", post(change_active_mapping))
        .route("/create_mapping", post(create_mapping))
        .route("/rename_mapping", post(rename_mapping))
        .route("/duplicate_mapping", post(duplicate_mapping))
        .route("/delete_mapping", post(delete_mapping))
        .route("/update_mapping", post(update_mapping))
        .route("/validate", post(validate_mapping))
        .route("/read_mapping", post(read_mapping))
        .route("/get_mapping_list", get(get_mapping_list))
        .route(
            "/update_mapping_quick_switch",
            post(update_mapping_quick_switch),
        )
        .route("/migrate_mapping", post(migrate_mapping))
        .route("/clear_all_mappings", post(clear_all_mappings))
        .with_state(AppStatMapping { m_tx })
}

#[derive(Deserialize)]
struct PostDataChangeActiveMapping {
    file: String,
}

async fn change_active_mapping(
    State(state): State<AppStatMapping>,
    Json(mut payload): Json<PostDataChangeActiveMapping>,
) -> Result<JsonResponse, WebServerError> {
    if !payload.file.ends_with(".json") {
        payload.file.push_str(".json");
    }

    let (oneshot_tx, oneshot_rx) = oneshot::channel::<Result<String, String>>();
    state
        .m_tx
        .send((
            MaskCommand::LoadAndActivateMappingConfig {
                file_name: payload.file.clone(),
            },
            oneshot_tx,
        ))
        .unwrap();
    match oneshot_rx.await.unwrap() {
        Ok(_) => {
            LocalConfig::set_active_mapping_file(payload.file.clone());
            log::info!(
                "[WebServer] {}: {}",
                t!("web.mapping.setActiveMapping"),
                payload.file
            );

            Ok(JsonResponse::success(
                format!(
                    "{}: {}",
                    t!("web.mapping.setActiveMappingSuccess"),
                    payload.file
                ),
                None,
            ))
        }
        Err(e) => Err(WebServerError::bad_request(format!(
            "{}: {}. {}",
            t!("web.mapping.failedToLoadMappingConfig"),
            payload.file,
            e
        ))),
    }
}

#[derive(Deserialize)]
struct PostDataNewMapping {
    file: String,
    config: MappingConfig,
}

fn mapping_validation_data(config: &MappingConfig) -> Option<serde_json::Value> {
    let diagnostics = validate_mapping_config_diagnostics(config);
    if diagnostics.is_empty() {
        None
    } else {
        Some(json!({
            "valid": false,
            "diagnostics": diagnostics,
        }))
    }
}

fn mapping_validation_error(config: &MappingConfig) -> Option<WebServerError> {
    mapping_validation_data(config).map(|data| {
        WebServerError::bad_request_data(
            t!("mask.mapping.mappingConfigValidationFailed").to_string(),
            data,
        )
    })
}

async fn validate_mapping(
    Json(payload): Json<PostDataNewMapping>,
) -> Result<JsonResponse, WebServerError> {
    let diagnostics = validate_mapping_config_diagnostics(&payload.config);
    Ok(JsonResponse::success(
        t!("web.script.validateScriptSuccess"),
        Some(json!({
            "valid": diagnostics.is_empty(),
            "diagnostics": diagnostics,
        })),
    ))
}

async fn create_mapping(
    Json(mut payload): Json<PostDataNewMapping>,
) -> Result<JsonResponse, WebServerError> {
    if !payload.file.ends_with(".json") {
        payload.file.push_str(".json");
    }

    let bad_request =
        |msg| -> Result<JsonResponse, WebServerError> { Err(WebServerError::bad_request(msg)) };

    if !is_safe_file_name(payload.file.as_ref()) {
        return bad_request(format!(
            "{}: {}",
            t!("web.mapping.nameNotSafe"),
            payload.file
        ));
    }

    let config_path = relate_to_data_path(["mapping", &payload.file]);
    if config_path.exists() {
        return bad_request(format!(
            "{}: {}",
            t!("web.mapping.mappingConfigExists"),
            payload.file
        ));
    }

    if let Some(error) = mapping_validation_error(&payload.config) {
        return Err(error);
    }

    // save to file
    save_mapping_config(&payload.config, &config_path)
        .map_err(|e| WebServerError::bad_request(e))?;

    log::info!(
        "[WebServer] {}: {}",
        t!("web.mapping.createMappingConfig"),
        payload.file
    );
    Ok(JsonResponse::success(
        format!(
            "{}: {}",
            t!("web.mapping.createMappingConfig"),
            payload.file
        ),
        None,
    ))
}

#[derive(Deserialize)]
struct PostDataMappingFile {
    file: String,
}

async fn delete_mapping(
    State(state): State<AppStatMapping>,
    Json(mut payload): Json<PostDataMappingFile>,
) -> Result<JsonResponse, WebServerError> {
    if !payload.file.ends_with(".json") {
        payload.file.push_str(".json");
    }

    let bad_request =
        |msg| -> Result<JsonResponse, WebServerError> { Err(WebServerError::bad_request(msg)) };

    if !is_safe_file_name(payload.file.as_ref()) {
        return bad_request(format!(
            "{}: {}",
            t!("web.mapping.nameNotSafe"),
            payload.file
        ));
    }

    let (oneshot_tx, oneshot_rx) = oneshot::channel::<Result<String, String>>();
    state
        .m_tx
        .send((MaskCommand::GetActiveMapping, oneshot_tx))
        .unwrap();
    let file = oneshot_rx.await.unwrap().unwrap();
    if file == payload.file {
        return bad_request(t!("web.mapping.cannotDeleteActiveMapping").to_string());
    }
    let file_path = relate_to_data_path(["mapping", &payload.file]);
    if !file_path.exists() {
        return bad_request(format!(
            "{}: {}",
            t!("web.mapping.mappingConfigNotExists"),
            payload.file
        ));
    }
    fs::remove_file(file_path).map_err(|e| {
        WebServerError::bad_request(format!(
            "{} {}: {}",
            t!("web.mapping.deleteMappingConfigError"),
            payload.file,
            e
        ))
    })?;

    let mut quick_switches = LocalConfig::get_mapping_quick_switches();
    quick_switches.retain(|config| config.file != payload.file);
    LocalConfig::set_mapping_quick_switches(quick_switches);

    log::info!(
        "[WebServer] {}: {}",
        t!("web.mapping.deleteMappingConfig"),
        payload.file
    );
    Ok(JsonResponse::success(
        format!(
            "{}: {}",
            t!("web.mapping.deleteMappingConfig"),
            payload.file
        ),
        None,
    ))
}

async fn clear_all_mappings(
    State(state): State<AppStatMapping>,
) -> Result<JsonResponse, WebServerError> {
    let dir_path = relate_to_data_path(["mapping"]);
    if !dir_path.exists() {
        return Ok(JsonResponse::success(
            t!("web.mapping.clearAllMappingsSuccess"),
            Some(json!({"deleted_count": 0})),
        ));
    }

    // Get active mapping file to avoid deleting it
    let (oneshot_tx, oneshot_rx) = oneshot::channel::<Result<String, String>>();
    state
        .m_tx
        .send((MaskCommand::GetActiveMapping, oneshot_tx))
        .unwrap();
    let active_file = oneshot_rx.await.unwrap().unwrap();

    let mut deleted_count = 0u32;
    let entries = fs::read_dir(&dir_path).map_err(|e| {
        WebServerError::bad_request(format!(
            "{}: {}",
            t!("web.mapping.unableReadMappingConfigDir"),
            e
        ))
    })?;

    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.is_file() && path.extension().map_or(false, |ext| ext == "json") {
            if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                if file_name == active_file {
                    continue; // skip active mapping
                }
                fs::remove_file(&path).ok();
                deleted_count += 1;
            }
        }
    }

    let mut quick_switches = LocalConfig::get_mapping_quick_switches();
    quick_switches.retain(|config| config.file != active_file);
    LocalConfig::set_mapping_quick_switches(quick_switches);

    log::info!(
        "[WebServer] {}: {} deleted",
        t!("web.mapping.clearAllMappings"),
        deleted_count
    );
    Ok(JsonResponse::success(
        t!("web.mapping.clearAllMappingsSuccess"),
        Some(json!({"deleted_count": deleted_count})),
    ))
}

#[derive(Deserialize)]
struct PostDataRenameMappingFile {
    file: String,
    new_file: String,
}

async fn rename_mapping(
    State(state): State<AppStatMapping>,
    Json(mut payload): Json<PostDataRenameMappingFile>,
) -> Result<JsonResponse, WebServerError> {
    if !payload.file.ends_with(".json") {
        payload.file.push_str(".json");
    }

    if !payload.new_file.ends_with(".json") {
        payload.new_file.push_str(".json");
    }

    let bad_request =
        |msg| -> Result<JsonResponse, WebServerError> { Err(WebServerError::bad_request(msg)) };

    if !is_safe_file_name(payload.file.as_ref()) {
        return bad_request(format!(
            "{}: {}",
            t!("web.mapping.nameNotSafe"),
            payload.file
        ));
    }
    if !is_safe_file_name(payload.new_file.as_ref()) {
        return bad_request(format!(
            "{}: {}",
            t!("web.mapping.nameNotSafe"),
            payload.new_file
        ));
    }

    // rename file
    let old_path = relate_to_data_path(["mapping", &payload.file]);
    if !old_path.exists() {
        return bad_request(format!(
            "{}: {}",
            t!("web.mapping.mappingConfigNotFound"),
            old_path.to_str().unwrap()
        ));
    }
    let new_path = relate_to_data_path(["mapping", &payload.new_file]);
    if new_path.exists() {
        return bad_request(format!(
            "{}: {}",
            t!("web.mapping.mappingConfigExists"),
            new_path.to_str().unwrap()
        ));
    }
    fs::rename(old_path, new_path).map_err(|e| WebServerError::internal_error(e.to_string()))?;

    let mut quick_switches = LocalConfig::get_mapping_quick_switches();
    if let Some(config) = quick_switches
        .iter_mut()
        .find(|config| config.file == payload.file)
    {
        config.file.clone_from(&payload.new_file);
        LocalConfig::set_mapping_quick_switches(quick_switches);
    }

    // get active mapping file
    let (oneshot_tx, oneshot_rx) = oneshot::channel::<Result<String, String>>();
    state
        .m_tx
        .send((MaskCommand::GetActiveMapping, oneshot_tx))
        .unwrap();
    let file = oneshot_rx.await.unwrap().unwrap();
    if file == payload.file {
        // if active, set new active mapping
        let (oneshot_tx, oneshot_rx) = oneshot::channel::<Result<String, String>>();
        state
            .m_tx
            .send((
                MaskCommand::LoadAndActivateMappingConfig {
                    file_name: payload.new_file.clone(),
                },
                oneshot_tx,
            ))
            .unwrap();
        match oneshot_rx.await.unwrap() {
            Ok(_) => {
                LocalConfig::set_active_mapping_file(payload.new_file.clone());
                let msg = t!(
                    "web.mapping.renameActivateMappingSuccess",
                    oldFile => payload.file,
                    newFile => payload.new_file
                );
                log::info!("[WebServer] {}", msg);
                return Ok(JsonResponse::success(msg, None));
            }
            Err(e) => {
                return Err(WebServerError::bad_request(format!(
                    "{}: {}. {}",
                    t!("web.mapping.failedToLoadMappingConfig"),
                    payload.file,
                    e
                )));
            }
        }
    }

    let msg = t!(
        "web.mapping.renameMappingConfigSuccess",
        file => payload.file,
        newFile => payload.new_file
    );
    log::info!("[WebServer] {}", msg);
    Ok(JsonResponse::success(msg, None))
}

#[derive(Deserialize)]
struct PostDataDuplicateMappingFile {
    file: String,
    new_file: String,
}

async fn duplicate_mapping(
    Json(mut payload): Json<PostDataDuplicateMappingFile>,
) -> Result<JsonResponse, WebServerError> {
    if !payload.file.ends_with(".json") {
        payload.file.push_str(".json");
    }

    if !payload.new_file.ends_with(".json") {
        payload.new_file.push_str(".json");
    }

    let bad_request =
        |msg| -> Result<JsonResponse, WebServerError> { Err(WebServerError::bad_request(msg)) };

    if !is_safe_file_name(payload.file.as_ref()) {
        return bad_request(format!(
            "{}: {}",
            t!("web.mapping.nameNotSafe"),
            payload.file
        ));
    }
    if !is_safe_file_name(payload.new_file.as_ref()) {
        return bad_request(format!(
            "New {}: {}",
            t!("web.mapping.nameNotSafe"),
            payload.new_file
        ));
    }

    let old_path = relate_to_data_path(["mapping", &payload.file]);
    if !old_path.exists() {
        return bad_request(format!(
            "{}: {}",
            t!("web.mapping.mappingConfigExists"),
            old_path.to_str().unwrap()
        ));
    }
    let new_path = relate_to_data_path(["mapping", &payload.new_file]);
    if new_path.exists() {
        return bad_request(format!(
            "{}: {}",
            t!("web.mapping.mappingConfigExists"),
            new_path.to_str().unwrap()
        ));
    }
    fs::copy(old_path, new_path).map_err(|e| WebServerError::internal_error(e.to_string()))?;
    log::info!(
        "[WebServer] {}",
        t!(
            "web.mapping.copyMappingConfig",
            file => payload.file,
            newFile => payload.new_file
        )
    );
    Ok(JsonResponse::success(
        t!(
            "web.mapping.copyMappingConfig",
            file => payload.file,
            newFile => payload.new_file
        ),
        None,
    ))
}

async fn update_mapping(
    State(state): State<AppStatMapping>,
    Json(mut payload): Json<PostDataNewMapping>,
) -> Result<JsonResponse, WebServerError> {
    if !payload.file.ends_with(".json") {
        payload.file.push_str(".json");
    }

    let bad_request =
        |msg| -> Result<JsonResponse, WebServerError> { Err(WebServerError::bad_request(msg)) };

    if !is_safe_file_name(payload.file.as_ref()) {
        return bad_request(format!(
            "{}: {}",
            t!("web.mapping.nameNotSafe"),
            payload.file
        ));
    }

    if let Some(error) = mapping_validation_error(&payload.config) {
        return Err(error);
    }

    // save to file
    let config_path = relate_to_data_path(["mapping", &payload.file]);
    save_mapping_config(&payload.config, &config_path)
        .map_err(|e| WebServerError::bad_request(e))?;

    // get active mapping file
    let (oneshot_tx, oneshot_rx) = oneshot::channel::<Result<String, String>>();
    state
        .m_tx
        .send((MaskCommand::GetActiveMapping, oneshot_tx))
        .unwrap();
    let file = oneshot_rx.await.unwrap().unwrap();
    if file == payload.file {
        // if active, refresh active mapping
        let (oneshot_tx, oneshot_rx) = oneshot::channel::<Result<String, String>>();
        state
            .m_tx
            .send((
                MaskCommand::LoadAndActivateMappingConfig {
                    file_name: payload.file.clone(),
                },
                oneshot_tx,
            ))
            .unwrap();
        match oneshot_rx.await.unwrap() {
            Ok(_) => {
                LocalConfig::set_active_mapping_file(payload.file.clone());
                let msg = format!(
                    "{}: {}",
                    t!("web.mapping.updateAndActivateMappingConfig"),
                    payload.file
                );

                log::info!("[WebServer] {}", msg);
                Ok(JsonResponse::success(msg, None))
            }
            Err(e) => Err(WebServerError::bad_request(format!(
                "{} {}. {}",
                t!("web.mapping.failedToLoadUpdatedMappingConfig"),
                payload.file,
                e
            ))),
        }
    } else {
        let msg = format!("{} {}", t!("web.mapping.updateMappingConfig"), payload.file);
        log::info!("[WebServer] {}", msg);
        Ok(JsonResponse::success(msg, None))
    }
}

/// 从单个 mapping JSON 文件中安全地读取 original_size，不解析 mappings。
/// 用于"分辨率 / DPI 对齐"提示，不引入 validation 开销。
fn read_mapping_original_size(file_name: &str) -> Option<serde_json::Value> {
    if !is_safe_file_name(file_name) {
        return None;
    }
    let path = relate_to_data_path(["mapping", file_name]);
    if !path.exists() {
        return None;
    }
    let raw = std::fs::read_to_string(&path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let original_size = value.get("original_size")?;
    if !original_size.is_object() {
        return None;
    }
    Some(json!({
        "width": original_size.get("width").and_then(|v| v.as_u64()).unwrap_or(0),
        "height": original_size.get("height").and_then(|v| v.as_u64()).unwrap_or(0),
        "dpi": original_size.get("dpi").and_then(|v| v.as_u64()).unwrap_or(0),
    }))
}

async fn get_mapping_list(
    State(state): State<AppStatMapping>,
) -> Result<JsonResponse, WebServerError> {
    let dir_path = relate_to_data_path(["mapping"]);
    let entries = fs::read_dir(dir_path).map_err(|e| {
        WebServerError::bad_request(format!(
            "{}: {}",
            t!("web.mapping.unableReadMappingConfigDir"),
            e
        ))
    })?;

    let mut mapping_files: Vec<String> = Vec::new();
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();

        if path.is_file() {
            if path.extension().map_or(false, |ext| ext == "json") {
                if let Some(file_name) = path.file_name() {
                    if let Some(name_str) = file_name.to_str() {
                        mapping_files.push(name_str.to_string());
                    }
                }
            }
        }
    }

    // get active mapping file
    let (oneshot_tx, oneshot_rx) = oneshot::channel::<Result<String, String>>();
    state
        .m_tx
        .send((MaskCommand::GetActiveMapping, oneshot_tx))
        .unwrap();
    let file = oneshot_rx.await.unwrap().unwrap();

    let quick_switches: Vec<MappingQuickSwitch> = LocalConfig::get_mapping_quick_switches()
        .into_iter()
        .filter(|config| mapping_files.contains(&config.file))
        .collect();

    // 为每个预设读取 original_size（不解析 mappings），用于前端显示分辨率后缀
    // 和"与手机分辨率是否一致"的提示。
    let mapping_meta: Vec<serde_json::Value> = mapping_files
        .iter()
        .map(|name| {
            json!({
                "file": name,
                "original_size": read_mapping_original_size(name),
            })
        })
        .collect();

    Ok(JsonResponse::success(
        t!("web.mapping.readMappingListSuccess"),
        Some(json!({
            "mapping_list": mapping_files,
            "mapping_meta": mapping_meta,
            "active_mapping": file,
            "mapping_quick_switches": quick_switches,
            "quick_switch_enabled": LocalConfig::get_quick_switch_enabled(),
            "macro_preset_enabled": LocalConfig::get_macro_preset_enabled(),
            "mapping_randomization_enabled": LocalConfig::get_mapping_randomization_enabled(),
            "button_randomization_enabled": LocalConfig::get_button_randomization_enabled(),
        })),
    ))
}

#[derive(Deserialize)]
struct PostDataMappingQuickSwitch {
    file: String,
    enabled: bool,
    shortcut: Vec<String>,
}

fn canonical_shortcut(shortcut: &[String]) -> Vec<String> {
    let mut canonical = shortcut.to_vec();
    canonical.sort();
    canonical
}

async fn update_mapping_quick_switch(
    Json(mut payload): Json<PostDataMappingQuickSwitch>,
) -> Result<JsonResponse, WebServerError> {
    if !payload.file.ends_with(".json") {
        payload.file.push_str(".json");
    }
    if !is_safe_file_name(&payload.file) {
        return Err(WebServerError::bad_request(format!(
            "{}: {}",
            t!("web.mapping.nameNotSafe"),
            payload.file
        )));
    }
    if !relate_to_data_path(["mapping", &payload.file]).is_file() {
        return Err(WebServerError::bad_request(format!(
            "{}: {}",
            t!("web.mapping.mappingConfigNotExists"),
            payload.file
        )));
    }
    if payload.shortcut.len() > 4 {
        return Err(WebServerError::bad_request(
            "A quick-switch shortcut may contain at most 4 keys",
        ));
    }
    for key in &payload.shortcut {
        match MergedButton::from_str(key) {
            Ok(MergedButton::Keyboard(_)) => {}
            Ok(_) => {
                return Err(WebServerError::bad_request(
                    "Mapping quick switch only accepts keyboard keys",
                ));
            }
            Err(error) => return Err(WebServerError::bad_request(error)),
        }
    }
    let canonical = canonical_shortcut(&payload.shortcut);
    if canonical.windows(2).any(|keys| keys[0] == keys[1]) {
        return Err(WebServerError::bad_request(
            "A quick-switch shortcut cannot contain duplicate keys",
        ));
    }
    if payload.enabled && canonical.is_empty() {
        return Err(WebServerError::bad_request(
            "Set a keyboard shortcut before enabling quick switch",
        ));
    }

    let mut quick_switches = LocalConfig::get_mapping_quick_switches();
    if payload.enabled
        && quick_switches.iter().any(|config| {
            config.enabled
                && config.file != payload.file
                && canonical_shortcut(&config.shortcut) == canonical
        })
    {
        return Err(WebServerError::bad_request(
            "This quick-switch shortcut is already used by another preset",
        ));
    }

    let next = MappingQuickSwitch {
        file: payload.file.clone(),
        enabled: payload.enabled,
        shortcut: payload.shortcut,
    };
    if let Some(config) = quick_switches
        .iter_mut()
        .find(|config| config.file == payload.file)
    {
        *config = next.clone();
    } else {
        quick_switches.push(next.clone());
    }
    LocalConfig::set_mapping_quick_switches(quick_switches);

    Ok(JsonResponse::success(
        format!("Mapping quick switch updated: {}", payload.file),
        Some(json!(next)),
    ))
}

async fn read_mapping(
    Json(mut payload): Json<PostDataMappingFile>,
) -> Result<JsonResponse, WebServerError> {
    if !payload.file.ends_with(".json") {
        payload.file.push_str(".json");
    }

    let bad_request =
        |msg| -> Result<JsonResponse, WebServerError> { Err(WebServerError::bad_request(msg)) };

    if !is_safe_file_name(payload.file.as_ref()) {
        return bad_request(format!(
            "{}: {}",
            t!("web.mapping.nameNotSafe"),
            payload.file
        ));
    }

    // load from file
    let path = relate_to_data_path(["mapping", &payload.file]);
    if !path.exists() {
        return bad_request(format!(
            "{}: {}",
            t!("web.mapping.mappingConfigExists"),
            payload.file
        ));
    }
    let config_string = std::fs::read_to_string(path).map_err(|e| {
        WebServerError::bad_request(format!(
            "{} {}: {}",
            t!("web.mapping.cannotReadMappingConfig"),
            payload.file,
            e
        ))
    })?;
    let mapping_config: MappingConfig = serde_json::from_str(&config_string).map_err(|e| {
        WebServerError::bad_request(format!(
            "{} {}: {}",
            t!("web.mapping.cannotDeserializeConfig"),
            payload.file,
            e
        ))
    })?;

    if let Some(data) = mapping_validation_data(&mapping_config) {
        return Err(WebServerError::bad_request_data(
            format!(
                "{} {}",
                t!("web.mapping.invalidMappingConfig"),
                payload.file
            ),
            data,
        ));
    }

    Ok(JsonResponse::success(
        format!("{} {}", t!("web.mapping.mappingReadSuccess"), payload.file),
        Some(json!({
            "mapping_config": mapping_config,
        })),
    ))
}

#[derive(Deserialize)]
struct PostDataMigrateMappingFile {
    file: String,
    new_file: String,
    width: u32,
    height: u32,
}

async fn migrate_mapping(
    Json(mut payload): Json<PostDataMigrateMappingFile>,
) -> Result<JsonResponse, WebServerError> {
    if !payload.file.ends_with(".json") {
        payload.file.push_str(".json");
    }

    if !payload.new_file.ends_with(".json") {
        payload.new_file.push_str(".json");
    }

    let bad_request =
        |msg| -> Result<JsonResponse, WebServerError> { Err(WebServerError::bad_request(msg)) };

    if !is_safe_file_name(payload.file.as_ref()) {
        return bad_request(format!(
            "{}: {}",
            t!("web.mapping.nameNotSafe"),
            payload.file
        ));
    }

    let old_path = relate_to_data_path(["mapping", &payload.file]);
    if !old_path.exists() {
        return bad_request(format!(
            "{}: {}",
            t!("web.mapping.mappingConfigNotExists"),
            payload.file
        ));
    }

    let new_path = relate_to_data_path(["mapping", &payload.new_file]);
    if new_path.exists() {
        return bad_request(format!(
            "{}: {}",
            t!("web.mapping.mappingConfigExists"),
            payload.new_file
        ));
    }

    let config_string = std::fs::read_to_string(old_path).map_err(|e| {
        WebServerError::bad_request(format!(
            "{} {}: {}",
            t!("web.mapping.cannotReadMappingConfig"),
            payload.file,
            e
        ))
    })?;
    let mut mapping_config: MappingConfig = serde_json::from_str(&config_string).map_err(|e| {
        WebServerError::bad_request(format!(
            "{} {}: {}",
            t!("web.mapping.cannotDeserializeConfig"),
            payload.file,
            e
        ))
    })?;

    if payload.width == 0 || payload.height == 0 {
        return bad_request(format!(
            "{}: {}, {}",
            t!("web.mapping.invalidSize"),
            payload.width,
            payload.height
        ));
    }

    let scale = Vec2::new(
        payload.width as f32 / mapping_config.original_size.width as f32,
        payload.height as f32 / mapping_config.original_size.height as f32,
    );

    mapping_config.original_size.width = payload.width;
    mapping_config.original_size.height = payload.height;

    mapping_config
        .mappings
        .iter_mut()
        .for_each(|mapping| match mapping {
            MappingType::SingleTap(m) => {
                m.position *= scale;
                m.random_offset_x *= scale.x;
                m.random_offset_y *= scale.y;
            }
            MappingType::RepeatTap(m) => {
                m.position *= scale;
                m.random_offset_x *= scale.x;
                m.random_offset_y *= scale.y;
            }
            MappingType::MultipleTap(m) => {
                m.random_offset_x *= scale.x;
                m.random_offset_y *= scale.y;
                m.items.iter_mut().for_each(|item| {
                    item.position *= scale;
                });
            }
            MappingType::Swipe(m) => {
                m.positions.iter_mut().for_each(|p| {
                    *p *= scale;
                });
            }
            MappingType::DirectionPad(m) => {
                m.position *= scale;
                m.max_offset_x *= scale.x;
                m.max_offset_y *= scale.y;
                m.random_offset_x *= scale.x;
                m.random_offset_y *= scale.y;
                m.jitter_offset_x *= scale.x;
                m.jitter_offset_y *= scale.y;
            }
            MappingType::MouseCastSpell(m) => {
                m.position *= scale;
                m.cast_radius *= scale.y;
                m.center *= scale;
                m.drag_radius *= scale.y;
            }
            MappingType::PadCastSpell(m) => {
                m.drag_radius *= scale.y;
                m.position *= scale;
            }
            MappingType::CancelCast(m) => {
                m.position *= scale;
            }
            MappingType::Observation(m) => {
                m.position *= scale;
                m.max_radius *= scale.y;
            }
            MappingType::Fps(m) => {
                m.position *= scale;
                if m.max_offset_x > 0.0 {
                    m.max_offset_x *= scale.x;
                }
                if m.max_offset_y > 0.0 {
                    m.max_offset_y *= scale.y;
                }
            }
            MappingType::Fire(m) => {
                m.position *= scale;
            }
            MappingType::RawInput(m) => {
                m.position *= scale;
            }
            MappingType::Script(m) => {
                m.position *= scale;
            }
            MappingType::Wheel(m) => {
                m.position *= scale;
                m.center *= scale;
                m.radius *= scale.y;
                m.random_offset_x *= scale.x;
                m.random_offset_y *= scale.y;
            }
        });

    // save to file
    save_mapping_config(&mapping_config, &new_path).map_err(|e| WebServerError::bad_request(e))?;

    let msg = t!(
        "web.mapping.migrateMappingConfig",
        file => payload.file,
        newFile => payload.new_file
    )
    .to_string();

    log::info!("[WebServer] {}", msg);
    Ok(JsonResponse::success(msg, None))
}
