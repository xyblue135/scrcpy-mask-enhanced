use std::str::FromStr;

use bevy::{input::keyboard::KeyCode, prelude::*};
use bevy_ineffable::prelude::IneffableCommands;

use crate::{
    config::LocalConfig,
    mask::mapping::{
        binding::MergedButton,
        config::ActiveMappingConfig,
        preset_override::{LoadedMapping, load_mapping_with_overrides},
    },
    tokio_tasks::TokioTasksRuntime,
};

fn keyboard_shortcut(keys: &[String]) -> Option<Vec<KeyCode>> {
    keys.iter()
        .map(|key| match MergedButton::from_str(key).ok()? {
            MergedButton::Keyboard(key_code) => Some(key_code),
            _ => None,
        })
        .collect()
}

/// 后台异步加载预设的中间状态：避免在 bevy 主线程同步加载配置（读文件 +
/// JSON 解析 + 所有脚本 AST 编译）导致画面卡顿。
#[derive(Resource, Default)]
pub struct PendingQuickSwitchLoad {
    /// true 表示正在后台加载中。
    loading: bool,
    /// 后台加载完成的结果（目标文件, 结果）。
    /// `LoadedMapping` 区分主预设 / 子预设（override）；主线程取出后展开为
    /// 合并后的 BindMappingConfig + InputConfig 应用到 ineffable。
    done: Option<(String, Result<LoadedMapping, String>)>,
}

pub fn handle_mapping_quick_switch(
    mut keys: ResMut<ButtonInput<KeyCode>>,
    mut ineffable: IneffableCommands,
    mut active_mapping: ResMut<ActiveMappingConfig>,
    runtime: ResMut<TokioTasksRuntime>,
    mut pending: ResMut<PendingQuickSwitchLoad>,
) {
    // 1) 应用后台异步加载完成的结果（本步只做赋值，开销极小）。
    if let Some((file, result)) = pending.done.take() {
        pending.loading = false;
        match result {
            Ok(loaded) => {
                let (mapping_config, input_config) = match loaded {
                    LoadedMapping::Base { bind, input } => (bind, input),
                    LoadedMapping::Override { bind, input, parent_file, raw_overrides } => {
                        log::info!(
                            "[Mapping] quick switched to override of '{parent_file}' ({} overrides): {file}",
                            raw_overrides.len()
                        );
                        (bind, input)
                    }
                };
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
        return;
    }

    if pending.loading || !LocalConfig::get_quick_switch_enabled() {
        return;
    }

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

    // 2) 后台线程执行 load_mapping_with_overrides（自动判断主预设/子预设，
    //    子预设时递归加载 parent 并合并 overrides；读文件 / JSON 解析 / 脚本 AST 编译），
    //    完成后回主线程应用，避免阻塞渲染线程导致「按切换键卡顿」。
    pending.loading = true;
    let file_clone = file.clone();
    runtime.spawn_background_task(move |mut ctx| async move {
        let load_file = file_clone.clone();
        let result: Result<LoadedMapping, String> =
            match tokio::task::spawn_blocking(move || load_mapping_with_overrides(&load_file)).await
            {
                Ok(value) => value,
                Err(error) => Err(format!("quick switch task failed: {error}")),
            };
        ctx.run_on_main_thread(move |main_ctx| {
            let mut pending = main_ctx.world.resource_mut::<PendingQuickSwitchLoad>();
            pending.done = Some((file_clone, result));
        })
        .await;
    });
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
