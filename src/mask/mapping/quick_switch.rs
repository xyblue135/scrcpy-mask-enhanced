use std::str::FromStr;

use bevy::{input::keyboard::KeyCode, prelude::*};
use bevy_ineffable::prelude::IneffableCommands;

use crate::{
    config::LocalConfig,
    mask::mapping::{
        binding::MergedButton,
        config::{ActiveMappingConfig, load_mapping_config},
    },
};

fn keyboard_shortcut(keys: &[String]) -> Option<Vec<KeyCode>> {
    keys.iter()
        .map(|key| match MergedButton::from_str(key).ok()? {
            MergedButton::Keyboard(key_code) => Some(key_code),
            _ => None,
        })
        .collect()
}

pub fn handle_mapping_quick_switch(
    mut keys: ResMut<ButtonInput<KeyCode>>,
    mut ineffable: IneffableCommands,
    mut active_mapping: ResMut<ActiveMappingConfig>,
) {
    if keys.get_just_pressed().next().is_none() {
        return;
    }

    let matched = LocalConfig::get_mapping_quick_switches()
        .into_iter()
        .filter(|config| config.enabled && !config.shortcut.is_empty())
        .find_map(|config| {
            let shortcut = keyboard_shortcut(&config.shortcut)?;
            let all_pressed = shortcut.iter().all(|key| keys.pressed(*key));
            let triggered = shortcut.iter().any(|key| keys.just_pressed(*key));
            (all_pressed && triggered).then_some((config.file, shortcut))
        });

    let Some((file, shortcut)) = matched else {
        return;
    };

    // Consume the chord before regular mapping handlers run so switching a
    // preset never also triggers an in-game touch bound to the same key.
    for key in shortcut {
        keys.clear_just_pressed(key);
    }

    if active_mapping.1 == file {
        return;
    }

    match load_mapping_config(&file) {
        Ok((mapping_config, input_config)) => {
            ineffable.set_config(&input_config);
            active_mapping.0 = Some(mapping_config);
            active_mapping.1.clone_from(&file);
            LocalConfig::set_active_mapping_file(file.clone());
            log::info!("[Mapping] quick switched active preset: {file}");
        }
        Err(error) => {
            log::error!("[Mapping] failed to quick switch preset {file}: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keyboard_shortcut_rejects_mouse_bindings() {
        assert!(keyboard_shortcut(&["ControlLeft".into(), "F1".into()]).is_some());
        assert!(keyboard_shortcut(&["M-Left".into()]).is_none());
    }
}
