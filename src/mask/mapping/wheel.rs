use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use bevy::{
    ecs::{
        resource::Resource,
        system::{Commands, Local, Res, ResMut, Single},
    },
    math::Vec2,
    window::Window,
};
use bevy_ineffable::prelude::{ContinuousBinding, Ineffable, InputBinding};
use serde::{Deserialize, Serialize};

use std::time::{Duration, Instant};

use crate::{
    mask::{
        mapping::{
            binding::{ButtonBinding, ValidateMappingConfig},
            config::{ActiveMappingConfig, BindMappingType},
            cursor::{CursorPosition, NormalCursorCapture},
            utils::{
                ControlMsgHelper, DEFAULT_SWIPE_DURATION, Position, SingleSwipeStrategy,
                anchor_random_offset, default_random_offset, random_offset_vec2,
                spawn_initial_swipe,
            },
        },
        mask_command::MaskSize,
    },
    config::LocalConfig,
    scrcpy::constant::MotionEventAction,
    tokio_tasks::TokioTasksRuntime,
    utils::ChannelSenderCS,
};

/// Wheel button (轮盘专用按钮):
/// Hold the bound key, drag the mouse toward one of the radial sectors, then
/// release. The touch is placed in the direction of the cursor (clamped to
/// `radius`), so the game's own radial item menu selects the item under the
/// lifted finger.
pub fn wheel_init(mut commands: Commands) {
    commands.insert_resource(ActiveWheel::default());
}

#[derive(Resource, Default)]
pub struct ActiveWheel(Option<ActiveWheelItem>);

impl ActiveWheel {
    /// Whether a wheel gesture is currently in progress. Used by other
    /// mappings (Observation / Fps) to suppress their own mouse capture while
    /// the wheel is being dragged, so the two don't fight over the cursor.
    pub fn is_active(&self) -> bool {
        self.0.is_some()
    }

    /// Snapshot of the active wheel's HUD state (center in screen space,
    /// sector count and the currently snapped sector). Returns `None` when no
    /// wheel is active. Used by the HUD overlay to render the feedback ring.
    pub fn hud_state(&self) -> Option<WheelHudState> {
        self.0.as_ref().map(|w| WheelHudState {
            center: w.center,
            count: w.count,
            current_sector: w.current_sector,
        })
    }
}

/// Screen-space snapshot for the wheel HUD overlay.
#[derive(Debug, Clone, Copy)]
pub struct WheelHudState {
    pub center: Vec2,
    pub count: u32,
    pub current_sector: Option<u32>,
}

struct ActiveWheelItem {
    key: String,
    pointer_id: u64,
    current_pos: Vec2,
    center: Vec2,
    radius: f32,
    dead_radius: f32,
    count: u32,
    start_angle: f32,
    current_sector: Option<u32>,
    initial_swipe_done: Arc<AtomicBool>,
    /// `OnHoverDelay` mode: the timestamp when the cursor entered the current
    /// sector. `None` when not armed (cursor in deadzone / mode is OnRelease).
    hover_armed_at: Option<Instant>,
    /// Periodic random-drift state (trajectory randomization).
    enable_randomization: bool,
    jitter_interval_ms: u64,
    jitter_offset: f32,
    next_jitter_at: Instant,
    current_jitter: Vec2,
}

fn wheel_capture_owner(action: &str) -> String {
    format!("Wheel:{action}")
}

/// Release strategy for wheel selection.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum WheelReleaseMode {
    /// Select on key release (default): the touch Up is sent when the bound
    /// key is released.
    #[default]
    OnRelease,
    /// Select after hovering the target sector for `hover_delay_ms` without
    /// releasing the key. Once confirmed, the wheel commits and releases.
    OnHoverDelay,
}

#[derive(Debug, Clone)]
pub struct BindMappingWheel {
    pub id: String,
    pub note: String,
    pub pointer_id: u64,
    pub position: Position,
    pub center: Position,
    pub radius: f32,
    pub count: u32,
    pub enable_randomization: bool,
    pub initial_duration: u64,
    pub bind: ButtonBinding,
    pub input_binding: InputBinding,
    pub random_offset_x: f32,
    pub random_offset_y: f32,
    pub dead_radius: f32,
    pub start_angle: f32,
    pub release_mode: WheelReleaseMode,
    pub hover_delay_ms: u64,
    pub jitter_offset: f32,
    pub jitter_interval_ms: u64,
}

