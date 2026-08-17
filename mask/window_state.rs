use bevy::{
    math::{IVec2, Vec2},
    prelude::{ButtonInput, KeyCode, Res, ResMut, Resource, Single},
    window::{MonitorSelection, Window, WindowMode, WindowPosition},
};

use crate::mask::mask_command::TitlebarState;

#[derive(Clone, Copy)]
struct WindowedSnapshot {
    position: Option<IVec2>,
    size: Vec2,
    titlebar_visible: bool,
    resizable: bool,
}

/// 投屏窗口的无边框全屏状态。
///
/// 全屏期间以及退出全屏的恢复阶段，普通窗口的位置和尺寸都不会写入配置，
/// 从而避免显示器分辨率覆盖用户原来的投屏窗口尺寸。
#[derive(Resource, Default)]
pub struct MaskFullscreenState {
    pub active: bool,
    transitioning: bool,
    restore_after_frames: u8,
    snapshot: Option<WindowedSnapshot>,
}

impl MaskFullscreenState {
    pub fn suppress_window_persistence(&self) -> bool {
        self.active || self.transitioning
    }
}

/// Windows 最小化普通顶层窗口时，系统可能临时把窗口移动到
/// (-32000, -32000) 附近。这个坐标不是用户真实的桌面位置。
///
/// 这里只过滤 X/Y 同时进入极端负值的情况，因此左侧副屏常见的
/// (-1920, 0) 等合法负坐标不会受到影响。
pub fn is_persistable_window_position(pos: IVec2) -> bool {
    #[cfg(target_os = "windows")]
    {
        if pos.x <= -30_000 && pos.y <= -30_000 {
            return false;
        }
    }

    true
}

/// F11 在普通窗口和“当前显示器无边框全屏”之间切换。
pub fn handle_fullscreen_hotkey(
    keys: Res<ButtonInput<KeyCode>>,
    mut window: Single<&mut Window>,
    mut state: ResMut<MaskFullscreenState>,
    mut titlebar_state: ResMut<TitlebarState>,
) {
    if !keys.just_pressed(KeyCode::F11) {
        return;
    }

    if state.active {
        leave_fullscreen(&mut window, &mut state, &mut titlebar_state);
    } else if !state.transitioning {
        enter_fullscreen(&mut window, &mut state, &mut titlebar_state);
    }
}

fn enter_fullscreen(
    window: &mut Window,
    state: &mut MaskFullscreenState,
    titlebar_state: &mut TitlebarState,
) {
    state.snapshot = Some(WindowedSnapshot {
        position: match window.position {
            WindowPosition::At(pos) if is_persistable_window_position(pos) => Some(pos),
            _ => None,
        },
        size: window.size(),
        titlebar_visible: titlebar_state.visible,
        resizable: window.resizable,
    });

    state.active = true;
    titlebar_state.visible = false;
    window.resizable = false;
    window.mode = WindowMode::BorderlessFullscreen(MonitorSelection::Current);
}

fn leave_fullscreen(
    window: &mut Window,
    state: &mut MaskFullscreenState,
    titlebar_state: &mut TitlebarState,
) {
    state.active = false;
    state.transitioning = true;
    state.restore_after_frames = 2;
    window.mode = WindowMode::Windowed;

    if let Some(snapshot) = state.snapshot {
        titlebar_state.visible = snapshot.titlebar_visible;
        window.resizable = snapshot.resizable;
    }
}

/// 退出全屏后等待 Winit 完成 Windowed 切换，再恢复之前的窗口 geometry。
/// 这样比在切换 WindowMode 的同一帧立刻 set size/position 更稳定。
pub fn apply_pending_window_restore(
    mut window: Single<&mut Window>,
    mut state: ResMut<MaskFullscreenState>,
) {
    if !state.transitioning || state.active {
        return;
    }

    if state.restore_after_frames > 0 {
        state.restore_after_frames -= 1;
        return;
    }

    if let Some(snapshot) = state.snapshot.take() {
        window.resolution.set(snapshot.size.x, snapshot.size.y);
        if let Some(position) = snapshot.position {
            window.position = WindowPosition::At(position);
        }
    }

    state.transitioning = false;
}
