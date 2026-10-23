# A-Health Patient App — Design System

## Direction

Use **Premium Modern Healthcare UI A** with the existing A-Health brand. The
surface should feel polished and warm, with restrained petrol-to-teal gradients,
purposeful Bento-style composition, readable type and familiar Material 3
navigation. Visual treatment must preserve clinical meaning and existing task
behavior.

## Color

The existing brand palette remains the source of truth:

| Token | Hex | Use |
|---|---|---|
| `ink` | `#10241F` | Primary text |
| `inkSoft` | `#4A5F59` | Supporting text |
| `paper` | `#F4F6F2` | Main app surface |
| `paperSunk` | `#E7EBE5` | Quiet secondary surface |
| `line` | `#D2D9D1` | Control and panel outline |
| `petrol` | `#0F4C43` | Primary brand/action color |
| `petrolLift` | `#17685C` | Brand highlight |
| `amber` | `#C2700B` | Attention-needed state |
| `clay` | `#A63D2F` | Problem or urgent state |

The UI adds two supporting tokens for depth, without replacing the palette:
`deepOcean` (`#0B3631`) for the dark end of the aurora and `mintWash`
(`#DCECE5`) for a soft selected/navigation surface. Amber and clay retain their
meaning; do not use them as decoration. The neutral consultation status chip
uses the supplied status label and makes no urgency inference.

## Surfaces and layout

- Use the paper background, white content surfaces and 16 dp card corners.
- Keep one primary aurora feature per screen, paired with compact actions or
  useful rows rather than a wall of identical cards.
- The home page uses a large facility-search feature, then a two-action Bento
  group and visit/service content. Cards and rows navigate to existing screens.
- Use a Material navigation bar below 840 dp and a navigation rail at or above
  840 dp. Keep all five destinations: Nyumbani, Huduma, Rekodi, Ujumbe, Wasifu.
- Constrain wide content to a readable column; allow narrow layouts to scroll.
- Preserve system insets, keyboard behavior, back navigation and dynamic text
  scaling.

## Typography

Use the Flutter Material type scale and the platform system face. The app's
existing body sizes (17 dp large, 16 dp medium, 14 dp small) remain the base;
the V2 theme adds a 28 dp headline and a 16 dp small title. Let text scale with
the user's accessibility settings. Keep labels concise and in the app's
Swahili-first voice. Do not use gradient text, emoji as icons or tiny body copy.

## Motion

Motion is brief and purposeful. The aurora uses a one-time 1100 ms
ease-out-cubic transition; tappable cards and hero actions use subtle press
feedback. All authored motion checks `MediaQuery.disableAnimations` and becomes
static or immediate when reduced motion is requested. Keep essential content
visible throughout; do not animate clinical information into view or make
continuous motion the default.

## Accessibility and clinical clarity

- Keep interactive targets at least 48 dp and use standard Material semantics.
- Give status and alert content a readable text label; do not rely on color or
  icon shape alone.
- Announce notices as live regions and exclude decorative hero shapes from
  screen-reader output.
- Keep body text high-contrast on both paper and gradient surfaces.
- Respect reduced motion, device text scaling, keyboard entry and focus states.
- Keep emergency treatment distinct. Use clay/amber only for their established
  meaning, and present backend status labels without changing them.
