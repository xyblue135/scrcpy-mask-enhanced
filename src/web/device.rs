use std::{collections::BTreeMap, time::Duration};

use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    routing::{get, post},
};
use rand::Rng;
use rust_i18n::t;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::{
    sync::{broadcast, mpsc::UnboundedSender},
    time::sleep,
};

use crate::{
    config::LocalConfig,
    scrcpy::{
        adb::{Adb, Device},
        constant::Keycode,
        control_msg::ScrcpyControlMsg,
        controller::ControllerCommand,
        device_action,
    },
    utils::{VideoSnapshotResult, relate_to_data_path, relate_to_root_path, share::ControlledDevice},
    web::{JsonResponse, WebServerError, ws::WebSocketNotification},
};

const SCRCPY_SERVER_VERSION: &str = "4.0";

#[derive(Debug, Clone)]
pub struct AppStateDevice {
    cs_tx: broadcast::Sender<ScrcpyControlMsg>,
    d_tx: UnboundedSender<ControllerCommand>,
    ws_tx: broadcast::Sender<WebSocketNotification>,
    snapshot_tx: crossbeam_channel::Sender<tokio::sync::oneshot::Sender<VideoSnapshotResult>>,
}

pub fn routers(
    cs_tx: broadcast::Sender<ScrcpyControlMsg>,
    d_tx: UnboundedSender<ControllerCommand>,
    snapshot_tx: crossbeam_channel::Sender<tokio::sync::oneshot::Sender<VideoSnapshotResult>>,
    ws_tx: broadcast::Sender<WebSocketNotification>,
) -> Router {
    Router::new()
        .route("/device_list", get(device_list))
        .route("/control_device", post(control_device))
        .route("/decontrol_device", post(decontrol_device))
        .route("/reconnect_device", post(reconnect_device))
        .route("/adb_connect", post(adb_connect))
        .route("/adb_pair", post(adb_pair))
        .route("/adb_restart", post(adb_restart))
        .route("/adb_screenshot", post(adb_screenshot))
        .route("/window_screenshot", post(window_screenshot))
        .route("/adb_save_screenshot", post(adb_save_screenshot))
        .route("/adb_apps", post(adb_apps))
        .route("/adb_displays", post(adb_displays))
        .route("/adb_start_app", post(adb_start_app))
        .route("/control/set_display_power", post(set_display_power))
        .route("/control/set_pointer_location", post(set_pointer_location))
        .route("/control/send_key", post(send_key))
        .with_state(AppStateDevice {
            cs_tx,
            d_tx,
            ws_tx,
            snapshot_tx,
        })
}

async fn device_list() -> Result<JsonResponse, WebServerError> {
    let controlled_devices = ControlledDevice::get_device_list().await;
    let config = LocalConfig::get();
    let all_devices = Adb::new(config.adb_path)
        .devices()
        .map_err(|e| WebServerError::internal_error(e))?;

    Ok(JsonResponse::success(
        t!("web.device.deviceListObtained"),
        Some(json!({
            "controlled_devices": controlled_devices,
            "adb_devices": all_devices,
        })),
    ))
}

fn gen_scid() -> String {
    let mut rng = rand::rng();
    let suffix: String = (0..6)
        .map(|_| rng.random_range(1..=9).to_string())
        .collect();
    format!("10{}", suffix) // ensure 8 digits(HEX) and less than MAX_INT32
}

#[derive(Deserialize)]
struct PostDataControlDevice {
    device_id: String,
    video: bool,
    #[serde(default)]
    audio: bool,
}

