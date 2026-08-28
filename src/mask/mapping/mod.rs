pub mod binding;
pub mod cast_spell;
pub mod config;
pub mod cursor;
pub mod direction_pad;
pub mod executor;
pub mod fire;
pub mod movement_assist;
pub mod observation;
pub mod quick_switch;
pub mod raw_input;
pub mod script;
pub mod script_helper;
pub mod serde_float;
pub mod swipe;
pub mod tap;
pub mod utils;
pub mod wheel;

use bevy::prelude::*;
use bevy_ineffable::prelude::*;
use rust_i18n::t;

use crate::{
    config::LocalConfig,
    mask::{
        MaskResizeState,
        mapping::{
            config::{
                ActiveMappingConfig, BindMappingConfig, MappingAction, default_mapping_config,
                load_mapping_config, save_mapping_config,
            },
            cursor::cleanup_cursor_capture_on_stop,
            cursor::{CursorFrameSet, CursorPlugins, CursorState},
        },
    },
    utils::relate_to_data_path,
};

#[derive(States, Clone, Copy, Default, Eq, PartialEq, Hash, Debug)]
pub enum MappingState {
    #[default]
    Stop,
    Normal,
    RawInput,
}

/// Deterministic ordering for movement helper mappings.
/// Stealth is evaluated first; DirectionPad/toggle-run runs second so a sprint
/// key (normally Shift) always wins if the exact same key could affect both.
#[derive(SystemSet, Debug, Clone, PartialEq, Eq, Hash)]
enum MovementAssistFrameSet {
    Stealth,
    DirectionPad,
}

pub struct MappingPlugins;

