use std::{
    fs::File,
    net::{Ipv4Addr, SocketAddrV4},
    sync::OnceLock,
};

use bevy::{
    log::{BoxedLayer, LogPlugin, tracing_subscriber::Layer},
    prelude::*,
    window::{PresentMode, WindowLevel},
};
use scrcpy_mask::{
    DEFAULT_LANGUAGE,
    config::LocalConfig,
    is_available_language,
    mask::{MaskPlugins, mask_command::MaskCommand},
    perf,
    scrcpy::{
        adb,
        control_msg::ScrcpyControlMsg,
        controller::{self, ControllerCommand},
    },
    tokio_tasks::{TokioTasksPlugin, TokioTasksRuntime},
    utils::{
        ChannelReceiverM, ChannelReceiverV, ChannelReceiverVideoSnapshot, ChannelSenderCS,
        ChannelSenderD, ChannelSenderWS, LatestVideoFrame, VideoSnapshotResult, check_for_update,
        relate_to_data_path, relate_to_root_path, share::ControlledDevice,
    },
    web::{self, ws::WebSocketNotification},
};
use tokio::sync::{broadcast, mpsc, oneshot};
use tracing_appender::non_blocking::WorkerGuard;

static LOG_GUARD: OnceLock<WorkerGuard> = OnceLock::new();

fn log_custom_layer(_app: &mut App) -> Option<BoxedLayer> {
    let file = File::create(relate_to_data_path(["app.log"])).unwrap_or_else(|e| {
        panic!("Failed to create log file: {}", e);
    });
    let (non_blocking, guard) = tracing_appender::non_blocking(file);
    let _ = LOG_GUARD.set(guard);
    Some(
        bevy::log::tracing_subscriber::fmt::layer()
            .with_writer(non_blocking)
            .with_file(false)
            .with_line_number(true)
            .with_ansi(false)
            .boxed(),
    )
}

fn main() {
    rust_i18n::set_locale(DEFAULT_LANGUAGE);

    if let Err(e) = LocalConfig::load() {
        println!("LocalConfig load failed. {}", e);
    }
    LocalConfig::prefer_bundled_adb();

    let mut local_config = LocalConfig::get();
    // update language
    let language = local_config.language;
    if is_available_language(&language) {
        rust_i18n::set_locale(&language);
    } else {
        rust_i18n::set_locale(DEFAULT_LANGUAGE);
        LocalConfig::set_language(DEFAULT_LANGUAGE.to_string());
        local_config = LocalConfig::get();
    }
    // update config file
    LocalConfig::save().unwrap();

    ffmpeg_next::init().unwrap();

    let mut app = App::new();
    app.add_plugins(
        DefaultPlugins
            .set(LogPlugin {
                custom_layer: log_custom_layer,
                ..default()
            })
            .set(WindowPlugin {
                primary_window: Some(Window {
                    title: "scrcpy-mask".into(),
                    has_shadow: false,
                    transparent: true, // for windows: https://github.com/bevyengine/bevy/issues/7544
                    decorations: false,
                    present_mode: PresentMode::Immediate, // LowCast: 显式 Immediate，present 完全不阻塞（可能有撕裂）
                    resizable: true,
                    visible: false,
                    focused: false,
                    window_level: if local_config.always_on_top {
                        WindowLevel::AlwaysOnTop
                    } else {
                        WindowLevel::Normal
                    },
                    #[cfg(target_os = "macos")]
                    composite_alpha_mode: bevy::window::CompositeAlphaMode::PostMultiplied,
                    ..default()
                }),
                ..default()
            }),
    )
    .add_plugins(TokioTasksPlugin::default())
    .add_plugins(MaskPlugins)
    .add_systems(Startup, (start_servers, check_for_update_system))
    // ChannelReceiverV 由 start_servers 通过 Commands 延迟插入，
    // 因此 perf_flush_system 必须放到 PostStartup（Startup 结束后资源才就绪），
    // 否则会在 Startup 内与 start_servers 并行执行而读到不存在的资源。
    .add_systems(PostStartup, perf_flush_system)
    .add_systems(Update, on_app_exit);

    #[cfg(target_os = "macos")]
    {
        app.insert_resource(bevy::ecs::schedule::MainThreadExecutor::default())
            .add_systems(Startup, macos_menu);
    }

    #[cfg(not(target_os = "macos"))]
    {
        use scrcpy_mask::window_alpha;
        app.add_systems(Startup, window_alpha::detect_alpha_mode);
        app.add_systems(PostStartup, window_alpha::apply_alpha_mode);
    }

    app.run();
}