async fn _control_device(
    device_id: &str,
    video: bool,
    audio: bool,
    d_tx: &UnboundedSender<ControllerCommand>,
    ws_tx: &broadcast::Sender<WebSocketNotification>,
) -> Result<JsonResponse, WebServerError> {
    let device_id = device_id.to_string();
    let local_config = LocalConfig::get();

    let device_list = ControlledDevice::get_device_list().await;
    // check if device is controlled
    if device_list
        .iter()
        .any(|device| device.device_id == device_id)
    {
        return Err(WebServerError::bad_request(format!(
            "{}: {}",
            t!("web.device.alreadyControlled"),
            device_id
        )));
    }
    let main = device_list.len() == 0;
    let active_scrcpy_preset = local_config.scrcpy_module.active_preset();
    let video = active_scrcpy_preset.map_or(video, |preset| preset.video) && main;
    let audio = active_scrcpy_preset.map_or(audio, |preset| preset.audio) && main;

    // prepare for scrcpy app
    let scid = gen_scid();
    let scrcpy_path = relate_to_root_path([
        "assets",
        &format!("scrcpy-mask-server-v{}", SCRCPY_SERVER_VERSION),
    ]);
    Device::push(
        &device_id,
        scrcpy_path.to_str().unwrap(),
        "/data/local/tmp/scrcpy-server.jar",
    )
    .map_err(WebServerError::internal_error)?;
    log::info!("[WebServe] {}", t!("web.device.pushScrcpyServerSuccess"));

    let remote = format!("localabstract:scrcpy_{}", scid);
    let local = format!("tcp:{}", local_config.controller_port);
    Device::reverse(&device_id, &remote, &local).map_err(WebServerError::internal_error)?;
    log::info!(
        "[WebServe] {}",
        t!("web.device.reverseSuccess", remote => remote, local => local)
    );

    let mut args = [
        "CLASSPATH=/data/local/tmp/scrcpy-server.jar",
        "app_process",
        "/",
        "com.genymobile.scrcpy.Server",
    ]
    .iter_mut()
    .map(|arg| arg.to_string())
    .collect::<Vec<String>>();

    args.push(SCRCPY_SERVER_VERSION.to_string());
    args.push(format!("scid={}", scid));
    if !video {
        args.push("video=false".to_string());
    }
    if !audio {
        args.push("audio=false".to_string());
    }
    if video
        && let Some(preset) = active_scrcpy_preset
        && preset.virtual_display.enabled
    {
        args.extend(preset.virtual_display.server_args());
    }

    // create device
    let mut socket_id: Vec<String> = Vec::new();
    let mut commands: Vec<ControllerCommand> = Vec::new();
    if main {
        let mut meta_flag = true;
        if video {
            socket_id.push("main_video".to_string());
            commands.push(ControllerCommand::ConnectMainVideo(scid.clone(), meta_flag));
            if meta_flag {
                meta_flag = false;
            }

        }
        if audio {
            socket_id.push("main_audio".to_string());
            commands.push(ControllerCommand::ConnectMainAudio(scid.clone(), meta_flag));
            if meta_flag {
                meta_flag = false;
            }
        }
        if let Some(preset) = active_scrcpy_preset {
            preset
                .apply_server_parameters(&mut args)
                .map_err(WebServerError::bad_request)?;
            log::info!(
                "[ScrcpyModule] applying preset '{}' with {} parameter(s)",
                preset.name,
                preset
                    .parameters
                    .iter()
                    .filter(|parameter| parameter.enabled)
                    .count()
            );
        }
        socket_id.push("main_control".to_string());
        commands.push(ControllerCommand::ConnectMainControl(
            scid.clone(),
            meta_flag,
        ));
    } else {
        socket_id.push(format!("sub_control_{}", scid));
        commands.push(ControllerCommand::ConnectSubControl(scid.clone()));
    }

    ControlledDevice::add_device(device_id.clone(), scid.clone(), main, socket_id).await;
    // send command to controller server
    for cmd in commands {
        d_tx.send(cmd).unwrap();
    }

    // run scrcpy app
    sleep(Duration::from_millis(500)).await;
    log::info!("[WebServe] {}", t!("web.device.startingScrcpyApp"));

    let h = Device::shell_process(&device_id, args);

    let scid_copy = scid.clone();
    let ws_tx_copy = ws_tx.clone();
    tokio::spawn(async move {
        h.await.unwrap().unwrap();
        log::info!("[WebServe] {}", t!("web.device.removingDeviceAfterExit"));
        ControlledDevice::remove_device(&scid_copy).await;
        ws_tx_copy
            .send(WebSocketNotification::ScrcpyDeviceConnection {
                scid: scid_copy,
                main,
                connected: false,
            })
            .ok();
    });

    Ok(JsonResponse::success(
        t!("web.device.tryStartingScrcpy"),
        Some(json!({"scid": scid, "device_id": device_id})),
    ))
}

async fn control_device(
    State(state): State<AppStateDevice>,
    Json(payload): Json<PostDataControlDevice>,
) -> Result<JsonResponse, WebServerError> {
    let device_id = payload.device_id;
    let video = payload.video;
    let audio = payload.audio;

    _control_device(&device_id, video, audio, &state.d_tx, &state.ws_tx).await
}

#[derive(Deserialize)]
struct PostDataReconnectDevice {
    device_id: String,
    video: bool,
    #[serde(default)]
    audio: bool,
}

async fn reconnect_device(
    State(state): State<AppStateDevice>,
    Json(payload): Json<PostDataReconnectDevice>,
) -> Result<JsonResponse, WebServerError> {
    let device_id = payload.device_id;
    let device_list = ControlledDevice::get_device_list().await;
    for device in device_list {
        if device.device_id == device_id {
            _decontrol_device(&device_id, &state.d_tx).await?;
            _control_device(
                &device_id,
                payload.video,
                payload.audio,
                &state.d_tx,
                &state.ws_tx,
            )
            .await?;
            return Ok(JsonResponse::success(
                format!("{}: {}", t!("web.device.reconnectDevice"), device_id),
                None,
            ));
        }
    }
    Err(WebServerError::bad_request(format!(
        "{}: {}",
        t!("web.device.deviceNotFound"),
        device_id
    )))
}

