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

struct ActiveWheelItem {
    key: String,
    pointer_id: u64,
    current_pos: Vec2,
    center: Vec2,
    radius: f32,
    initial_swipe_done: Arc<AtomicBool>,
}

fn wheel_capture_owner(action: &str) -> String {
    format!("Wheel:{action}")
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
}

fn default_wheel_count() -> u32 {
    8
}

impl ValidateMappingConfig for MappingWheel {
    fn validate(&self) -> Result<(), String> {
        if self.count == 0 || self.count > 8 {
            return Err("wheel.count must be between 1 and 8".to_string());
        }
        Ok(())
    }
}

fn cal_wheel_target_pos(cursor_pos: Vec2, center: Vec2, radius: f32, mask_size: Vec2) -> Vec2 {
    let mut delta = cursor_pos - center;
    // screen-space radius: scale the config radius (in original height px)
    // by the same factor used for drag_radius in cast spell
    let screen_radius = radius / 1000.0 * mask_size.y;
    if screen_radius > 0.0 && delta.length_squared() > screen_radius * screen_radius {
        delta = delta.normalize() * screen_radius;
    }
    center + delta
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
    let original_pos: Vec2 = mapping.position.into();
    let original_pos = random_offset_vec2(
        original_pos,
        Vec2::new(mapping.random_offset_x, mapping.random_offset_y),
    );
    let current_pos = original_pos / original_size * mask_size;
    let center = Vec2::new(mapping.center.x as f32, mapping.center.y as f32) / original_size * mask_size;
    let radius = mapping.radius;

    let (random_anchor, _) = if mapping.enable_randomization {
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

    let slide_start = if mapping.enable_randomization {
        random_anchor / original_size * mask_size
    } else {
        current_pos
    };
    let strategy = if mapping.enable_randomization {
        SingleSwipeStrategy::ArcWithEaseOut
    } else {
        SingleSwipeStrategy::Linear
    };
    let initial_swipe_done = spawn_initial_swipe(
        runtime,
        cs_tx,
        pointer_id,
        mask_size,
        slide_start,
        slide_start,
        0,
        DEFAULT_SWIPE_DURATION,
        strategy,
    );

    normal_cursor_capture.request(wheel_capture_owner(&action));

    active_wheel.0 = Some(ActiveWheelItem {
        key: action,
        pointer_id,
        current_pos,
        center,
        radius,
        initial_swipe_done,
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
        let target = cal_wheel_target_pos(cursor_pos.0, wheel.center, wheel.radius, mask_size.0);
        if target != wheel.current_pos {
            ControlMsgHelper::send_touch(
                &cs_tx_res.0,
                MotionEventAction::Move,
                wheel.pointer_id,
                mask_size.0,
                target,
            );
            wheel.current_pos = target;
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
