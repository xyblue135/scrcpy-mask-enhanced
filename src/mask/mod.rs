pub mod mapping;
pub mod mask_command;
pub mod ui;
pub mod video;
pub mod window_state;

use std::time::Duration;

use bevy::{
    app::{App, Plugin, Startup, Update},
    ecs::{
        message::MessageReader,
        system::{Commands, Local, Res, ResMut, Single},
    },
    math::Vec2,
    prelude::{ButtonInput, First, IntoScheduleConfigs, Last, MouseButton, Resource, SystemSet},
    time::{Time, Timer, TimerMode},
    window::{Window, WindowMoved, WindowPosition, WindowResized},
};
use bevy_ui_render::prelude::UiMaterialPlugin;

use crate::{
    config::LocalConfig,
    mask::{
        mapping::cursor::CursorFrameSet,
        mask_command::{
            MaskSize, PendingWindowFocus, TitlebarState, apply_pending_window_focus,
            handle_mask_command, physical_to_logical_i32,
        },
        ui::basic::TITLEBAR_HEIGHT,
        video::{
            VideoAttributes, VideoViewport, YuvVideoMaterial, handle_video_msg,
            handle_video_snapshot_requests,
            sync_video_viewport,
        },
        window_state::{
            MaskFullscreenState, MaskMaximizeState, apply_pending_window_restore,
            handle_fullscreen_hotkey, is_persistable_window_position,
        },
    },
    utils::{ChannelSenderWS, DeviceOrientation, share::ControlledDevice},
    web::ws::WebSocketNotification,
};

#[derive(SystemSet, Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum MaskFrameSet {
    Resize,
}

pub struct MaskPlugins;

impl Plugin for MaskPlugins {
    fn build(&self, app: &mut App) {
        app.add_plugins(UiMaterialPlugin::<YuvVideoMaterial>::default())
            .add_plugins((ui::UiPlugins, mapping::MappingPlugins))
            .init_resource::<PendingWindowFocus>()
            .init_resource::<MaskResizeState>()
            .init_resource::<MaskFullscreenState>()
            .init_resource::<MaskMaximizeState>()
            .init_resource::<VideoViewport>()
            .init_resource::<VideoAttributes>()
            .init_resource::<FrameDiag>()
            .add_systems(First, frame_start)
            .add_systems(Last, record_update_sched)
            .configure_sets(
                Update,
                (MaskFrameSet::Resize, CursorFrameSet::UpdatePosition).chain(),
            )
            .add_systems(Startup, (init_mask_size, init_titlebar_state))
            .add_systems(
                Update,
                (
                    record_frame_time,
                    handle_fullscreen_hotkey,
                    apply_pending_window_restore,
                    sync_mask_size.in_set(MaskFrameSet::Resize),
                    sync_mask_position,
                    handle_mask_command,
                    apply_pending_window_focus.after(handle_mask_command),
                    handle_video_msg,
                    handle_video_snapshot_requests.after(handle_video_msg),
                    sync_video_viewport
                        .after(handle_video_msg)
                        .after(MaskFrameSet::Resize)
                        .before(CursorFrameSet::UpdatePosition),
                ),
            );
    }
}

/// Update 调度诊断：`First` 记起点，`Last` 算主循环耗时，供 `ui.frame_time` 拆分尖峰来源。
#[derive(Resource, Default)]
struct FrameDiag {
    start: Option<std::time::Instant>,
    /// 上一帧主循环（First→Last）耗时（纳秒）。
    app_sched_nanos: u128,
}

/// `First` 调度起点：记录主循环开始时间。
fn frame_start(mut diag: ResMut<FrameDiag>) {
    diag.start = Some(std::time::Instant::now());
}

/// `Last` 调度终点：记录本帧主循环耗时（探针 `ui.app_sched`）。
/// 主循环（First→Last）覆盖 PreUpdate/Update/PostUpdate 等全部主世界调度，
/// 不含渲染世界的 Present 等待。
fn record_update_sched(mut diag: ResMut<FrameDiag>) {
    if let Some(start) = diag.start.take() {
        diag.app_sched_nanos = start.elapsed().as_nanos();
    }
    crate::perf::record("ui.app_sched", diag.app_sched_nanos);
}

