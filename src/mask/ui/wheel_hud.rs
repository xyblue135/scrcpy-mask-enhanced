use bevy::prelude::*;

use crate::{
    config::LocalConfig,
    mask::{
        mapping::wheel::ActiveWheel,
        ui::basic::MaskContentEntity,
        video::VideoViewport,
    },
};

/// Lightweight runtime HUD for wheel mappings. While a wheel gesture is
/// active, a semi-transparent ring is drawn around the wheel center with a
/// number highlighting the currently snapped sector, giving the user visual
/// feedback instead of relying solely on the game screen.
pub struct WheelHudPlugin;

impl Plugin for WheelHudPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Update, sync_wheel_hud);
    }
}

const HUD_SIZE: f32 = 48.0;

#[derive(Component)]
struct WheelHudMarker;

#[derive(Component)]
struct WheelHudText;

/// Spawn/update the HUD. Runs every frame; spawns the node on demand and
/// despawns it when no wheel is active.
fn sync_wheel_hud(
    mut commands: Commands,
    mask_content: Res<MaskContentEntity>,
    active_wheel: Res<ActiveWheel>,
    viewport: Res<VideoViewport>,
    hud_query: Query<Entity, With<WheelHudMarker>>,
    mut node_query: Query<&mut Node, With<WheelHudMarker>>,
    mut text_query: Query<&mut Text, With<WheelHudText>>,
) {
    let Some(state) = active_wheel.hud_state() else {
        for entity in hud_query.iter() {
            commands.entity(entity).despawn();
        }
        return;
    };

    let opacity = LocalConfig::get().mapping_label_opacity;
    // Screen-space center of the wheel.
    let center = viewport.offset + state.center;
    let sector_text = state
        .current_sector
        .map(|s| format!("{}", s + 1))
        .unwrap_or_else(|| "-".to_string());

    if hud_query.is_empty() {
        commands.entity(mask_content.0).with_children(|parent| {
            parent
                .spawn((
                    WheelHudMarker,
                    Node {
                        position_type: PositionType::Absolute,
                        left: Val::Px(center.x - HUD_SIZE / 2.0),
                        top: Val::Px(center.y - HUD_SIZE / 2.0),
                        width: Val::Px(HUD_SIZE),
                        height: Val::Px(HUD_SIZE),
                        border: UiRect::all(Val::Px(2.0)),
                        border_radius: BorderRadius::all(Val::Percent(50.0)),
                        align_items: AlignItems::Center,
                        justify_content: JustifyContent::Center,
                        display: Display::Flex,
                        ..default()
                    },
                    BorderColor::all(Color::srgba(0.93, 0.72, 0.26, opacity)),
                    BackgroundColor(Color::srgba(0.0, 0.0, 0.0, opacity * 0.6)),
                    ZIndex(99),
                ))
                .with_children(|parent| {
                    parent.spawn((
                        WheelHudText,
                        Text::new(sector_text),
                        TextFont {
                            font_size: FontSize::Px(18.0),
                            ..default()
                        },
                        TextColor(Color::srgba(1.0, 1.0, 1.0, opacity)),
                    ));
                });
        });
        return;
    }

    // Update position and text.
    if let Ok(mut node) = node_query.single_mut() {
        node.left = Val::Px(center.x - HUD_SIZE / 2.0);
        node.top = Val::Px(center.y - HUD_SIZE / 2.0);
    }
    if let Ok(mut text) = text_query.single_mut() {
        text.0 = sector_text;
    }
}
