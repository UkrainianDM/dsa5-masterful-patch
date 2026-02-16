# DSA5 Masterful Regeneration Toggle

Adds a proper Masterful Regeneration toggle to the DSA5 Regeneration dialog.

Tested with:
- Foundry VTT v13
- Das Schwarze Auge (The Dark Eye 5th Edition) system 7.4.x
- The Forge hosting

## What This Module Does

When a character has **Masterful Regeneration**, the standard DSA5 Regeneration dialog gains:

- Separate toggles for:
  - LP
  - AE
  - KE
- Toggles are enabled by default
- Replaces `1d6` with `4` for selected resources
- Only modifies the roll formula (does not override system regeneration logic)

Implementation notes:
- Hooks into `RegenerationDialog`
- Patches only relevant roll formulas
- Leaves all other regeneration modifiers intact

## Why This Module Exists

DSA5 system 7.4.x includes Masterful Regeneration in item data but does not provide:
- A built-in toggle in the regeneration dialog
- Automatic replacement of `1d6` with a fixed value

This module restores that functionality cleanly and minimally.

## Installation

### Option 1 — Install via Manifest URL (Recommended)

In Forge or Foundry:

1. Go to **Install Module**
2. Choose **Manifest URL**
3. Paste this URL:

`https://raw.githubusercontent.com/YOUR_GH_USER/YOUR_REPO/main/module.json`

### Option 2 — Manual ZIP Installation

1. Download the release ZIP from GitHub Releases
2. Extract into:

`Data/modules/`

3. Restart Foundry
4. Enable the module in **Manage Modules**

## Compatibility

- Foundry v13
- DSA5 7.4.x

If DSA5 changes the internal class name of `RegenerationDialog` or the internal roll formula fields, the module may require an update.

## Technical Details

- Hooks into `renderDialog`
- Detects the regeneration dialog via `RegenerationDialog` class name (with a safe fallback)
- Replaces `1d6` with `4` only for selected resource formulas
- Defaults toggles to ON

No system files are modified.

## Known Limitations

- Depends on internal roll formula fields used by DSA5
- Future DSA5 updates may rename internal formula properties
- If that happens, update `getFormulaFields()` in `patch.js`

## License

MIT License

## Author

YOUR_NAME