#[derive(Deserialize)]
struct PostDataDeControlDevice {
    device_id: String,
}

async fn _decontrol_device(
    device_id: &str,
    d_tx: &UnboundedSender<ControllerCommand>,
) -> Result<JsonResponse, WebServerError> {
    let device_list = ControlledDevice::get_device_list().await;
    for device in device_list {
        if device.device_id == device_id {
            let scid = device.scid.clone();
            if device.main {
                d_tx.send(ControllerCommand::ShutdownMain(scid)).unwrap();
            } else {
                d_tx.send(ControllerCommand::ShutdownSub(scid)).unwrap();
            }
            ControlledDevice::remove_device(&device.scid).await;
            return Ok(JsonResponse::success(
                format!("{}: {}", t!("web.device.decontrolDevice"), device_id),
                None,
            ));
        }
    }
    Err(WebServerError::bad_request(format!(
        "{}: {}",
        t!("web.device.deviceNotFound"),
        device_id
    )))
}

async fn decontrol_device(
    State(state): State<AppStateDevice>,
    Json(payload): Json<PostDataDeControlDevice>,
) -> Result<JsonResponse, WebServerError> {
    let device_id = payload.device_id;
    _decontrol_device(&device_id, &state.d_tx).await
}

#[derive(Deserialize)]
struct PostDataAdbDevice {
    device_id: String,
}

#[derive(Deserialize)]
struct PostDataStartApp {
    device_id: String,
    package_name: String,
    component: String,
    display_id: i32,
    force_stop: bool,
}

#[derive(Debug, Clone, Serialize)]
struct AndroidApp {
    package_name: String,
    activity_name: String,
    component: String,
}

#[derive(Debug, Clone, Serialize)]
struct AndroidDisplay {
    display_id: i32,
    width: Option<u32>,
    height: Option<u32>,
    density: Option<u32>,
    rotation: Option<u32>,
    name: Option<String>,
}

async fn ensure_device_controlled(device_id: &str) -> Result<(), WebServerError> {
    let device_list = ControlledDevice::get_device_list().await;
    if device_list
        .iter()
        .any(|device| device.device_id == device_id)
    {
        Ok(())
    } else {
        Err(WebServerError::bad_request(format!(
            "{}: {}",
            t!("web.device.deviceNotFound"),
            device_id
        )))
    }
}

fn adb_shell_text<S>(device_id: &str, args: S) -> Result<String, String>
where
    S: IntoIterator,
    S::Item: Into<String>,
{
    let mut output = Vec::<u8>::new();
    Device::shell(device_id, args, &mut output)?;
    Ok(String::from_utf8_lossy(&output).to_string())
}

fn is_package_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '.'
}

fn is_activity_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '$')
}

fn is_valid_package_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && value.split('.').all(|part| {
            !part.is_empty() && part.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        })
}

fn parse_component(component: &str) -> Option<AndroidApp> {
    let (package_name, activity_name) = component.split_once('/')?;
    if !is_valid_package_name(package_name)
        || activity_name.is_empty()
        || activity_name.len() > 255
        || !activity_name.chars().all(is_activity_char)
    {
        return None;
    }

    Some(AndroidApp {
        package_name: package_name.to_string(),
        activity_name: activity_name.to_string(),
        component: component.to_string(),
    })
}

fn is_valid_component(component: &str, package_name: &str) -> bool {
    parse_component(component)
        .map(|app| app.package_name == package_name)
        .unwrap_or(false)
}

fn parse_launcher_apps(output: &str) -> Vec<AndroidApp> {
    let mut apps = BTreeMap::new();
    for line in output.lines() {
        for candidate in
            line.split(|c: char| !(is_package_char(c) || is_activity_char(c) || c == '/'))
        {
            if !candidate.contains('/') {
                continue;
            }
            if let Some(app) = parse_component(candidate) {
                apps.entry(app.component.clone()).or_insert(app);
            }
        }
    }
    apps.into_values().collect()
}

fn parse_after_i32(text: &str, marker: &str) -> Option<i32> {
    let start = text.find(marker)? + marker.len();
    let rest = text[start..].trim_start();
    let end = rest
        .char_indices()
        .find(|(_, c)| !c.is_ascii_digit() && *c != '-')
        .map(|(index, _)| index)
        .unwrap_or(rest.len());
    rest[..end].parse().ok()
}