impl Plugin for MappingPlugins {
    fn build(&self, app: &mut App) {
        app.add_plugins((IneffablePlugin, CursorPlugins))
            .insert_state(MappingState::Stop)
            .insert_resource(ActiveMappingConfig(None, String::new()))
            .insert_resource(quick_switch::PendingQuickSwitchLoad::default())
            .register_input_action::<MappingAction>()
            .configure_sets(
                Update,
                (
                    CursorFrameSet::UpdatePosition,
                    CursorFrameSet::HandleMappings,
                    CursorFrameSet::ApplyCapture,
                    CursorFrameSet::SyncVirtualCursor,
                )
                    .chain(),
            )
            .configure_sets(
                Update,
                CursorFrameSet::HandleMappings.run_if(mask_not_resizing),
            )
            .configure_sets(
                Update,
                (
                    MovementAssistFrameSet::Stealth,
                    MovementAssistFrameSet::DirectionPad,
                )
                    .chain(),
            )
            .add_systems(
                Startup,
                (
                    init,
                    movement_assist::movement_assist_init,
                    tap::tap_init,
                    direction_pad::direction_pad_init,
                    fire::fire_init,
                    cast_spell::cast_spell_init,
                    observation::init_observation,
                    raw_input::raw_input_init,
                    script::script_init,
                    wheel::wheel_init,
                ),
            )
            // normal mapping mode
            .add_systems(
                Update,
                quick_switch::handle_mapping_quick_switch.before(CursorFrameSet::HandleMappings),
            )
            .add_systems(
                Update,
                script_helper::handle_script_runtime_commands
                    .in_set(CursorFrameSet::HandleMappings)
                    .run_if(not(in_state(MappingState::Stop))),
            )
            .add_systems(
                Update,
                (
                    tap::handle_single_tap.in_set(MovementAssistFrameSet::Stealth),
                    tap::handle_repeat_tap,
                    tap::handle_repeat_tap_trigger,
                    tap::handle_multiple_tap,
                    swipe::handle_swipe,
                    direction_pad::handle_direction_pad
                        .in_set(MovementAssistFrameSet::DirectionPad),
                    cast_spell::handle_mouse_cast_spell,
                    cast_spell::handle_mouse_cast_spell_trigger,
                    cast_spell::handle_mouse_cast_spell_focus_lost,
                    cast_spell::handle_cancel_cast,
                    cast_spell::handle_pad_cast_spell,
                    cast_spell::handle_pad_cast_spell_trigger,
                    wheel::handle_wheel,
                    wheel::handle_wheel_trigger,
                    wheel::handle_wheel_focus_lost,
                    observation::handle_observation,
                    observation::handle_observation_trigger,
                    observation::handle_observation_focus_lost,
                    fire::handle_fps,
                    // raw_input 仍然在 FPS 模式下转发按键：FPS 模式下也需要把
                    // ESC/TAB 等转发到手机（用于弹出游戏内菜单/暂停等）。raw_input
                    // 只把按键直传给手机，不参与任何映射逻辑，所以不会和 fire /
                    // direction_pad / cast_spell 等摇杆绑定冲突。
                    raw_input::handle_raw_input,
                )
                    .in_set(CursorFrameSet::HandleMappings)
                    .run_if(in_state(MappingState::Normal)),
            )
            .add_systems(
                Update,
                (
                    // fire only works in fps mode
                    (fire::handle_fire, fire::handle_fire_trigger)
                        .run_if(in_state(CursorState::Fps)),
                    script::handle_script,
                    script::handle_script_trigger,
                )
                    .in_set(CursorFrameSet::HandleMappings)
                    .run_if(in_state(MappingState::Normal)),
            )
            // handlers in raw input mode
            .add_systems(
                Update,
                (
                    raw_input::handle_raw_input_trigger,
                    raw_input::handle_exit_raw_input_mode,
                )
                    .in_set(CursorFrameSet::HandleMappings)
                    .run_if(
                        in_state(MappingState::RawInput).and_then(not(in_state(CursorState::Fps))),
                    ),
            )
            .add_systems(
                OnEnter(MappingState::RawInput),
                raw_input::on_enter_raw_input_mode,
            )
            .add_systems(
                OnExit(MappingState::RawInput),
                raw_input::on_exit_raw_input_mode,
            )
            .add_systems(
                OnTransition {
                    exited: MappingState::Normal,
                    entered: MappingState::Stop,
                },
                (
                    tap::cleanup_tap_on_stop,
                    direction_pad::cleanup_direction_pad_on_stop,
                    observation::cleanup_observation_on_stop,
                    cast_spell::cleanup_cast_spell_on_stop,
                    fire::cleanup_fire_on_stop,
                    fire::cleanup_fps_on_stop,
                    script::cleanup_script_on_stop,
                    wheel::cleanup_wheel_on_stop,
                    cleanup_cursor_capture_on_stop,
                )
                    .chain(),
            )
            .add_systems(
                OnTransition {
                    exited: MappingState::RawInput,
                    entered: MappingState::Stop,
                },
                (
                    tap::cleanup_tap_on_stop,
                    direction_pad::cleanup_direction_pad_on_stop,
                    observation::cleanup_observation_on_stop,
                    cast_spell::cleanup_cast_spell_on_stop,
                    fire::cleanup_fire_on_stop,
                    fire::cleanup_fps_on_stop,
                    script::cleanup_script_on_stop,
                    wheel::cleanup_wheel_on_stop,
                    cleanup_cursor_capture_on_stop,
                )
                    .chain(),
            );
    }
}

pub fn mask_not_resizing(resize_state: Res<MaskResizeState>) -> bool {
    !resize_state.active()
}

fn init(mut ineffable: IneffableCommands, mut active_mapping: ResMut<ActiveMappingConfig>) {
    let config = LocalConfig::get();

    let (bind_mapping_config, input_config, file) =
        match load_mapping_config(&config.active_mapping_file) {
            Ok((mapping_config, input_config)) => {
                log::info!(
                    "[Mask] {}: {}",
                    t!("mask.mapping.usingMappingConfig"),
                    config.active_mapping_file,
                );
                (mapping_config, input_config, config.active_mapping_file)
            }
            Err(e) => {
                log::error!("{}", e);
                log::info!(
                    "[Mask] {}: default.json",
                    t!("mask.mapping.useDefaultMapping")
                );
                let default_mapping = default_mapping_config();
                let config_path = relate_to_data_path(["mapping", "default.json"]);
                save_mapping_config(&default_mapping, &config_path).unwrap();
                LocalConfig::set_active_mapping_file("default.json".to_string());
                let default_bind_mapping: BindMappingConfig = default_mapping.into();
                let input_config: InputConfig = InputConfig::from(&default_bind_mapping);
                (
                    default_bind_mapping,
                    input_config,
                    "default.json".to_string(),
                )
            }
        };
    active_mapping.0 = Some(bind_mapping_config);
    active_mapping.1 = file;
    ineffable.set_config(&input_config);
}
