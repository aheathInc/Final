# Reference-led login layout

Operate mode. User supplied reference.png and then explicitly said: do not change colors, change design only. Reproduce the interface composition inside the pictured phone: header with underlined page heading, continuous form surface with rounded top corners, centered identity/welcome, outlined fields, prominent primary action and quiet footer. Do not reproduce the poster/phone hardware or HESLB/government marks; use A-Health identity.

All colors must come from existing AppPalette petrol/mint/paper and appearance roles in apps/patient-mobile/lib/core/theme.dart. No blue recoloring. Respect system light/dark appearance. Reference font sizes are adapted for accessible native phone use. Geometry is Flutter-native; no new bitmap asset or competing design world.

Keep existing behavior: known account has password only; default unlinked device has no phone field, with explicit link/register routes. No switch/forget action. Primary login says Ingia with its icon. Password visibility, OTP recovery, busy/error states and authentication requests are preserved. Back remains native. Width is constrained on large surfaces, and content scrolls with keyboard/large text.

Primary source: apps/patient-mobile/lib/screens/login_screen.dart and lib/widgets/login_shell.dart. Product/design context is apps/patient-mobile/{PRODUCT,DESIGN}.md (not the workspace root). Native evidence native/*.png comes from current source on physical Pixel 4, using integration_test/login_label_preview.dart with synthetic secure storage/intercepted requests. The original device preferences were night=yes and font_scale=0.85; test changes must be restored. No real account data is modified. Six targeted Flutter regressions include 320x640, 1.3 text scaling and keyboard insets.

This is a precise reference-led layout adaptation within the established identity. No concept lottery, generated comp, web detector, global palette replacement or broad audit. Review supplied reference/native captures and sources only; no edits or new rendering in finish review.
