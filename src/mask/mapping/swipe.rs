use std::time::Duration;

use crate::tokio_tasks::TokioTasksRuntime;
use bevy::{
    ecs::system::{Res, ResMut},
    math::Vec2,
    state::state::State,
};
use bevy_ineffable::prelude::*;
use serde::{Deserialize, Serialize};
use tokio::time::sleep;

use crate::{
    mask::mapping::{
        MappingState,
        binding::{ButtonBinding, ValidateMappingConfig},
        config::ActiveMappingConfig,
        cursor::{CursorPosition, CursorState},
        executor::{MappingExecutionError, make_mapping_execution_context, run_with_hooks},
        script::{BindMappingScriptHooks, MappingScriptHooks},
        script_helper::{ScriptRuntimeCommandSender, ScriptSharedState},
        utils::{
            ControlMsgHelper, Position, SingleSwipeStrategy,
            build_single_segment_swipe_intermediate_points,
        },
    },
    mask::mask_command::MaskSize,
    config::LocalConfig,
    scrcpy::constant::MotionEventAction,
    utils::ChannelSenderCS,
};

#[derive(Debug, Clone)]
pub struct BindMappingSwipe {
    pub id: String,
    pub note: String,
    pub pointer_id: u64,
    pub positions: Vec<Position>,
    pub duration: u64,
    pub enable_randomization: bool,
    pub bezier_wave: bool,
    pub strategy: SingleSwipeStrategy,
    pub bind: ButtonBinding,
    pub input_binding: InputBinding,
    pub script_hooks: BindMappingScriptHooks,
}

