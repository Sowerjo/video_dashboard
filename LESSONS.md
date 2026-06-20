# Design lessons

## IPTV

- Never show a credential-bearing playlist URL while a request is processing.
- Fixed headers, sidebars and footers must be designed as one layout system; independent fixed
  positioning causes overlap at short window heights.
- The Home screen should expose personalized content before repeating navigation already present
  in the header.
- A clickable card containing a Favorite control needs separate semantic actions; nested
  interactive controls are not acceptable.
- Responsive behavior cannot be maintained reliably in large inline-style objects. Structural
  rules belong in the scoped IPTV stylesheet and must use design tokens.
- A transparent loading image can still paint an implementation-defined pixel over the intended
  placeholder. Keep the observer on the artwork wrapper and render the image only for a real source.
- Branded photography is useful at sign-in but reduces catalog legibility once the user is browsing.
- Poster and landscape content need distinct aspect-ratio contracts; one generic card ratio causes
  inconsistent grids and distorted artwork.
- Large category counts should remain visually subordinate to labels, especially in dense sidebars.
- Animation names must be backed by scoped keyframes; a declared animation with no keyframes creates
  inconsistent first-render states and undermines loading feedback.
- Keep image placeholders visible until `onLoad`, then reveal artwork with a short opacity transition.
- Empty states should explain the next useful action; raw debug counts do not belong in user-facing UI.
- Loading indicators, progress bars and errors need shared components so the same operation does not
  appear visually unrelated across login, settings, catalog processing and playback.