fn parse_after_u32(text: &str, marker: &str) -> Option<u32> {
    parse_after_i32(text, marker).and_then(|value| value.try_into().ok())
}

fn parse_display_name(line: &str) -> Option<String> {
    let start = line.find("DisplayInfo{\"")? + "DisplayInfo{\"".len();
    let rest = &line[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn parse_display_size_after(line: &str, marker: &str) -> (Option<u32>, Option<u32>) {
    let Some(real_start) = line.find(marker) else {
        return (None, None);
    };
    let rest = &line[real_start + marker.len()..];
    let Some((width, rest)) = rest.split_once(" x ") else {
        return (None, None);
    };
    let width = width.trim().parse::<u32>().ok();
    let height_end = rest
        .char_indices()
        .find(|(_, c)| !c.is_ascii_digit())
        .map(|(index, _)| index)
        .unwrap_or(rest.len());
    let height = rest[..height_end].parse::<u32>().ok();
    (width, height)
}

fn parse_display_size(line: &str) -> (Option<u32>, Option<u32>) {
    let real_size = parse_display_size_after(line, "real ");
    if real_size.0.is_some() && real_size.1.is_some() {
        return real_size;
    }

    parse_display_size_after(line, "app ")
}

fn parse_display_header_id(line: &str) -> Option<i32> {
    let rest = line.trim_start().strip_prefix("Display ")?;
    let end = rest
        .char_indices()
        .find(|(_, c)| !c.is_ascii_digit())
        .map(|(index, _)| index)
        .unwrap_or(rest.len());
    if end == 0 {
        return None;
    }
    rest[..end].parse().ok()
}

fn display_from_id(display_id: i32) -> Option<AndroidDisplay> {
    if display_id < 0 {
        return None;
    }

    Some(AndroidDisplay {
        display_id,
        width: None,
        height: None,
        density: None,
        rotation: None,
        name: None,
    })
}

fn merge_display(current: &mut AndroidDisplay, display: AndroidDisplay) {
    if current.width.is_none() {
        current.width = display.width;
    }
    if current.height.is_none() {
        current.height = display.height;
    }
    if current.density.is_none() {
        current.density = display.density;
    }
    if current.rotation.is_none() {
        current.rotation = display.rotation;
    }
    if current.name.is_none() {
        current.name = display.name;
    }
}

fn parse_displays(output: &str) -> Vec<AndroidDisplay> {
    let mut displays = BTreeMap::new();
    for line in output.lines() {
        let display = if line.contains("DisplayInfo{") && line.contains("displayId ") {
            let Some(display_id) = parse_after_i32(line, "displayId ") else {
                continue;
            };
            if display_id < 0 {
                continue;
            }

            let (width, height) = parse_display_size(line);
            AndroidDisplay {
                display_id,
                width,
                height,
                density: parse_after_u32(line, "density "),
                rotation: parse_after_u32(line, "rotation "),
                name: parse_display_name(line),
            }
        } else if let Some(display_id) = parse_display_header_id(line) {
            let Some(display) = display_from_id(display_id) else {
                continue;
            };
            display
        } else if let Some(display_id) = parse_after_i32(line, "mDisplayId=") {
            let Some(display) = display_from_id(display_id) else {
                continue;
            };
            display
        } else {
            continue;
        };

        displays
            .entry(display.display_id)
            .and_modify(|current| merge_display(current, display.clone()))
            .or_insert(display);
    }
    displays.into_values().collect()
}

fn query_launcher_apps(device_id: &str) -> Result<Vec<AndroidApp>, String> {
    let commands: [&[&str]; 3] = [
        &[
            "cmd",
            "package",
            "query-activities",
            "--brief",
            "-a",
            "android.intent.action.MAIN",
            "-c",
            "android.intent.category.LAUNCHER",
        ],
        &[
            "cmd",
            "package",
            "query-intent-activities",
            "--brief",
            "-a",
            "android.intent.action.MAIN",
            "-c",
            "android.intent.category.LAUNCHER",
        ],
        &[
            "pm",
            "query-intent-activities",
            "-a",
            "android.intent.action.MAIN",
            "-c",
            "android.intent.category.LAUNCHER",
        ],
    ];

    let mut last_error = None;
    for command in commands {
        match adb_shell_text(device_id, command.iter().copied()) {
            Ok(output) => {
                let apps = parse_launcher_apps(&output);
                if !apps.is_empty() {
                    return Ok(apps);
                }
            }
            Err(error) => last_error = Some(error),
        }
    }

    if let Some(error) = last_error {
        Err(error)
    } else {
        Ok(Vec::new())
    }
}

async fn adb_apps(Json(payload): Json<PostDataAdbDevice>) -> Result<JsonResponse, WebServerError> {
    ensure_device_controlled(&payload.device_id).await?;

    let apps = query_launcher_apps(&payload.device_id).map_err(WebServerError::bad_request)?;
    if apps.is_empty() {
        return Err(WebServerError::bad_request(t!("web.device.noAppFound")));
    }

    Ok(JsonResponse::success(
        t!("web.device.getAdbAppsSuccess"),
        Some(json!({ "apps": apps })),
    ))
}

async fn adb_displays(
    Json(payload): Json<PostDataAdbDevice>,
) -> Result<JsonResponse, WebServerError> {
    ensure_device_controlled(&payload.device_id).await?;

    let output = adb_shell_text(&payload.device_id, ["dumpsys", "display"])
        .map_err(WebServerError::bad_request)?;
    let displays = parse_displays(&output);
    if displays.is_empty() {
        return Err(WebServerError::bad_request(t!("web.device.noDisplayFound")));
    }

    Ok(JsonResponse::success(
        t!("web.device.getAdbDisplaysSuccess"),
        Some(json!({ "displays": displays })),
    ))
}

async fn adb_start_app(
    Json(payload): Json<PostDataStartApp>,
) -> Result<JsonResponse, WebServerError> {
    ensure_device_controlled(&payload.device_id).await?;
    if !is_valid_package_name(&payload.package_name)
        || !is_valid_component(&payload.component, &payload.package_name)
        || payload.display_id < 0
    {
        return Err(WebServerError::bad_request(t!(
            "web.device.invalidStartAppParams"
        )));
    }

    let display_id = payload.display_id.to_string();
    if payload.force_stop {
        Device::shell_logged(
            &payload.device_id,
            ["am", "force-stop", &payload.package_name],
        )
        .map_err(WebServerError::bad_request)?;
    }

    Device::shell_logged(
        &payload.device_id,
        [
            "am",
            "start",
            "--display",
            &display_id,
            "-a",
            "android.intent.action.MAIN",
            "-c",
            "android.intent.category.LAUNCHER",
            "-n",
            &payload.component,
        ],
    )
    .map_err(WebServerError::bad_request)?;

    Ok(JsonResponse::success(
        t!("web.device.startAdbAppSuccess"),
        None,
    ))
}

#[derive(Deserialize)]
struct PostDataAddress {
    address: String,
}

async fn adb_connect(Json(payload): Json<PostDataAddress>) -> Result<JsonResponse, WebServerError> {
    let config = LocalConfig::get();
    let address = payload.address.trim().to_string();
    match Adb::new(config.adb_path).connect_device(&address) {
        Ok(_) => Ok(JsonResponse::success(
            format!("{}", t!("web.device.adbConnect", address => address)),
            None,
        )),
        Err(e) => Err(WebServerError::bad_request(format!(
            "{}: {}",
            t!("web.device.adbConnectFailed", address => address),
            e
        ))),
    }
}

#[derive(Deserialize)]
struct PostDataAdbPair {
    address: String,
    code: String,
}

async fn adb_pair(Json(payload): Json<PostDataAdbPair>) -> Result<JsonResponse, WebServerError> {
    let config = LocalConfig::get();
    match Adb::new(config.adb_path).pair_device(&payload.address, &payload.code) {
        Ok(_) => Ok(JsonResponse::success(
            format!(
                "{}",
                t!("web.device.adbPairSuccess", address => payload.address, code => payload.code)
            ),
            None,
        )),
        Err(e) => Err(WebServerError::bad_request(format!(
            "{}: {}",
            t!("web.device.adbPairFailed", address => payload.address, code => payload.code),
            e
        ))),
    }
}

async fn adb_restart() -> Result<JsonResponse, WebServerError> {
    let controlled_devices = ControlledDevice::get_device_list().await;
    let config = LocalConfig::get();
    match Adb::new(config.adb_path).restart_server() {
        Ok(adb_devices) => Ok(JsonResponse::success(
            t!("web.device.adbRestartSuccess"),
            Some(json!({
                "controlled_devices": controlled_devices,
                "adb_devices": adb_devices,
            })),
        )),
        Err(e) => Err(WebServerError::internal_error(format!(
            "{}: {}",
            t!("web.device.adbRestartFailed"),
            e
        ))),
    }
}

#[derive(Deserialize)]
struct PostDataId {
    id: String,
    #[serde(default)]
    display_id: Option<String>,
}

/// Mapping-background screenshot source.
///
/// LowCast no longer calls Android `adb shell screencap`. Instead it asks the Bevy/video
/// pipeline for the YUV planes that are currently being displayed, converts that exact frame
/// to PNG off the render thread, and returns it to the existing frontend endpoint.
///
/// Keeping the `/adb_screenshot` route name preserves frontend/API compatibility. `id` and
/// `display_id` are accepted for backward compatibility but intentionally do not select the
/// source anymore: the source is always the current LowCast video frame (main or virtual).
async fn adb_screenshot(
    State(state): State<AppStateDevice>,
    Json(payload): Json<PostDataId>,
) -> Result<impl IntoResponse, WebServerError> {
    let _ = (&payload.id, &payload.display_id);
    let (tx, rx) = tokio::sync::oneshot::channel::<VideoSnapshotResult>();

    state.snapshot_tx.send(tx).map_err(|e| {
        WebServerError::internal_error(format!("failed to request current video frame: {e}"))
    })?;

    let image_bytes = tokio::time::timeout(Duration::from_secs(3), rx)
        .await
        .map_err(|_| {
            WebServerError::internal_error("timed out while capturing current LowCast video frame")
        })?
        .map_err(|e| {
            WebServerError::internal_error(format!("video snapshot request was cancelled: {e}"))
        })?
        .map_err(WebServerError::bad_request)?;

    log::info!(
        "[WebServe] mapping screenshot captured from current LowCast decoded frame ({} bytes)",
        image_bytes.len()
    );

    let mut headers = HeaderMap::new();
    headers.insert("Content-Type", HeaderValue::from_static("image/png"));
    headers.insert("Cache-Control", HeaderValue::from_static("no-cache"));
    headers.insert(
        "X-LowCast-Screenshot-Source",
        HeaderValue::from_static("current-video-frame"),
    );

    Ok((StatusCode::OK, headers, image_bytes))
}

/// 截取 scrcpy 主窗口画面并保存为 PNG 到本地 `screenshots/` 目录。
/// 仅 Windows 支持（通过系统 GDI `BitBlt` 抓取窗口客户区）。
async fn window_screenshot(
    State(_state): State<AppStateDevice>,
) -> Result<impl IntoResponse, WebServerError> {
    #[cfg(windows)]
    {
        let save_dir = relate_to_data_path(["screenshots"]);
        std::fs::create_dir_all(&save_dir).map_err(|e| {
            WebServerError::internal_error(format!("failed to create screenshots dir: {e}"))
        })?;

        // 记录窗口截图（BitBlt）时刻的 PC 时间戳，用于延迟对比
        let pc_ts_before = now_ms();
        let png_bytes = capture_scrcpy_window_to_png().map_err(WebServerError::internal_error)?;
        let pc_ts_after = now_ms();
        log::info!(
            "[WebServe] window screenshot captured: pc_ts_before={} pc_ts_after={}",
            pc_ts_before,
            pc_ts_after
        );

        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let filename = format!("window-{ts}.png");
        let path = save_dir.join(&filename);
        std::fs::write(&path, &png_bytes).map_err(|e| {
            WebServerError::internal_error(format!("failed to write window screenshot: {e}"))
        })?;

        log::info!(
            "[WebServe] window screenshot saved to {} ({} bytes)",
            path.display(),
            png_bytes.len()
        );

        // 返回 PNG 字节，PC 保存路径 + 时间戳放在 header
        let mut headers = HeaderMap::new();
        headers.insert("Content-Type", HeaderValue::from_static("image/png"));
        headers.insert("Cache-Control", HeaderValue::from_static("no-cache"));
        headers.insert(
            "X-PC-Path",
            HeaderValue::from_str(&path.display().to_string())
                .map_err(|e| WebServerError::internal_error(e.to_string()))?,
        );
        headers.insert(
            "X-PC-Ts-Before",
            HeaderValue::from_str(&pc_ts_before.to_string())
                .map_err(|e| WebServerError::internal_error(e.to_string()))?,
        );

        Ok((StatusCode::OK, headers, png_bytes))
    }
    #[cfg(not(windows))]
    {
        Err(WebServerError::internal_error(
            "window screenshot is only supported on Windows",
        ))
    }
}

/// 用 Windows GDI `BitBlt` 抓取 "scrcpy-mask" 窗口客户区并编码为 PNG 字节。
#[cfg(windows)]
fn capture_scrcpy_window_to_png() -> Result<Vec<u8>, String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{HWND, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        SRCCOPY,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowW, GetClientRect};

    // 通过窗口标题查找窗口句柄
    let wide: Vec<u16> = OsStr::new("scrcpy-mask")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let hwnd: HWND = unsafe { FindWindowW(std::ptr::null(), wide.as_ptr()) };
    if hwnd.is_null() {
        return Err("scrcpy window not found".into());
    }

    let window_dc = unsafe { GetDC(hwnd) };
    if window_dc.is_null() {
        return Err("failed to get window DC".into());
    }

    let mut client_rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    unsafe { GetClientRect(hwnd, &mut client_rect) };
    let width = client_rect.right - client_rect.left;
    let height = client_rect.bottom - client_rect.top;
    if width <= 0 || height <= 0 {
        unsafe { ReleaseDC(hwnd, window_dc) };
        return Err("scrcpy window has empty client area".into());
    }

    let mem_dc = unsafe { CreateCompatibleDC(window_dc) };
    if mem_dc.is_null() {
        unsafe { ReleaseDC(hwnd, window_dc) };
        return Err("failed to create memory DC".into());
    }
    let bitmap = unsafe { CreateCompatibleBitmap(window_dc, width, height) };
    if bitmap.is_null() {
        unsafe { DeleteDC(mem_dc) };
        unsafe { ReleaseDC(hwnd, window_dc) };
        return Err("failed to create compatible bitmap".into());
    }

    let old = unsafe { SelectObject(mem_dc, bitmap as _) };
    unsafe {
        BitBlt(
            mem_dc,
            0,
            0,
            width,
            height,
            window_dc,
            0,
            0,
            SRCCOPY,
        )
    };

    // 读取 DIB 像素 (BGRA)
    let mut bmi: BITMAPINFO = unsafe { std::mem::zeroed() };
    bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
    bmi.bmiHeader.biWidth = width;
    bmi.bmiHeader.biHeight = -height; // top-down
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB;

    let mut pixel_data = vec![0u8; (width as usize) * (height as usize) * 4];
    unsafe {
        GetDIBits(
            mem_dc,
            bitmap,
            0,
            height as u32,
            pixel_data.as_mut_ptr() as *mut _,
            &mut bmi,
            DIB_RGB_COLORS,
        )
    };

    // 清理 GDI 资源
    unsafe { SelectObject(mem_dc, old) };
    unsafe { DeleteObject(bitmap as _) };
    unsafe { DeleteDC(mem_dc) };
    unsafe { ReleaseDC(hwnd, window_dc) };

    // BGRA -> RGBA（png crate 需要 RGB 或 RGBA）
    let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
    for px in pixel_data.chunks_exact(4) {
        rgba.push(px[2]); // R
        rgba.push(px[1]); // G
        rgba.push(px[0]); // B
        rgba.push(px[3]); // A
    }

    // 用 png crate 编码
    let mut out: Vec<u8> = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width as u32, height as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("png header error: {e}"))?;
        writer
            .write_image_data(&rgba)
            .map_err(|e| format!("png write error: {e}"))?;
    }
    Ok(out)
}

