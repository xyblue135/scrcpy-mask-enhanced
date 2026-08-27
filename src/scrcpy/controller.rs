use std::{collections::HashMap, net::SocketAddrV4, thread};

use bevy::log;
use copypasta::{ClipboardContext, ClipboardProvider};
use rust_i18n::t;
use tokio::{
    io::AsyncWriteExt,
    sync::{
        broadcast,
        mpsc::{self, UnboundedReceiver},
        oneshot,
    },
};
use tokio_util::sync::CancellationToken;

use crate::{
    config::LocalConfig,
    mask::mask_command::MaskCommand,
    scrcpy::{
        adb::Device,
        connection::ScrcpyConnection,
        control_msg::{ScrcpyControlMsg, ScrcpyDeviceMsg},
    },
    utils::{LatestVideoFrame, mask_win_move_helper, share::ControlledDevice},
    utils::bind_reuseaddr_listener,
    web::ws::WebSocketNotification,
};

#[derive(Debug)]
pub enum ControllerCommand {
    ConnectMainControl(String, bool),
    ConnectMainVideo(String, bool),
    ConnectMainAudio(String, bool),
    ConnectSubControl(String),
    ShutdownMain(String),
    ShutdownSub(String),
}

pub struct Controller;

impl Controller {
    pub fn start(
        addr: SocketAddrV4,
        cs_tx: broadcast::Sender<ScrcpyControlMsg>,
        v_tx: LatestVideoFrame,
        d_rx: UnboundedReceiver<ControllerCommand>,
        m_tx: crossbeam_channel::Sender<(MaskCommand, oneshot::Sender<Result<String, String>>)>,
        ws_tx: broadcast::Sender<WebSocketNotification>,
    ) {
        thread::spawn(move || {
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(async move {
                    Controller::run_server(addr, cs_tx, v_tx, d_rx, m_tx, ws_tx).await;
                });
        });
    }

    async fn cr_msg_handler(
        mut cr_rx: UnboundedReceiver<ScrcpyDeviceMsg>,
        m_tx: crossbeam_channel::Sender<(MaskCommand, oneshot::Sender<Result<String, String>>)>,
        ws_tx: broadcast::Sender<WebSocketNotification>,
    ) {
        loop {
            match cr_rx.recv().await {
                Some(msg) => match msg {
                    ScrcpyDeviceMsg::Clipboard { length: _, text } => {
                        if LocalConfig::get_clipboard_sync() {
                            let mut ctx = ClipboardContext::new().unwrap();
                            match ctx.set_contents(text) {
                                Ok(()) => log::info!(
                                    "[Controller] {}",
                                    t!("scrcpy.syncClipboardFromMain")
                                ),
                                Err(e) => log::info!(
                                    "[Controller] {}: {}",
                                    t!("scrcpy.syncClipboardFromMain"),
                                    e
                                ),
                            }
                        }
                    }
                    ScrcpyDeviceMsg::AckClipboard { .. } => {}
                    ScrcpyDeviceMsg::UhidOutput { .. } => {}
                    ScrcpyDeviceMsg::Rotation {
                        rotation,
                        width,
                        height,
                        scid,
                    } => {
                        ws_tx
                            .send(WebSocketNotification::ScrcpyDeviceRotation {
                                rotation,
                                width,
                                height,
                                scid: scid.clone(),
                            })
                            .ok();
                        let msg = mask_win_move_helper(width, height, &m_tx).await;
                        log::info!(
                            "[Controller] {}. {}",
                            t!(
                                "scrcpy.deviceRotation",
                                scid => scid,
                                degree => rotation * 90,
                            ),
                            msg
                        );
                    }
                    ScrcpyDeviceMsg::Unknown => {
                        log::warn!("[Controller] {}", t!("scrcpy.unknownControlMsg"))
                    }
                },
                None => {
                    log::info!("[Controller] {}", t!("scrcpy.crChannelClosed"));
                    break;
                }
            }
        }
    }

