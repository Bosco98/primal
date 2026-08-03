# Design System

## Theme

Sunlit movement playground. A clear cyan sky, crisp white UI surfaces, deep navy type, citrus-yellow energy, coral action feedback, cobalt controls, and fresh green success states. The world uses simple low-poly forms with strong silhouettes and minimal shading so it stays readable during fast movement.

## Color Palette

- Sky: `oklch(0.94 0.08 205)` / `#C9F4FF`
- Surface: `oklch(0.99 0.01 210)` / `#FBFEFF`
- Ink: `oklch(0.24 0.06 255)` / `#12233F`
- Cobalt: `oklch(0.56 0.22 260)` / `#165DFF`
- Citrus: `oklch(0.91 0.18 99)` / `#FFE34D`
- Coral: `oklch(0.69 0.21 28)` / `#FF6655`
- Green: `oklch(0.72 0.18 155)` / `#24C47D`
- Teal: `oklch(0.78 0.13 190)` / `#26C6B8`
- Danger: `oklch(0.61 0.23 25)` / `#E83D4F`

No purple. Semantic hazards are reinforced by shape and labels: orange round logs mean jump, teal overhead gates mean duck, coral solid blocks mean change lane.

## Typography

Use one friendly system sans stack: `Avenir Next`, `Nunito Sans`, `Inter`, `Segoe UI`, sans-serif. Display text is heavy and compact; interface labels are sentence case or short uppercase only when they must be read across a room. Body copy stays at 1.5 line-height and 70ch or less.

## Layout

The title screen is a confident asymmetric hero on wide screens and a single direct column on mobile. During a run, the 3D world owns the viewport; time, score, burn, and gap stay at the top or edges where they remain visible during squats. Controls retain at least 44px targets.

## Components

Buttons use a consistent 12px radius, strong solid fills, and 2px focus rings. Panels use a single crisp navy border or a compact 6px offset shadow, never both. Camera framing uses bold zone fills and plain-language coaching. Summary metrics are grouped by workout meaning rather than displayed as a generic card grid.

## Motion

Gameplay motion is immediate and physical: lane movement settles in 90ms, jumps leave the ground on the first frame, successful clears pulse once, and hits use a short camera nudge. Interface transitions stay within 150–220ms. Reduced motion removes decorative drift, camera roll, and pulses while retaining state changes.

## Three.js Rendering

Use pooled low-poly meshes, shared geometry/materials, instancing for repeated objects, no real-time shadows, no post-processing, and a capped adaptive pixel ratio. MediaPipe responsiveness takes priority over resolution; the renderer may downshift detail during slow frames and recover gradually.