#[derive(Deserialize)]
struct PostDataSaveScreenshot {
    #[serde(default)]
    id: Option<String>,
}

/// PC 当前系统时间的毫秒时间戳（UNIX epoch）。
fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// 通过 `adb shell date +%s%N` 读取手机端系统时间，返回毫秒时间戳。
/// 输出形如 "1720000000123456789"（秒 + 纳秒），取前 13 位作为毫秒。
fn adb_phone_time_ms(device_id: &str) -> Option<u128> {
    let out = adb_shell_text(device_id, ["date", "+%s%N"]).ok()?;
    let out = out.trim();
    // 秒(10位) + 纳秒(9位) = 19 位；取前 13 位为毫秒
    let chars: Vec<char> = out.chars().collect();
    if chars.len() < 13 {
        return None;
    }
    let ms_str: String = chars[..13].iter().collect();
    ms_str.parse::<u128>().ok()
}

/// 在手机端执行 `adb shell screencap -p` 把当前屏幕截图保存到手机内部存储，
/// 同时 `adb pull` 拉回 PC 返回 PNG 字节给前端展示（header 携带手机内路径）。
/// 手机截图来源：手机系统自身截图（`screencap`），与 PC 端 scrcpy 窗口截图独立。
async fn adb_save_screenshot(
    State(_state): State<AppStateDevice>,
    Json(payload): Json<PostDataSaveScreenshot>,
) -> Result<impl IntoResponse, WebServerError> {
    // 确定目标设备 id（优先用传入的，否则取当前主设备）
    let device_id = if let Some(id) = &payload.id {
        id.clone()
    } else {
        match ControlledDevice::get_main_device().await {
            Some(d) => d.device_id,
            None => {
                return Err(WebServerError::bad_request(t!(
                    "web.device.noDeviceControlled"
                )))
            }
        }
    };

    // 手机内部保存目录
    let dir = "/sdcard/Pictures/scrcpy-mask";
    let _ = adb_shell_text(&device_id, ["mkdir", "-p", dir]);

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let filename = format!("shot-{ts}.png");
    let path = format!("{dir}/{filename}");

    // 0. 记录时间戳用于延迟估算：
    //    - PC 端开始截图时刻
    //    - 手机端截图前/后的系统时间（screencap 记录开始/结束时间）
    let pc_ts_before = now_ms();
    let phone_ts_before = adb_phone_time_ms(&device_id);
    log::info!(
        "[WebServe] phone screenshot begin: pc_ts={} phone_ts_before={:?}",
        pc_ts_before,
        phone_ts_before
    );

    // 1. 在手机端执行 screencap 截图保存到手机
    let mut shell_out = Vec::<u8>::new();
    Device::shell(&device_id, ["screencap", "-p", &path], &mut shell_out)
        .map_err(|e| WebServerError::internal_error(format!("screencap failed: {e}")))?;

    // 截图结束后的手机端时间
    let phone_ts_after = adb_phone_time_ms(&device_id);
    let pc_ts_after = now_ms();
    log::info!(
        "[WebServe] phone screenshot done: pc_ts_after={} phone_ts_after={:?}",
        pc_ts_after,
        phone_ts_after
    );

    // 2. 从手机 pull 回 PC 内存，得到 PNG 字节
    let mut png_bytes = Vec::<u8>::new();
    Device::pull(&device_id, path.clone(), &mut png_bytes)
        .map_err(|e| WebServerError::internal_error(format!("pull failed: {e}")))?;

    log::info!(
        "[WebServe] phone screenshot saved to {path} ({} bytes)",
        png_bytes.len()
    );

    // 3. 返回 PNG 字节，手机内路径 + 时间戳放在 header
    let mut headers = HeaderMap::new();
    headers.insert("Content-Type", HeaderValue::from_static("image/png"));
    headers.insert("Cache-Control", HeaderValue::from_static("no-cache"));
    headers.insert(
        "X-Phone-Path",
        HeaderValue::from_str(&path)
            .map_err(|e| WebServerError::internal_error(e.to_string()))?,
    );
    if let Some(pb) = phone_ts_before {
        headers.insert(
            "X-Phone-Ts-Before",
            HeaderValue::from_str(&pb.to_string())
                .map_err(|e| WebServerError::internal_error(e.to_string()))?,
        );
    }
    if let Some(pa) = phone_ts_after {
        headers.insert(
            "X-Phone-Ts-After",
            HeaderValue::from_str(&pa.to_string())
                .map_err(|e| WebServerError::internal_error(e.to_string()))?,
        );
    }
    headers.insert(
        "X-PC-Ts-Before",
        HeaderValue::from_str(&pc_ts_before.to_string())
            .map_err(|e| WebServerError::internal_error(e.to_string()))?,
    );

    Ok((StatusCode::OK, headers, png_bytes))
}

