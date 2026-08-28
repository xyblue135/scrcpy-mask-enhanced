use bevy::{
    math::IVec2,
    prelude::{ButtonInput, KeyCode, Res, ResMut, Resource, Single},
    window::{Window, WindowMode},
};

/// 普通"窗口最大化"状态：仍然是 Windowed 模式，因此 Windows 任务栏会保留。
#[derive(Resource, Default)]
pub struct MaskMaximizeState {
    pub active: bool,
}

impl MaskMaximizeState {
    pub fn suppress_window_persistence(&self) -> bool {
        self.active
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

/// F11 现在和右上角「最大化」按钮行为一致：在普通窗口和最大化之间切换。
///
/// 之前 F11 进入的是 BorderlessFullscreen（无边框全屏），会让视频被拉伸
/// 且键位错位；现在任何状态下都用 contain 缩放保持手机源比例，所以最大化
/// 时直接按比例放大就够了，不再需要无边框全屏。
pub fn handle_fullscreen_hotkey(
    keys: Res<ButtonInput<KeyCode>>,
    mut window: Single<&mut Window>,
    mut maximize_state: ResMut<MaskMaximizeState>,
) {
    if !keys.just_pressed(KeyCode::F11) {
        return;
    }
    toggle_window_maximized(&mut window, &mut maximize_state);
}

/// 普通窗口最大化：保留标题栏和 Windows 任务栏。
///
/// `video.rs::sync_video_viewport` 总是启用 contain 缩放，所以最大化后
/// 视频保持手机源比例（黑边而不是拉伸），键位位置和视频始终对齐。
pub fn toggle_window_maximized(window: &mut Window, maximize_state: &mut MaskMaximizeState) {
    maximize_state.active = !maximize_state.active;
    window.mode = WindowMode::Windowed;
    window.resizable = true;
    window.set_maximized(maximize_state.active);
}
