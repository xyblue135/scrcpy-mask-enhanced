use std::collections::HashSet;

use bevy::{ecs::{resource::Resource, system::Commands}, math::Vec2};

use crate::{
    mask::mapping::{
        config::{BindMappingConfig, BindMappingType},
        tap::BindMappingSingleTap,
        utils::{ControlMsgHelper, random_offset_vec2},
    },
    scrcpy::constant::MotionEventAction,
    utils::ChannelSenderCS,
};

/// Shared state for movement-related helper mappings.
///
/// Toggle-run and stealth are intentionally kept in one resource so they can
/// cancel each other deterministically instead of leaving two logical modes
/// active at the same time.
pub fn movement_assist_init(mut commands: Commands) {
    commands.insert_resource(MovementAssistState::default());
}

#[derive(Resource, Default, Debug)]
pub struct MovementAssistState {
    pub toggle_run_actions: HashSet<String>,
    pub stealth_actions: HashSet<String>,
}

pub fn send_stealth_toggle(
    cs_tx: &ChannelSenderCS,
    mapping: &BindMappingSingleTap,
    original_size: Vec2,
) {
    let pos = random_offset_vec2(
        mapping.position.into(),
        Vec2::new(mapping.random_offset_x, mapping.random_offset_y),
    );
    ControlMsgHelper::send_touch(
        &cs_tx.0,
        MotionEventAction::Down,
        mapping.pointer_id,
        original_size,
        pos,
    );
    ControlMsgHelper::send_touch(
        &cs_tx.0,
        MotionEventAction::Up,
        mapping.pointer_id,
        original_size,
        pos,
    );
}

/// Turn off every currently latched stealth mapping by tapping its configured
/// stealth button once more. This is used when toggle-run is activated.
pub fn cancel_all_stealth(
    state: &mut MovementAssistState,
    active_mapping: &BindMappingConfig,
    cs_tx: &ChannelSenderCS,
) {
    if state.stealth_actions.is_empty() {
        return;
    }

    let original_size: Vec2 = active_mapping.original_size.into();
    let active_actions = std::mem::take(&mut state.stealth_actions);
    for action_name in active_actions {
        let Some((_, BindMappingType::SingleTap(mapping))) = active_mapping
            .mappings
            .iter()
            .find(|(action, _)| action.as_ref() == action_name.as_str())
        else {
            continue;
        };
        if mapping.stealth_mode {
            send_stealth_toggle(cs_tx, mapping, original_size);
        }
    }
}
