# Dev DirectionPad toggle-run behavior fix

This rebuild changes only the non-hold sprint cancellation behavior and its UI hint.

## Final behavior

- First press of the configured Up Boost key (for example Shift): latch sprint ON.
- Releasing that first Shift press: sprint stays ON.
- A / D: steer left/right without cancelling sprint.
- S / backward: cancel sprint immediately.
- To cancel by Shift: press Shift again, then sprint turns OFF when that second press is released.
- Enabling stealth still cancels latched sprint, and enabling sprint still cancels stealth.

The second-press/release rule is intentional: cancelling on the first Shift release would turn this mode back into ordinary hold-to-sprint and defeat the purpose of "non-hold sprint".

## Changed files

- `src/mask/mapping/binding.rs`
- `src/mask/mapping/movement_assist.rs`
- `src/mask/mapping/direction_pad.rs`
- `src/mask/mapping/tap.rs`
- `frontend/src/i18n/*/translation.json`