impl From<MappingWheel> for BindMappingWheel {
    fn from(value: MappingWheel) -> Self {
        Self {
            id: value.id,
            note: value.note,
            pointer_id: value.pointer_id,
            position: value.position,
            center: value.center,
            radius: value.radius,
            count: value.count,
            enable_randomization: value.enable_randomization,
            initial_duration: value.initial_duration,
            bind: value.bind.clone(),
            input_binding: ContinuousBinding::hold(value.bind).0,
            random_offset_x: value.random_offset_x,
            random_offset_y: value.random_offset_y,
            dead_radius: value.dead_radius,
            start_angle: value.start_angle,
            release_mode: value.release_mode,
            hover_delay_ms: value.hover_delay_ms,
            jitter_offset: value.jitter_offset,
            jitter_interval_ms: value.jitter_interval_ms,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MappingWheel {
    #[serde(default = "crate::mask::mapping::config::default_mapping_id")]
    pub id: String,
    pub note: String,
    pub pointer_id: u64,
    pub position: Position,
    pub center: Position,
    #[serde(serialize_with = "crate::mask::mapping::serde_float::serialize_f32_3dp")]
    pub radius: f32,
    #[serde(default = "default_wheel_count")]
    pub count: u32,
    #[serde(default)]
    pub enable_randomization: bool,
    #[serde(default)]
    pub initial_duration: u64,
    pub bind: ButtonBinding,
    #[serde(
        default = "default_random_offset",
        serialize_with = "crate::mask::mapping::serde_float::serialize_f32_3dp"
    )]
    pub random_offset_x: f32,
    #[serde(
        default = "default_random_offset",
        serialize_with = "crate::mask::mapping::serde_float::serialize_f32_3dp"
    )]
    pub random_offset_y: f32,
    #[serde(default, serialize_with = "crate::mask::mapping::serde_float::serialize_f32_3dp")]
    pub dead_radius: f32,
    #[serde(default, serialize_with = "crate::mask::mapping::serde_float::serialize_f32_3dp")]
    pub start_angle: f32,
    #[serde(default)]
    pub release_mode: WheelReleaseMode,
    #[serde(default = "default_wheel_hover_delay_ms")]
    pub hover_delay_ms: u64,
    #[serde(
        default = "default_wheel_jitter_offset",
        serialize_with = "crate::mask::mapping::serde_float::serialize_f32_3dp"
    )]
    pub jitter_offset: f32,
    /// 随机偏移周期（毫秒）：轮盘激活期间每隔该周期在目标位置叠加一次随机偏移。
    #[serde(default = "default_wheel_jitter_interval_ms")]
    pub jitter_interval_ms: u64,
}

fn default_wheel_count() -> u32 {
    8
}

fn default_wheel_hover_delay_ms() -> u64 {
    300
}

fn default_wheel_jitter_offset() -> f32 {
    2.0
}

fn default_wheel_jitter_interval_ms() -> u64 {
    80
}

impl ValidateMappingConfig for MappingWheel {
    fn validate(&self) -> Result<(), String> {
        if self.count == 0 || self.count > 8 {
            return Err("wheel.count must be between 1 and 8".to_string());
        }
        if self.dead_radius < 0.0 {
            return Err("wheel.dead_radius must be >= 0".to_string());
        }
        if !(0.0..360.0).contains(&self.start_angle) {
            return Err("wheel.start_angle must be in [0, 360)".to_string());
        }
        if self.jitter_offset < 0.0 {
            return Err("wheel.jitter_offset must be >= 0".to_string());
        }
        Ok(())
    }
}

/// Result of resolving the cursor position into a wheel target.
struct WheelTarget {
    /// The touch position to place on screen.
    pos: Vec2,
    /// The sector index the cursor snaps to, or `None` when inside the
    /// center deadzone (touch stays locked to the wheel center).
    sector: Option<u32>,
}

