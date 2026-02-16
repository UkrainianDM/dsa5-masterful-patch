/**
 * DSA5 Masterful Regeneration Toggle — v1.1.0
 * Foundry v13, DSA5 7.4.x
 *
 * - Adds toggles for LP / AE / KE to the Regeneration dialog
 * - Defaults ON
 * - Detects dialog by class (RegenerationDialog), with safe fallbacks
 * - Replaces 1d6 -> 4 only for selected resources (when per-resource formulas exist)
 */

const MOD = {
  fixed: 4,
  dieRe: /\b1d6\b/g,
  ui: {
    id: "dsa5-masterful-regeneration",
    css: "dsa5-masterful-regeneration",
    label: "Masterful Regeneration (take 4 instead of 1d6)",
    lp: "LP",
    ae: "AE",
    ke: "KE"
  }
};

function hasMasterful(actor) {
  if (!actor?.items) return false;
  return actor.items.some(i => (i?.name ?? "").toLowerCase().includes("masterful regeneration"));
}

/**
 * Identify the DSA5 regeneration dialog by class name primarily.
 * Fallbacks:
 * - app.object exists and has rollFormula-ish fields
 * - dialog contains Campsite/Interruption selects typical for regen
 */
function isRegenerationDialog(app, html) {
  const cname = app?.object?.constructor?.name ?? app?.constructor?.name ?? "";
  if (cname === "RegenerationDialog") return true;

  // Fallback 1: object has typical formula fields
  const o = app?.object;
  if (o && typeof o === "object") {
    const keys = Object.keys(o);
    const hasFormula = keys.some(k => /rollformula/i.test(k));
    const hasDie = keys.some(k => typeof o[k] === "string" && MOD.dieRe.test(o[k]));
    if (hasFormula && hasDie) return true;
  }

  // Fallback 2: UI has Campsite & Interruption selects typical to DSA5 regen
  const hasCampsite = html.find('select[name="campsite"]').length > 0;
  const hasInterruption = html.find('select[name="interruption"]').length > 0;
  const hasBad = html.find('input[name="bad"]').length > 0;
  return hasCampsite && hasInterruption && hasBad;
}

/**
 * Try to find per-resource roll formula fields on the dialog object.
 * Different versions may name these differently; we support several common patterns.
 */
function getFormulaFields(obj) {
  if (!obj) return {};

  const candidates = [
    // likely patterns
    { key: "rollFormulaLP", type: "lp" },
    { key: "rollFormulaLeP", type: "lp" },
    { key: "rollFormulaLe", type: "lp" },

    { key: "rollFormulaAE", type: "ae" },
    { key: "rollFormulaAsP", type: "ae" },
    { key: "rollFormulaAs", type: "ae" },

    { key: "rollFormulaKE", type: "ke" },
    { key: "rollFormulaKaP", type: "ke" },
    { key: "rollFormulaKa", type: "ke" },

    // generic single formula
    { key: "rollFormula", type: "any" }
  ];

  const found = {};
  for (const c of candidates) {
    if (typeof obj[c.key] === "string" && obj[c.key].match(MOD.dieRe)) {
      found[c.type] ??= [];
      found[c.type].push(c.key);
    }
  }
  return found;
}

function applyMasterfulToFormulas(obj, toggles) {
  const fields = getFormulaFields(obj);

  // If we have dedicated fields for LP/AE/KE, patch only those selected.
  const patched = [];

  const patchKeys = (keys) => {
    for (const k of keys) {
      const before = obj[k];
      const after = before.replace(MOD.dieRe, String(MOD.fixed));
      if (after !== before) {
        obj[k] = after;
        patched.push(k);
      }
    }
  };

  const hasDedicated =
    (fields.lp && fields.lp.length) ||
    (fields.ae && fields.ae.length) ||
    (fields.ke && fields.ke.length);

  if (hasDedicated) {
    if (toggles.lp && fields.lp) patchKeys(fields.lp);
    if (toggles.ae && fields.ae) patchKeys(fields.ae);
    if (toggles.ke && fields.ke) patchKeys(fields.ke);
    return patched;
  }

  // Otherwise fallback: only patch the generic formula if at least one toggle is enabled.
  if ((toggles.lp || toggles.ae || toggles.ke) && fields.any && fields.any.length) {
    patchKeys(fields.any);
  }

  return patched;
}