    async fn run_server(
        addr: SocketAddrV4,
        cs_tx: broadcast::Sender<ScrcpyControlMsg>,
        v_tx: LatestVideoFrame,
        mut d_rx: UnboundedReceiver<ControllerCommand>,
        m_tx: crossbeam_channel::Sender<(MaskCommand, oneshot::Sender<Result<String, String>>)>,
        ws_tx: broadcast::Sender<WebSocketNotification>,
    ) {
        log::info!("[Controller] {}: {}", t!("scrcpy.startingController"), addr);
        // 端口可能因为上一次进程崩溃或 adb forward 残留而不可用。
        // 先用 SO_REUSEADDR 试一次；如果还失败（比如端口被 adb forward 主动占用），
        // 就清空 adb 的所有 forward 后再试一次，给用户一个"自动善后"的体感，
        // 不再要求手动 `adb kill-server`。
        let listener = match bind_reuseaddr_listener(addr) {
            Ok(l) => l,
            Err(first_err) => {
                let adb_path = LocalConfig::get().adb_path;
                log::warn!(
                    "[Controller] 首次监听 {} 失败: {} (kind={:?})。正在清理 adb 旧转发后重试...",
                    addr,
                    first_err,
                    first_err.kind()
                );
                Device::remove_all_forwards(&adb_path);
                // 给 adb 一个短暂的窗口释放 socket 句柄（Windows 上一般几十 ms 就够）。
                std::thread::sleep(std::time::Duration::from_millis(300));
                match bind_reuseaddr_listener(addr) {
                    Ok(l) => {
                        log::info!("[Controller] 清理 adb 后重试 bind 成功：{}", addr);
                        l
                    }
                    Err(second_err) => {
                        log::error!(
                            "[Controller] 清理 adb 后仍然监听 {} 失败: {} (kind={:?})。请检查是否有其他程序占用此端口，或换一个 controller_port。",
                            addr, second_err, second_err.kind()
                        );
                        return;
                    }
                }
            }
        };

        // scrcpy device msg handler
        let (cr_tx, cr_rx) = mpsc::unbounded_channel::<ScrcpyDeviceMsg>();
        let m_tx_copy = m_tx.clone();
        let ws_tx_copy = ws_tx.clone();
        tokio::spawn(async move { Self::cr_msg_handler(cr_rx, m_tx_copy, ws_tx_copy).await });

        // receive command from web server to accept and shutdown scrcpy connection
        log::info!("[Controller] {}", t!("scrcpy.startReceiveCommand"));
        let mut signal_map: HashMap<String, CancellationToken> = HashMap::new();
        loop {
            match d_rx.recv().await {
                Some(cmd) => match cmd {
                    ControllerCommand::ConnectMainControl(scid, meta_flag) => {
                        let socket_id = "main_control".to_string();

                        if !ControlledDevice::is_scid_controlled(&scid).await {
                            log::error!("{}: {}", t!("scrcpy.deviceNotRecorded"), scid);
                            continue;
                        }

                        let token = CancellationToken::new();
                        signal_map.insert(socket_id.clone(), token.clone());

                        log::info!(
                            "[Controller] {}: {}",
                            t!("scrcpy.creatingMainControl"),
                            scid
                        );
                        let cs_rx = cs_tx.subscribe();
                        let cr_tx_copy = cr_tx.clone();
                        let m_tx_copy = m_tx.clone();
                        match listener.accept().await {
                            Ok((mut socket, _)) => {
                                let config = LocalConfig::get();
                                let preset_display = config
                                    .scrcpy_module
                                    .active_preset()
                                    .map(|preset| &preset.virtual_display);
                                if let Some(display) = preset_display
                                    && display.enabled
                                    && display.start_app_enabled
                                {
                                    let package = display.start_app_package.trim();
                                    if !package.is_empty() {
                                        let name = if display.start_app_force_stop {
                                            format!("+{package}")
                                        } else {
                                            package.to_string()
                                        };
                                        let data: Vec<u8> = ScrcpyControlMsg::StartApp { name: name.clone() }.into();
                                        if let Err(e) = socket.write_all(&data).await {
                                            log::warn!("[Controller] failed to start app on virtual display ({name}): {e}");
                                        } else {
                                            log::info!("[Controller] started app on virtual display: {name}");
                                        }
                                    }
                                }

                                let ws_tx_copy = ws_tx.clone();
                                let scid_copy = scid.clone();
                                ws_tx_copy
                                    .send(WebSocketNotification::ScrcpyDeviceConnection {
                                        scid: scid_copy.clone(),
                                        main: true,
                                        connected: true,
                                    })
                                    .ok();
                                tokio::spawn(async move {
                                    ScrcpyConnection::new(socket)
                                        .handle_control(
                                            cs_rx, cr_tx_copy, m_tx_copy, scid, true, token,
                                            meta_flag,
                                        )
                                        .await;
                                    ws_tx_copy
                                        .send(WebSocketNotification::ScrcpyDeviceConnection {
                                            scid: scid_copy,
                                            main: true,
                                            connected: false,
                                        })
                                        .ok();
                                });
                            }
                            Err(e) => {
                                log::error!(
                                    "[Controller] {}: {}",
                                    t!("scrcpy.errorAcceptingConnection"),
                                    e
                                );
                                ws_tx
                                    .send(WebSocketNotification::ScrcpyDeviceConnection {
                                        scid: scid.clone(),
                                        main: true,
                                        connected: false,
                                    })
                                    .ok();
                                ControlledDevice::remove_device(&scid).await;
                                signal_map.remove(&socket_id);
                            }
                        }
                    }
                    ControllerCommand::ConnectMainVideo(scid, meta_flag) => {
                        let socket_id = "main_video".to_string();

                        if !ControlledDevice::is_scid_controlled(&scid).await {
                            log::error!("{}: {}", t!("scrcpy.deviceNotRecorded"), scid);
                            continue;
                        }

                        let token = CancellationToken::new();
                        signal_map.insert(socket_id.clone(), token.clone());

                        log::info!("[Controller] {}: {}", t!("scrcpy.creatingMainVideo"), scid);
                        let v_tx_copy = v_tx.clone();
                        match listener.accept().await {
                            Ok((socket, _)) => {
                                thread::spawn(move || {
                                    tokio::runtime::Builder::new_current_thread()
                                        .enable_all()
                                        .build()
                                        .unwrap()
                                        .block_on(async move {
                                            ScrcpyConnection::new(socket)
                                                .handle_video(token, v_tx_copy, meta_flag, &scid)
                                                .await;
                                        });
                                });
                            }
                            Err(e) => {
                                log::error!(
                                    "[Controller] {}: {}",
                                    t!("scrcpy.errorAcceptingConnection"),
                                    e
                                );
                                ws_tx
                                    .send(WebSocketNotification::ScrcpyDeviceConnection {
                                        scid: scid.clone(),
                                        main: true,
                                        connected: false,
                                    })
                                    .ok();
                                ControlledDevice::remove_device(&scid).await;
                                signal_map.remove(&socket_id);
                            }
                        }
                    }
                    ControllerCommand::ConnectMainAudio(scid, meta_flag) => {
                        let socket_id = "main_audio".to_string();

                        if !ControlledDevice::is_scid_controlled(&scid).await {
                            log::error!("{}: {}", t!("scrcpy.deviceNotRecorded"), scid);
                            continue;
                        }

                        let token = CancellationToken::new();
                        signal_map.insert(socket_id.clone(), token.clone());

                        log::info!("[Controller] Creating main audio connection: {}", scid);
                        match listener.accept().await {
                            Ok((socket, _)) => {
                                thread::spawn(move || {
                                    tokio::runtime::Builder::new_current_thread()
                                        .enable_all()
                                        .build()
                                        .unwrap()
                                        .block_on(async move {
                                            ScrcpyConnection::new(socket)
                                                .handle_audio(token, meta_flag, &scid)
                                                .await;
                                        });
                                });
                            }
                            Err(e) => {
                                log::error!(
                                    "[Controller] {}: {}",
                                    t!("scrcpy.errorAcceptingConnection"),
                                    e
                                );
                                ws_tx
                                    .send(WebSocketNotification::ScrcpyDeviceConnection {
                                        scid: scid.clone(),
                                        main: true,
                                        connected: false,
                                    })
                                    .ok();
                                ControlledDevice::remove_device(&scid).await;
                                signal_map.remove(&socket_id);
                            }
                        }
                    }
                    ControllerCommand::ConnectSubControl(scid) => {
                        let socket_id = format!("sub_control_{}", scid);

                        if !ControlledDevice::is_scid_controlled(&scid).await {
                            log::error!("{}: {}", t!("scrcpy.deviceNotRecorded"), scid);
                            continue;
                        }

                        let token = CancellationToken::new();
                        signal_map.insert(socket_id.clone(), token.clone());

                        log::info!("[Controller] {}: {}", t!("scrcpy.creatingSubControl"), scid);
                        let sc_rx = cs_tx.subscribe();
                        let cr_tx_copy = cr_tx.clone();
                        let m_tx_copy = m_tx.clone();
                        match listener.accept().await {
                            Ok((socket, _)) => {
                                let ws_tx_copy = ws_tx.clone();
                                let scid_copy = scid.clone();
                                ws_tx_copy
                                    .send(WebSocketNotification::ScrcpyDeviceConnection {
                                        scid: scid_copy.clone(),
                                        main: true,
                                        connected: true,
                                    })
                                    .ok();
                                tokio::spawn(async move {
                                    ScrcpyConnection::new(socket)
                                        .handle_control(
                                            sc_rx, cr_tx_copy, m_tx_copy, scid, false, token, true,
                                        )
                                        .await;
                                    ws_tx_copy
                                        .send(WebSocketNotification::ScrcpyDeviceConnection {
                                            scid: scid_copy,
                                            main: true,
                                            connected: false,
                                        })
                                        .ok();
                                });
                            }
                            Err(e) => {
                                log::error!(
                                    "[Controller] {}: {}",
                                    t!("scrcpy.errorAcceptingConnection"),
                                    e
                                );
                                ws_tx
                                    .send(WebSocketNotification::ScrcpyDeviceConnection {
                                        scid: scid.clone(),
                                        main: true,
                                        connected: false,
                                    })
                                    .ok();
                                ControlledDevice::remove_device(&scid).await;
                                signal_map.remove(&socket_id);
                            }
                        }
                    }
                    ControllerCommand::ShutdownMain(scid) => {
                        if !signal_map.contains_key("main_control") {
                            log::warn!("[Controller] {}", t!("scrcpy.mainConnectionNotExist"));
                        } else {
                            log::info!("[Controller] {}: {}", t!("scrcpy.shutdownMain"), scid);
                            for socket_id in ["main_control", "main_video", "main_audio"] {
                                if let Some(token) = signal_map.get(socket_id) {
                                    token.cancel();
                                    signal_map.remove(socket_id);
                                }
                            }
                            for token in signal_map.values() {
                                token.cancel();
                            }
                            signal_map.clear();
                        }
                    }
                    ControllerCommand::ShutdownSub(scid) => {
                        let socket_id = format!("sub_control_{}", scid);
                        if !signal_map.contains_key(&socket_id) {
                            log::warn!(
                                "[Controller] {}: {}",
                                t!("scrcpy.subConnectionNotExist"),
                                socket_id
                            );
                        } else {
                            log::info!("[Controller] {}: {}", t!("scrcpy.shutdownSub"), scid);
                            if let Some(token) = signal_map.get(&socket_id) {
                                token.cancel();
                                signal_map.remove(&socket_id);
                            }
                        }
                    }
                },
                None => {
                    log::info!("[Controller] {}", t!("scrcpy.dChannelClosed"));
                    break;
                }
            }
        }
        log::info!("[Controller] {}", t!("scrcpy.controllerStopped"));
    }
}