#[derive(Deserialize)]
struct PostDataSetDisplayPower {
    mode: bool,
}
async fn set_display_power(
    State(state): State<AppStateDevice>,
    Json(payload): Json<PostDataSetDisplayPower>,
) -> Result<JsonResponse, WebServerError> {
    if !ControlledDevice::is_any_device_controlled().await {
        return Err(WebServerError::bad_request(t!(
            "web.device.noDeviceControlled"
        )));
    }

    device_action::set_display_power(&state.cs_tx, payload.mode);
    Ok(JsonResponse::success(
        t!("web.device.setDisplayPowerSuccess"),
        None,
    ))
}

#[derive(Deserialize)]
struct PostDataSetPointerLocation {
    mode: bool,
}

async fn set_pointer_location(
    Json(payload): Json<PostDataSetPointerLocation>,
) -> Result<JsonResponse, WebServerError> {
    let device_list = ControlledDevice::get_device_list().await;
    if device_list.is_empty() {
        return Err(WebServerError::bad_request(t!(
            "web.device.noDeviceControlled"
        )));
    }

    let mode = if payload.mode { "1" } else { "0" };
    for device in device_list {
        let mut output = Vec::<u8>::new();
        Device::shell(
            &device.device_id,
            ["settings", "put", "system", "pointer_location", mode],
            &mut output,
        )
        .map_err(|e| {
            WebServerError::bad_request(format!(
                "{} {}: {}",
                t!("web.device.setPointerLocationFailed"),
                device.device_id,
                e
            ))
        })?;
    }

    Ok(JsonResponse::success(
        t!("web.device.setPointerLocationSuccess"),
        None,
    ))
}

#[derive(Deserialize)]
struct PostDataSendKey {
    keycode: Keycode,
}

async fn send_key(
    State(state): State<AppStateDevice>,
    Json(payload): Json<PostDataSendKey>,
) -> Result<JsonResponse, WebServerError> {
    if !ControlledDevice::is_any_device_controlled().await {
        return Err(WebServerError::bad_request(t!(
            "web.device.noDeviceControlled"
        )));
    }

    device_action::inject_keycode(&state.cs_tx, payload.keycode);
    Ok(JsonResponse::success(t!("web.device.sendKeySuccess"), None))
}