/// 记录 Bevy 每帧耗时（探针 `ui.frame_time`）：avg≈帧耗时，count≈每秒 UI 帧数。
/// 同时拆出 `ui.app_sched`（主循环）与 `ui.present_wait`（渲染提交 + Present 等待）：
/// 尖峰落在 present_wait → 改 PresentMode；落在 app_sched → 查 Update 系统。
fn record_frame_time(time: Res<Time>, diag: Res<FrameDiag>) {
    let frame_nanos = time.delta().as_nanos();
    crate::perf::record("ui.frame_time", frame_nanos);
    crate::perf::record(
        "ui.present_wait",
        frame_nanos.saturating_sub(diag.app_sched_nanos),
    );
}

fn init_mask_size(mut commands: Commands, window: Single<&Window>) {
    let config = LocalConfig::get();
    let mask_h = if config.titlebar_visible {
        (window.size().y - TITLEBAR_HEIGHT).max(0.0)
    } else {
        window.size().y
    };
    commands.insert_resource(MaskSize(Vec2::new(window.size().x, mask_h)));
}

fn init_titlebar_state(mut commands: Commands) {
    let config = LocalConfig::get();
    commands.insert_resource(TitlebarState {
        visible: config.titlebar_visible,
    });
}

const DEBOUNCE_MS: u64 = 200;

#[derive(Resource)]
pub struct MaskResizeState {
    active: bool,
    pending_apply: bool,
    timer: Timer,
}

impl Default for MaskResizeState {
    fn default() -> Self {
        Self {
            active: false,
            pending_apply: false,
            timer: Timer::new(Duration::from_millis(DEBOUNCE_MS), TimerMode::Once),
        }
    }
}

impl MaskResizeState {
    pub fn begin_interaction(&mut self) {
        self.active = true;
        self.timer.reset();
    }

    fn mark_resized(&mut self) {
        self.begin_interaction();
        self.pending_apply = true;
    }

    pub fn active(&self) -> bool {
        self.active
    }

    fn tick(&mut self, delta: Duration, mouse_input: &ButtonInput<MouseButton>) -> bool {
        if !self.active {
            return false;
        }

        if mouse_input.pressed(MouseButton::Left) {
            self.timer.reset();
            return false;
        }

        self.timer.tick(delta);
        if !self.timer.just_finished() {
            return false;
        }

        self.active = false;
        std::mem::take(&mut self.pending_apply)
    }
}

#[derive(Default)]
struct MoveDebounce {
    timer: Timer,
    pending: bool,
}

impl MoveDebounce {
    fn ensure_init(&mut self) {
        if self.timer.duration() == Duration::ZERO {
            self.timer = Timer::new(Duration::from_millis(DEBOUNCE_MS), TimerMode::Once);
        }
    }
}

