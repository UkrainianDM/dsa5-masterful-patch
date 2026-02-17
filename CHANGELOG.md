# Changelog

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
