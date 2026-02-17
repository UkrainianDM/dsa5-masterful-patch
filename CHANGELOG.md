# Changelog

## v2.1.2

- Fixed: actor detection now works reliably by scanning open application instances (`foundry.applications.instances`, `ui.windows`) to find the actor sheet that triggered the regeneration dialog
- Added `app.object` and `app.document` checks for Foundry document-backed apps

## v2.1.1

- Added bilingual support for ability detection (DE and EN names):
  - "Meisterliche Regeneration" / "Masterful Regeneration" (magische SF) → enables AsP toggle
  - "Stabile Regeneration" / "Stable Regeneration" (karmale SF) → enables KaP toggle
- Improved actor resolution — added `game.user.character` as final fallback
- Diagnostic logging of matched Sonderfertigkeit items for easier troubleshooting

## v2.1.0

- Checkboxes for Meisterliche Regeneration are now **off by default**
- Auto-detection of "Meisterliche Regeneration" special abilities on the actor: toggles for LeP, AsP, and KaP are automatically enabled if the character possesses the corresponding Sonderfertigkeit (Lebensenergie / Astralenergie / Karmaenergie)
- Actor is resolved from the dialog context with fallbacks to ChatMessage speaker and selected token
- Debug logging of detected actor abilities in the browser console

## v2.0.0

- Complete rewrite: replaced form-value manipulation with `Die.prototype.evaluate` interception
- Roll queue built from regeneration checkboxes ensures correct 1d6 → 4 replacement per resource
- Safety timeout (10s) prevents interception from leaking into unrelated rolls
- UI panel with per-resource toggles (LeP / AsP / KaP) injected into the regeneration dialog
- Capture-phase click listener on the Roll button to build the queue before DSA5 handlers fire

## v1.0.0

- Initial release
- Injects Meisterliche Regeneration toggle controls into the DSA5 regeneration dialog
- Replaces 1d6 with fixed result of 4 for selected resources