impl From<MappingSwipe> for BindMappingSwipe {
    fn from(value: MappingSwipe) -> Self {
        let strategy = if value.enable_randomization {
            SingleSwipeStrategy::ArcWithCubicEasing
        } else {
            SingleSwipeStrategy::Linear
        };
        Self {
            id: value.id,
            note: value.note,
            pointer_id: value.pointer_id,
            positions: value.positions,
            duration: value.duration,
            enable_randomization: value.enable_randomization,
            bezier_wave: value.bezier_wave,
            strategy,
            bind: value.bind.clone(),
            input_binding: PulseBinding::just_pressed(value.bind).0,
            script_hooks: value.script_hooks.into(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MappingSwipe {
    #[serde(default = "crate::mask::mapping::config::default_mapping_id")]
    pub id: String,
    pub note: String,
    pub pointer_id: u64,
    pub positions: Vec<Position>,
    pub duration: u64,
    #[serde(default)]
    pub enable_randomization: bool,
    /// 简单贝塞尔波动：开启后从起点到终点走一条带单侧波动的曲线轨迹。
    #[serde(default)]
    pub bezier_wave: bool,
    pub bind: ButtonBinding,
    #[serde(default)]
    pub script_hooks: MappingScriptHooks,
}

impl ValidateMappingConfig for MappingSwipe {
    fn validate(&self) -> Result<(), String> {
        if self.positions.is_empty() {
            return Err("Swipe's position list is empty".to_string());
        }
        self.script_hooks.validate()
    }
}

pub fn handle_swipe(
    ineffable: Res<Ineffable>,
    active_mapping: Res<ActiveMappingConfig>,
    cs_tx_res: Res<ChannelSenderCS>,
    script_command_tx: Res<ScriptRuntimeCommandSender>,
    shared_state: Res<ScriptSharedState>,
    mask_size: Res<MaskSize>,
    cursor_pos: Res<CursorPosition>,
    mapping_state: Res<State<MappingState>>,
    cursor_state: Res<State<CursorState>>,
    runtime: ResMut<TokioTasksRuntime>,
) {
    if let Some(active_mapping) = &active_mapping.0 {
        for (action, mapping) in &active_mapping.mappings {
            if action.as_ref().starts_with("Swipe") {
                let mapping = mapping.as_ref_swipe();
                let original_size: Vec2 = active_mapping.original_size.into();
                if ineffable.just_pulsed(action.ineff_pulse()) {
                    let pointer_id = mapping.pointer_id;
                    let points = mapping.positions.clone();
                    let duration = mapping.duration;
                    let bezier_wave = mapping.bezier_wave;
                    let strategy = if mapping.enable_randomization
                        && LocalConfig::get_mapping_randomization_enabled()
                    {
                        mapping.strategy
                    } else {
                        SingleSwipeStrategy::Linear
                    };
                    let hooks = mapping.script_hooks.clone();
                    let exec_ctx = make_mapping_execution_context(
                        &cs_tx_res,
                        &script_command_tx,
                        &shared_state,
                        mapping.id.clone(),
                        original_size,
                        cursor_pos.0,
                        mask_size.0,
                        mapping_state.get() == &MappingState::RawInput,
                        cursor_state.get() == &CursorState::Fps,
                    );
                    runtime.spawn_background_task(move |_ctx| async move {
                        let result = run_with_hooks(hooks, exec_ctx, move |ctx| async move {
                            // 只使用前两个坐标：起点 + 终点（旧的多点配置仅取前两点）。
                            let start: Vec2 = points
                                .first()
                                .copied()
                                .unwrap_or(Position { x: 0, y: 0 })
                                .into();
                            let end: Vec2 = points.get(1).copied().unwrap_or(points[0]).into();
                            ControlMsgHelper::send_touch(
                                &ctx.cs_tx,
                                MotionEventAction::Down,
                                pointer_id,
                                ctx.original_size,
                                start,
                            );
                            if bezier_wave {
                                // 简单贝塞尔波动：二次贝塞尔，控制点在中点法向偏移。
                                let wave_points = build_bezier_wave_points(start, end);
                                let step_wait = if wave_points.len() > 1 {
                                    duration / wave_points.len() as u64
                                } else {
                                    duration
                                };
                                for p in wave_points.into_iter().skip(1) {
                                    ControlMsgHelper::send_touch(
                                        &ctx.cs_tx,
                                        MotionEventAction::Move,
                                        pointer_id,
                                        ctx.original_size,
                                        p,
                                    );
                                    sleep(Duration::from_millis(step_wait)).await;
                                }
                                ControlMsgHelper::send_touch(
                                    &ctx.cs_tx,
                                    MotionEventAction::Move,
                                    pointer_id,
                                    ctx.original_size,
                                    end,
                                );
                                ControlMsgHelper::send_touch(
                                    &ctx.cs_tx,
                                    MotionEventAction::Up,
                                    pointer_id,
                                    ctx.original_size,
                                    end,
                                );
                            } else {
                                let mut cur_pos = start;
                                let next_pos = end;
                                for step in build_single_segment_swipe_intermediate_points(
                                    cur_pos, next_pos, strategy, duration,
                                ) {
                                    ControlMsgHelper::send_touch(
                                        &ctx.cs_tx,
                                        MotionEventAction::Move,
                                        pointer_id,
                                        ctx.original_size,
                                        step.pos,
                                    );
                                    sleep(Duration::from_millis(step.wait_ms)).await;
                                }
                                ControlMsgHelper::send_touch(
                                    &ctx.cs_tx,
                                    MotionEventAction::Move,
                                    pointer_id,
                                    ctx.original_size,
                                    next_pos,
                                );
                                cur_pos = next_pos;
                                ControlMsgHelper::send_touch(
                                    &ctx.cs_tx,
                                    MotionEventAction::Up,
                                    pointer_id,
                                    ctx.original_size,
                                    cur_pos,
                                );
                            }
                            Ok::<(), MappingExecutionError>(())
                        })
                        .await;
                        if let Err(e) = result {
                            log::error!("[Swipe] mapping execution error: {:?}", e);
                        }
                    });
                }
            }
        }
    }
}

/// 从起点到终点生成带简单贝塞尔波动的轨迹点（二次贝塞尔，控制点在中点法向偏移）。
fn build_bezier_wave_points(start: Vec2, end: Vec2) -> Vec<Vec2> {
    let delta = end - start;
    let dist = delta.length();
    if dist <= f32::EPSILON {
        return vec![start];
    }
    let steps = 16;
    let dir = delta / dist;
    let normal = Vec2::new(-dir.y, dir.x);
    // 波动幅度随距离变化（12% 距离，最小 8px），轨迹整体偏向法向一侧。
    let wave_amp = (dist * 0.12).max(8.0);
    let control = start + delta * 0.5 + normal * wave_amp;
    let mut pts = Vec::with_capacity(steps + 1);
    for i in 0..=steps {
        let t = i as f32 / steps as f32;
        let inv = 1.0 - t;
        let q = inv * inv * start + 2.0 * inv * t * control + t * t * end;
        pts.push(q);
    }
    pts
}
