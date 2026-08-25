pub mod basic;
pub mod mapping_label;
pub mod wheel_hud;

use basic::BasicPlugin;
pub use basic::{MaskContentEntity, MaskContentMarker, TITLEBAR_HEIGHT};
use bevy::app::{App, Plugin};

use crate::mask::ui::mapping_label::MappingLabelPlugin;

pub struct UiPlugins;

impl Plugin for UiPlugins {
    fn build(&self, app: &mut App) {
        app.add_plugins((BasicPlugin, MappingLabelPlugin, wheel_hud::WheelHudPlugin));
    }
}