/// Computes the wheel touch target from the cursor position:
/// 1. applies the center deadzone (`dead_radius`),
/// 2. snaps the cursor angle to the nearest sector center (`count`),
/// 3. clamps the distance to the wheel radius.
fn cal_wheel_target_pos(
    cursor_pos: Vec2,
    center: Vec2,
    radius: f32,
    dead_radius: f32,
    count: u32,
    start_angle: f32,
    mask_size: Vec2,
) -> WheelTarget {
    let delta = cursor_pos - center;
    // screen-space radius: scale the config radius (in original height px)
    // by the same factor used for drag_radius in cast spell.
    let screen_radius = radius / 1000.0 * mask_size.y;
    let screen_dead_radius = dead_radius / 1000.0 * mask_size.y;

    // Inside the center deadzone -> keep the touch locked to the center.
    if delta.length_squared() <= screen_dead_radius * screen_dead_radius {
        return WheelTarget {
            pos: center,
            sector: None,
        };
    }

    let count_f = count.max(1) as f32;
    let sector_angle = std::f32::consts::TAU / count_f;

    // Angle of the cursor relative to the wheel center, adjusted by the
    // user-configured start-angle offset (which aligns sector 0 with the
    // game's own radial menu orientation).
    let angle = delta.y.atan2(delta.x) - start_angle.to_radians();

    // Snap to the nearest sector, then target the *center* of that sector.
    let sector = (angle / sector_angle).round().rem_euclid(count_f) as u32;
    let target_angle = start_angle.to_radians() + sector as f32 * sector_angle + sector_angle / 2.0;

    let mut snapped = Vec2::new(target_angle.cos(), target_angle.sin());
    // Clamp to the wheel radius; snap distance to a fixed fraction of the
    // radius so the touch reliably lands inside the sector (not on its edge).
    let snap_distance = if screen_radius > 0.0 {
        screen_radius * 0.85
    } else {
        delta.length()
    };
    snapped *= snap_distance;

    WheelTarget {
        pos: center + snapped,
        sector: Some(sector),
    }
}

fn take_active_wheel(
    cs_tx: &tokio::sync::broadcast::Sender<crate::scrcpy::control_msg::ScrcpyControlMsg>,
    mask_size: Vec2,
    active: &mut ActiveWheel,
) -> Option<ActiveWheelItem> {
    let wheel = active.0.take()?;
    ControlMsgHelper::send_touch(
        cs_tx,
        MotionEventAction::Up,
        wheel.pointer_id,
        mask_size,
        wheel.current_pos,
    );
    Some(wheel)
}

pub fn cleanup_wheel_on_stop(
    active_mapping: Res<ActiveMappingConfig>,
    cs_tx_res: Res<ChannelSenderCS>,
    mask_size: Res<MaskSize>,
    mut active_wheel: ResMut<ActiveWheel>,
    mut normal_cursor_capture: ResMut<NormalCursorCapture>,
) {
    if let Some(wheel) = active_wheel.0.take() {
        ControlMsgHelper::send_touch(
            &cs_tx_res.0,
            MotionEventAction::Up,
            wheel.pointer_id,
            mask_size.0,
            wheel.current_pos,
        );
        normal_cursor_capture.release(&wheel_capture_owner(&wheel.key));
    }
    if let Some(active_mapping) = &active_mapping.0 {
        for action in active_mapping.mappings.keys() {
            if action.as_ref().starts_with("Wheel") {
                normal_cursor_capture.release(&wheel_capture_owner(action.as_ref()));
            }
        }
    }
}

