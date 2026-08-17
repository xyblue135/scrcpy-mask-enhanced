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
    maximized: bool,
}

/// 普通“窗口最大化”状态：仍然是 Windowed 模式，因此 Windows 任务栏会保留。
#[derive(Resource, Default)]
pub struct MaskMaximizeState {
    pub active: bool,
}

impl MaskMaximizeState {
    pub fn suppress_window_persistence(&self) -> bool {
        self.active
    }
}

/// 投屏窗口的无边框全屏状态。
///
/// F11 使用 BorderlessFullscreen，占满当前显示器；退出后恢复进入全屏前的窗口状态。
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
pub fn is_persistable_window_position(pos: IVec2) -> bool {
    #[cfg(target_os = "windows")]
    {
        if pos.x <= -30_000 && pos.y <= -30_000 {
            return false;
        }
    }

    true
}

/// F11 在普通窗口/普通最大化和“当前显示器无边框全屏”之间切换。
pub fn handle_fullscreen_hotkey(
    keys: Res<ButtonInput<KeyCode>>,
    mut window: Single<&mut Window>,
    mut state: ResMut<MaskFullscreenState>,
    mut maximize_state: ResMut<MaskMaximizeState>,
    mut titlebar_state: ResMut<TitlebarState>,
) {
    if !keys.just_pressed(KeyCode::F11) {
        return;
    }

    if state.active {
        leave_fullscreen(&mut window, &mut state, &mut titlebar_state);
    } else if !state.transitioning {
        enter_fullscreen(
            &mut window,
            &mut state,
            &mut maximize_state,
            &mut titlebar_state,
        );
    }
}

fn enter_fullscreen(
    window: &mut Window,
    state: &mut MaskFullscreenState,
    maximize_state: &mut MaskMaximizeState,
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
        maximized: maximize_state.active,
    });

    // 先离开普通最大化，再进入 F11 无边框全屏，避免两种窗口状态互相打架。
    if maximize_state.active {
        window.set_maximized(false);
        maximize_state.active = false;
    }

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

/// 退出全屏后等待 Winit 完成 Windowed 切换，再恢复之前的窗口 geometry/最大化状态。
pub fn apply_pending_window_restore(
    mut window: Single<&mut Window>,
    mut state: ResMut<MaskFullscreenState>,
    mut maximize_state: ResMut<MaskMaximizeState>,
) {
    if !state.transitioning || state.active {
        return;
    }

    if state.restore_after_frames > 0 {
        state.restore_after_frames -= 1;
        return;
    }

    if let Some(snapshot) = state.snapshot.take() {
        maximize_state.active = snapshot.maximized;
        if snapshot.maximized {
            window.set_maximized(true);
        } else {
            window.resolution.set(snapshot.size.x, snapshot.size.y);
            if let Some(position) = snapshot.position {
                window.position = WindowPosition::At(position);
            }
        }
    }

    state.transitioning = false;
}

/// 普通窗口最大化：保留标题栏和 Windows 任务栏，不等同于 F11 全屏。
pub fn toggle_window_maximized(
    window: &mut Window,
    maximize_state: &mut MaskMaximizeState,
    fullscreen_state: &MaskFullscreenState,
) {
    if fullscreen_state.active || fullscreen_state.suppress_window_persistence() {
        return;
    }

    maximize_state.active = !maximize_state.active;
    window.mode = WindowMode::Windowed;
    window.resizable = true;
    window.set_maximized(maximize_state.active);
}