#[cfg(target_os = "macos")]
fn macos_menu(executor: Res<bevy::ecs::schedule::MainThreadExecutor>) {
    use muda::{Menu, Submenu};
    // remove default menu
    executor
        .0
        .spawn(async move {
            let menu = Menu::new();
            let submenu = Submenu::new("scrcpy-mask", true);
            menu.append(&submenu).unwrap();
            menu.init_for_nsapp();
        })
        .detach();
}

fn start_servers(mut commands: Commands) {
    let config = LocalConfig::get();
    let web_addr = SocketAddrV4::new(config.web_bind_addr, config.web_port);
    let controller_addr = SocketAddrV4::new(Ipv4Addr::LOCALHOST, config.controller_port);

    let (cs_tx, _) = broadcast::channel::<ScrcpyControlMsg>(1000);
    let (ws_tx, _) = broadcast::channel::<WebSocketNotification>(1000);
    let v_channel = LatestVideoFrame::default();
    let (m_tx, m_rx) =
        crossbeam_channel::unbounded::<(MaskCommand, oneshot::Sender<Result<String, String>>)>();
    let (d_tx, d_rx) = mpsc::unbounded_channel::<ControllerCommand>();
    let (snapshot_tx, snapshot_rx) =
        crossbeam_channel::unbounded::<oneshot::Sender<VideoSnapshotResult>>();

    commands.insert_resource(ChannelSenderCS(cs_tx.clone()));
    commands.insert_resource(ChannelReceiverV(v_channel.clone()));
    commands.insert_resource(ChannelReceiverM(m_rx));
    commands.insert_resource(ChannelReceiverVideoSnapshot(snapshot_rx));
    commands.insert_resource(ChannelSenderD(d_tx.clone()));
    commands.insert_resource(ChannelSenderWS(ws_tx.clone()));
    web::Server::start(
        web_addr,
        cs_tx.clone(),
        d_tx,
        m_tx.clone(),
        snapshot_tx,
        ws_tx.clone(),
    );
    controller::Controller::start(controller_addr, cs_tx, v_channel, d_rx, m_tx, ws_tx);
}

fn check_for_update_system(runtime: ResMut<TokioTasksRuntime>) {
    runtime.spawn_background_task(move |_ctx| async move {
        if let Err(e) = check_for_update().await {
            log::error!("{}", e);
        }
    });
}

/// 程序退出时，移除本会话创建的所有 adb reverse 隧道（温和清理：不杀 adb 服务端）。
/// 避免 adb server 上残留 `localabstract:scrcpy_*` 转发，导致设备端连接和端口一直占用。
fn on_app_exit(mut exit_events: MessageReader<AppExit>) {
    if exit_events.read().next().is_none() {
        return;
    }
    for device in ControlledDevice::get_device_list_blocking() {
        let remote = format!("localabstract:scrcpy_{}", device.scid);
        if let Err(e) = adb::Device::reverse_remove(&device.device_id, &remote) {
            log::warn!("[Adb] 移除反向隧道 {} 失败: {}", remote, e);
        }
    }
}

/// 每秒把性能探针快照 + 视频帧统计写入 perf.jsonl，供 perf_monitor 读取。
fn perf_flush_system(runtime: ResMut<TokioTasksRuntime>, v_channel: Res<ChannelReceiverV>) {
    // ChannelReceiverV 内部是 Arc，克隆只是引用计数 +1，可安全 move 进 'static 后台任务。
    let v_frame = v_channel.0.clone();
    runtime.spawn_background_task(move |_ctx| async move {
        use std::time::Duration;
        perf::register_all();
        // 探针数据写到 perf_monitor 目录（与监控程序同目录），不占用系统 AppData。
        let file = relate_to_root_path(["perf_monitor", "perf.jsonl"]);
        if let Some(parent) = file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut prev_delivered = 0u64;
        let mut prev_dropped = 0u64;
        loop {
            interval.tick().await;
            let delivered = v_frame.delivered_frames();
            let dropped = v_frame.dropped_frames();
            let fps = (delivered.saturating_sub(prev_delivered)) as f64;
            let delivered_delta = delivered.saturating_sub(prev_delivered);
            let dropped_delta = dropped.saturating_sub(prev_dropped);
            perf::flush_to_file(&file, fps, delivered_delta, dropped_delta);
            prev_delivered = delivered;
            prev_dropped = dropped;
        }
    });
}