fn start_wheel(
    cs_tx: &tokio::sync::broadcast::Sender<crate::scrcpy::control_msg::ScrcpyControlMsg>,
    runtime: &TokioTasksRuntime,
    active_wheel: &mut ActiveWheel,
    normal_cursor_capture: &mut NormalCursorCapture,
    action: String,
    mapping: &BindMappingWheel,
    original_size: Vec2,
    mask_size: Vec2,
) {
    // release a previous wheel if still active
    take_active_wheel(cs_tx, mask_size, active_wheel);

    let pointer_id = mapping.pointer_id;
    let randomization = mapping.enable_randomization
        && LocalConfig::get_mapping_randomization_enabled();
    let original_pos: Vec2 = mapping.position.into();
    // 「随机中心偏移」归全局按钮随机化开关控制。
    let random_offset = if LocalConfig::get_button_randomization_enabled() {
        Vec2::new(mapping.random_offset_x, mapping.random_offset_y)
    } else {
        Vec2::ZERO
    };
    let original_pos = random_offset_vec2(original_pos, random_offset);
    let current_pos = original_pos / original_size * mask_size;
    let center = Vec2::new(mapping.center.x as f32, mapping.center.y as f32) / original_size * mask_size;
    let radius = mapping.radius;

    let (random_anchor, _) = if randomization {
        let offset = anchor_random_offset(radius, radius);
        (random_offset_vec2(original_pos, offset), offset)
    } else {
        (Vec2::ZERO, Vec2::ZERO)
    };

    ControlMsgHelper::send_touch(
        cs_tx,
        MotionEventAction::Down,
        pointer_id,
        mask_size,
        current_pos,
    );

    let slide_start = if randomization {
        random_anchor / original_size * mask_size
    } else {
        current_pos
    };
    let strategy = if randomization {
        SingleSwipeStrategy::ArcWithEaseOut
    } else {
        SingleSwipeStrategy::Linear
    };
    // 滑入轮盘不再做密集微抖：之前 initial_duration 的 jitter（每 16ms 一条
    // Move）是「多键同时按下不跟手」的主要来源。随机化现在改为
    // handle_wheel_trigger 里的**周期漂移**（每 jitter_interval_ms 一次）。
    let initial_swipe_done = spawn_initial_swipe(
        runtime,
        cs_tx,
        pointer_id,
        mask_size,
        slide_start,
        center,
        0,
        DEFAULT_SWIPE_DURATION,
        strategy,
        0.0,
    );

    normal_cursor_capture.request(wheel_capture_owner(&action));

    active_wheel.0 = Some(ActiveWheelItem {
        key: action,
        pointer_id,
        current_pos,
        center,
        radius,
        dead_radius: mapping.dead_radius,
        count: mapping.count,
        start_angle: mapping.start_angle,
        current_sector: None,
        initial_swipe_done,
        hover_armed_at: None,
        enable_randomization: randomization,
        jitter_interval_ms: mapping.jitter_interval_ms,
        jitter_offset: mapping.jitter_offset,
        next_jitter_at: Instant::now() + Duration::from_millis(mapping.jitter_interval_ms),
        current_jitter: Vec2::ZERO,
    });
}

pub fn handle_wheel_trigger(
    cs_tx_res: Res<ChannelSenderCS>,
    cursor_pos: Res<CursorPosition>,
    mask_size: Res<MaskSize>,
    mut active_wheel: ResMut<ActiveWheel>,
) {
    if let Some(wheel) = active_wheel.0.as_mut() {
        if !wheel.initial_swipe_done.load(Ordering::Relaxed) {
            return;
        }
        let target = cal_wheel_target_pos(
            cursor_pos.0,
            wheel.center,
            wheel.radius,
            wheel.dead_radius,
            wheel.count,
            wheel.start_angle,
            mask_size.0,
        );

        // 周期随机漂移：每 jitter_interval_ms 在目标位置叠加一次随机偏移。
        // 低频、跟手，不像旧的 initial_duration 抖动那样密集刷 Move。
        if wheel.enable_randomization
            && wheel.jitter_interval_ms > 0
            && Instant::now() >= wheel.next_jitter_at
        {
            wheel.current_jitter = Vec2::new(
                (rand::random::<f32>() * 2.0 - 1.0) * wheel.jitter_offset,
                (rand::random::<f32>() * 2.0 - 1.0) * wheel.jitter_offset,
            );
            wheel.next_jitter_at =
                Instant::now() + Duration::from_millis(wheel.jitter_interval_ms);
        }

        let target_pos = target.pos + wheel.current_jitter;
        if target_pos != wheel.current_pos {
            ControlMsgHelper::send_touch(
                &cs_tx_res.0,
                MotionEventAction::Move,
                wheel.pointer_id,
                mask_size.0,
                target_pos,
            );
            wheel.current_pos = target_pos;
        }

        // Track hover-delay arming for OnHoverDelay release mode.
        if target.sector != wheel.current_sector {
            wheel.current_sector = target.sector;
            wheel.hover_armed_at = target.sector.map(|_| Instant::now());
        }
    }
}

