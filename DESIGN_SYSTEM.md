# Mind Flix Design System

## IPTV foundations

The IPTV interface uses CSS custom properties defined in `src/iptv.css`. Product code must use
semantic tokens instead of introducing new hardcoded variants.

### Color

- `--iptv-color-canvas`: application background.
- `--iptv-color-surface`: elevated panels and menus.
- `--iptv-color-surface-muted`: subtle branded surfaces.
- `--iptv-color-border`: default structural border.
- `--iptv-color-accent`: interactive emphasis.
- `--iptv-color-accent-strong`: active and selected states.
- `--iptv-color-accent-soft`: gradient endpoints and restrained accent metadata.
- `--iptv-color-text`: primary text.
- `--iptv-color-text-muted`: secondary text.
- `--iptv-color-focus`: keyboard focus contrast.

### Spacing and radius

- Spacing: `xs` 4px, `sm` 8px, `md` 12px, `lg` 16px, `xl` 24px, `2xl` 32px.
- Radius: `sm` 8px, `md` 12px, `lg` 16px.

### Layout

- Default header height: 96px.
- Medium/compact header height: 126–132px.
- Catalog sidebar: 220–280px on wide layouts and a single-column flow below 760px.
- Focus uses a high-contrast white and red double ring.

### Typography and density

- Use the native system sans-serif stack for predictable rendering on Linux, Windows and macOS.
- Titles use compact uppercase tracking; metadata and counts use muted text and smaller sizes.
- Movie and series artwork uses a `2:3` ratio. Live-channel artwork uses `16:9`.
- Media grids use responsive columns and preserve consistent gaps rather than stretching artwork.

### Surfaces and artwork

- Authenticated views use a restrained neutral canvas; branded imagery is reserved for sign-in.
- Quick actions use quiet surfaces and borders. Accent glow is reserved for focus and selection.
- Artwork always has a dark placeholder with a title initial while loading or after failure.
- Category counts are supporting metadata and must not compete with category labels.

### Accessibility

- Every interactive element must expose a visible `:focus-visible` state.
- Primary card actions and secondary actions such as Favorite must be separate controls.
- Motion must respect `prefers-reduced-motion`.

### Motion and feedback

- Motion uses `fast` 160ms, `normal` 240ms and `slow` 400ms duration tokens.
- Standard transitions use `--iptv-ease-standard`; continuous animation is limited to active
  loading indicators and skeletons.
- Reduced-motion mode removes spinner rotation and collapses transition durations.
- Progress indicators share one track/fill component and expose determinate ARIA values.
- Empty states use a quiet dashed surface, a concise title and one actionable guidance sentence.
- Artwork remains on its placeholder until the image has loaded, then fades in over 240ms.