Hooks.on("renderDialog", (app, html) => {
  try {
    // Must have actor in options (DSA5 passes it for regen)
    const actor = app?.options?.actor;
    if (!actor) return;

    // Must be regen dialog (class-based + safe fallbacks)
    if (!isRegenerationDialog(app, html)) return;

    // Must have Masterful Regeneration on actor
    if (!hasMasterful(actor)) return;

    const form = html.find("form");
    if (!form.length) return;

    // Avoid double-inject
    if (form.find(`.${MOD.ui.css}`).length) return;

    // Add UI block (defaults ON)
    const block = $(`
      <fieldset class="${MOD.ui.css}" style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(0,0,0,.15);">
        <legend style="font-weight:600; padding:0 6px;">${MOD.ui.label}</legend>
        <div class="form-group" style="display:flex; gap:14px; align-items:center; flex-wrap:wrap;">
          <label style="display:flex; gap:6px; align-items:center; margin:0;">
            <input type="checkbox" name="${MOD.ui.id}-lp" checked />
            ${MOD.ui.lp}
          </label>
          <label style="display:flex; gap:6px; align-items:center; margin:0;">
            <input type="checkbox" name="${MOD.ui.id}-ae" checked />
            ${MOD.ui.ae}
          </label>
          <label style="display:flex; gap:6px; align-items:center; margin:0;">
            <input type="checkbox" name="${MOD.ui.id}-ke" checked />
            ${MOD.ui.ke}
          </label>
        </div>
      </fieldset>
    `);

    // Append near the end of form (won’t break layout)
    form.append(block);

    // Intercept Roll button (DSA5 uses a named roll button in this dialog)
    // Be careful not to break other click handlers.
    const rollBtn = html.find('button[name="roll"], button:contains("Roll")').first();
    if (!rollBtn.length) return;

    rollBtn.off(`click.${MOD.ui.id}`).on(`click.${MOD.ui.id}`, () => {
      const toggles = {
        lp: form.find(`input[name="${MOD.ui.id}-lp"]`).is(":checked"),
        ae: form.find(`input[name="${MOD.ui.id}-ae"]`).is(":checked"),
        ke: form.find(`input[name="${MOD.ui.id}-ke"]`).is(":checked")
      };

      // Patch formulas right before the system does its roll computation
      const patched = applyMasterfulToFormulas(app.object, toggles);

      // Optional: console trace for debugging
      // console.log("[Masterful Regen] toggles", toggles, "patched fields", patched);
    });

  } catch (e) {
    console.error("[DSA5 Masterful Regeneration Toggle] error", e);
  }
});

// ===== MASTERFUL DEBUG: detect DSA5 regeneration dialog by template =====
const REGEN_TEMPLATE = "systems/dsa5/templates/dialog/regeneration-dialog.hbs";

function isRegenApp(app) {
  const tpl = app?.options?.template ?? app?._options?.template ?? "";
  return tpl === REGEN_TEMPLATE;
}

Hooks.on("renderApplication", (app, html) => {
  if (!isRegenApp(app)) return;

  console.log("MASTERFUL | Regen renderApplication hit:", app.constructor?.name, app);

  const root = html?.[0] ?? html;
  const title = root?.querySelector?.(".window-title");
  if (title) title.textContent = `${title.textContent} (masterful hook OK)`;
});

Hooks.on("renderApplicationV2", (app, html) => {
  if (!isRegenApp(app)) return;

  console.log("MASTERFUL | Regen renderApplicationV2 hit:", app.constructor?.name, app);

  const root = html?.[0] ?? html;
  const title = root?.querySelector?.(".window-title");
  if (title) title.textContent = `${title.textContent} (masterful hook OK)`;
});