pub fn handle_wheel(
    ineffable: Res<Ineffable>,
    active_mapping: Res<ActiveMappingConfig>,
    cs_tx_res: Res<ChannelSenderCS>,
    mask_size: Res<MaskSize>,
    runtime: ResMut<TokioTasksRuntime>,
    mut active_wheel: ResMut<ActiveWheel>,
    mut normal_cursor_capture: ResMut<NormalCursorCapture>,
) {
    if let Some(active_mapping) = &active_mapping.0 {
        for (action, mapping) in &active_mapping.mappings {
            if action.as_ref().starts_with("Wheel") {
                let mapping = match mapping {
                    BindMappingType::Wheel(m) => m,
                    _ => continue,
                };
                if ineffable.just_activated(action.ineff_continuous()) {
                    start_wheel(
                        &cs_tx_res.0,
                        &runtime,
                        &mut active_wheel,
                        &mut normal_cursor_capture,
                        action.to_string(),
                        mapping,
                        active_mapping.original_size.into(),
                        mask_size.0,
                    );
                } else if ineffable.just_deactivated(action.ineff_continuous()) {
                    if active_wheel
                        .0
                        .as_ref()
                        .is_some_and(|w| w.key == action.as_ref())
                    {
                        take_active_wheel(&cs_tx_res.0, mask_size.0, &mut active_wheel);
                        normal_cursor_capture.release(&wheel_capture_owner(action.as_ref()));
                    }
                }

                // OnHoverDelay: auto-commit when the cursor has hovered the
                // current sector long enough, even while the key is still held.
                if mapping.release_mode == WheelReleaseMode::OnHoverDelay {
                    if let Some(wheel) = active_wheel.0.as_mut()
                        && wheel.key == action.as_ref()
                        && wheel.initial_swipe_done.load(Ordering::Relaxed)
                    {
                        if let Some(armed_at) = wheel.hover_armed_at
                            && wheel.current_sector.is_some()
                            && armed_at.elapsed().as_millis() as u64 >= mapping.hover_delay_ms
                        {
                            take_active_wheel(&cs_tx_res.0, mask_size.0, &mut active_wheel);
                            normal_cursor_capture.release(&wheel_capture_owner(action.as_ref()));
                        }
                    }
                }
            }
        }
    }
}

pub fn handle_wheel_focus_lost(
    window: Single<&Window>,
    mut was_focused: Local<bool>,
    active_mapping: Res<ActiveMappingConfig>,
    cs_tx_res: Res<ChannelSenderCS>,
    mask_size: Res<MaskSize>,
    mut active_wheel: ResMut<ActiveWheel>,
    mut normal_cursor_capture: ResMut<NormalCursorCapture>,
) {
    let lost_focus = *was_focused && !window.focused;
    *was_focused = window.focused;
    if !lost_focus {
        return;
    }
    if let Some(wheel) = active_wheel.0.take() {
        ControlMsgHelper::send_touch(
            &cs_tx_res.0,
            MotionEventAction::Up,
            wheel.pointer_id,
            mask_size.0,
            wheel.current_pos,
        );
        normal_cursor_capture.release(&wheel_capture_owner(&wheel.key));
    }
    if let Some(active_mapping) = &active_mapping.0 {
        for action in active_mapping.mappings.keys() {
            if action.as_ref().starts_with("Wheel") {
                normal_cursor_capture.release(&wheel_capture_owner(action.as_ref()));
            }
        }
    }
}