fn sync_mask_size(
    mut resize_reader: MessageReader<WindowResized>,
    titlebar_state: Res<TitlebarState>,
    mut mask_size: ResMut<MaskSize>,
    mut window: Single<&mut Window>,
    time: Res<Time>,
    mouse_input: Res<ButtonInput<MouseButton>>,
    mut resize_state: ResMut<MaskResizeState>,
    fullscreen_state: Res<MaskFullscreenState>,
    maximize_state: Res<MaskMaximizeState>,
    ws_tx: Res<ChannelSenderWS>,
) {
    for e in resize_reader.read() {
        // Windows 最小化期间可能短暂上报 0×0 或极小尺寸。
        // 这种临时尺寸不能覆盖正常投屏窗口配置。
        if e.width < 32.0 || e.height < 32.0 {
            continue;
        }

        // 退出全屏的 Windowed 过渡阶段会产生中间 resize 事件，直接忽略。
        if fullscreen_state.suppress_window_persistence() && !fullscreen_state.active {
            continue;
        }

        let h = if fullscreen_state.active {
            e.height
        } else {
            (e.height - titlebar_state.offset()).max(0.0)
        };
        mask_size.0 = Vec2::new(e.width, h);

        if !fullscreen_state.active && !maximize_state.active {
            resize_state.mark_resized();
        }
    }

    // 无边框全屏使用当前显示器分辨率，不执行普通窗口宽高比修正，
    // 也不把全屏尺寸写回 horizontal_mask_width / vertical_mask_height。
    if fullscreen_state.suppress_window_persistence()
        || maximize_state.suppress_window_persistence()
    {
        return;
    }

    if resize_state.tick(time.delta(), &mouse_input) {
        if let Some(device) = ControlledDevice::get_main_device_blocking() {
            let (dw, dh) = device.device_size;
            if dw == 0 || dh == 0 {
                return;
            }
            let device_w = dw as f32;
            let device_h = dh as f32;
            let orientation = DeviceOrientation::from_size(dw, dh);
            let titlebar_offset = titlebar_state.offset();
            let current_w = mask_size.0.x;
            let current_h = mask_size.0.y;

            match orientation {
                DeviceOrientation::Landscape => {
                    let target_h = (current_w * (device_h / device_w)).round();
                    if target_h != current_h {
                        window.resolution.set(current_w, target_h + titlebar_offset);
                        mask_size.0 = Vec2::new(current_w, target_h);
                    }
                }
                DeviceOrientation::Portrait => {
                    let target_w = (current_h * (device_w / device_h)).round();
                    if target_w != current_w {
                        window.resolution.set(target_w, current_h + titlebar_offset);
                        mask_size.0 = Vec2::new(target_w, current_h);
                    }
                }
            }

            // Persist size and position after debounce settles
            let content_w = mask_size.0.x.round() as u32;
            let content_h = mask_size.0.y.round() as u32;
            let WindowPosition::At(pos) = window.position else {
                return;
            };
            if !is_persistable_window_position(pos) {
                return;
            }
            let scale_factor = window.resolution.scale_factor() as f32;
            let content_top = if titlebar_state.visible {
                physical_to_logical_i32(pos.y, scale_factor) + TITLEBAR_HEIGHT.round() as i32
            } else {
                physical_to_logical_i32(pos.y, scale_factor)
            };
            let content_left = physical_to_logical_i32(pos.x, scale_factor);

            match orientation {
                DeviceOrientation::Landscape => {
                    LocalConfig::set_horizontal_mask_width(content_w);
                    LocalConfig::set_horizontal_position((content_left, content_top));
                    let _ = ws_tx.0.send(WebSocketNotification::ConfigChanged {
                        keys: vec!["horizontal_mask_width".into(), "horizontal_position".into()],
                    });
                }
                DeviceOrientation::Portrait => {
                    LocalConfig::set_vertical_mask_height(content_h);
                    LocalConfig::set_vertical_position((content_left, content_top));
                    let _ = ws_tx.0.send(WebSocketNotification::ConfigChanged {
                        keys: vec!["vertical_mask_height".into(), "vertical_position".into()],
                    });
                }
            }
        }
    }
}

fn sync_mask_position(
    mut move_reader: MessageReader<WindowMoved>,
    window: Single<&Window>,
    titlebar_state: Res<TitlebarState>,
    time: Res<Time>,
    mut debounce: Local<MoveDebounce>,
    fullscreen_state: Res<MaskFullscreenState>,
    maximize_state: Res<MaskMaximizeState>,
    ws_tx: Res<ChannelSenderWS>,
) {
    debounce.ensure_init();

    for _ in move_reader.read() {
        debounce.timer.reset();
        debounce.pending = true;
    }

    // 全屏和退出全屏的恢复阶段都会产生系统级 WindowMoved，
    // 这些位置不能覆盖普通窗口的保存位置。
    if fullscreen_state.suppress_window_persistence()
        || maximize_state.suppress_window_persistence()
    {
        debounce.pending = false;
        return;
    }

    if debounce.pending {
        debounce.timer.tick(time.delta());
        if debounce.timer.just_finished() {
            debounce.pending = false;
            if let Some(device) = ControlledDevice::get_main_device_blocking() {
                let (dw, dh) = device.device_size;
                if dw == 0 || dh == 0 {
                    return;
                }
                let WindowPosition::At(pos) = window.position else {
                    return;
                };
                if !is_persistable_window_position(pos) {
                    return;
                }
                let scale_factor = window.resolution.scale_factor() as f32;
                let content_top = if titlebar_state.visible {
                    physical_to_logical_i32(pos.y, scale_factor) + TITLEBAR_HEIGHT.round() as i32
                } else {
                    physical_to_logical_i32(pos.y, scale_factor)
                };
                let content_left = physical_to_logical_i32(pos.x, scale_factor);

                match DeviceOrientation::from_size(dw, dh) {
                    DeviceOrientation::Landscape => {
                        LocalConfig::set_horizontal_position((content_left, content_top));
                        let _ = ws_tx.0.send(WebSocketNotification::ConfigChanged {
                            keys: vec!["horizontal_position".into()],
                        });
                    }
                    DeviceOrientation::Portrait => {
                        LocalConfig::set_vertical_position((content_left, content_top));
                        let _ = ws_tx.0.send(WebSocketNotification::ConfigChanged {
                            keys: vec!["vertical_position".into()],
                        });
                    }
                }
            }
        }
    }
}
