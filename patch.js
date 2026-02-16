// patch.js — DSA5 Masterful Regeneration Toggle
// Foundry VTT v13 + DSA5 system 7.4.x
//
// Features (regen dialog only):
// - Adds 3 toggles: LP / AE / KE (default ON)
// - Exclude resource when toggle OFF (sets its formula/value to "0")
// - Replace "1d6" -> "4" for enabled resources
// - No system file modifications
//
// Notes:
// - Regen UI is rendered via DSA5Dialog; template is not exposed in options.
// - Never let exceptions escape handlers (Forge may hard reload).

console.log("DSA5 Masterful Regen | patch.js loaded");

const MASTERFUL = {
  state: new Map(), // dialogId -> { lp, ae, ke }
  _rollContext: { active: false, state: null },
};

function getState(dialogId) {
  if (!MASTERFUL.state.has(dialogId)) {
    MASTERFUL.state.set(dialogId, { lp: true, ae: true, ke: true });
  }
  return MASTERFUL.state.get(dialogId);
}

function replace1d6With4(s) {
  if (typeof s !== "string") return s;
  return s.replace(/\b1d6\b/g, "4");
}

function safeRoot(htmlOrElement) {
  return htmlOrElement?.[0] ?? htmlOrElement;
}

// Soft detector: title OR form signatures
function isRegenDialog(app, root) {
  try {
    const title = (app?.title ?? "").toLowerCase();
    if (title.includes("regeneration")) return true; // "Regeneration check"

    if (!root?.querySelector) return false;

    const hasSelect = !!root.querySelector("select");
    const hasRoll =
      !!root.querySelector('button[name="roll"]') ||
      [...root.querySelectorAll("button")].some(
        (b) => (b.textContent ?? "").trim().toLowerCase() === "roll"
      );

    const txt = (root.textContent ?? "").toLowerCase();
    const hasCampsiteWord = txt.includes("campsite") || txt.includes("camp");

    return hasSelect && hasRoll && hasCampsiteWord;
  } catch {
    return false;
  }
}

// ===== Wrap Roll.evaluate once (context-gated) =====
(function wrapRollEvaluateOnce() {
  if (globalThis.__masterfulRollWrapped) return;
  globalThis.__masterfulRollWrapped = true;

  const orig = Roll.prototype.evaluate;

  Roll.prototype.evaluate = function (...args) {
    try {
      const ctx = MASTERFUL._rollContext;
      const st = ctx?.state;

      // активны только во время submit regen-диалога
      if (!ctx?.active || !st) return orig.apply(this, args);

      // Если все выключены — ничего не трогаем
      if (!st.lp && !st.ae && !st.ke) return orig.apply(this, args);

      if (typeof this.formula === "string" && this.formula.includes("1d6")) {
        // Мы не различаем LP/AE на уровне Roll (DSA5 обычно делает отдельные роллы),
        // поэтому фиксируем любой regen-roll в этом контексте.
        this._formula = this.formula.replace(/\b1d6\b/g, "4");
      }
    } catch (e) {
      console.error("MASTERFUL | Roll.evaluate wrapper error (ignored)", e);
    }

    return orig.apply(this, args);
  };

  console.log("MASTERFUL | Roll.evaluate wrapped safely");
})();

// ===== UI injection =====
function ensureMasterfulUI(app, root) {
  const state = getState(app.id);

  if (root.querySelector(".masterful-regeneration-panel")) return;

  const panel = document.createElement("section");
  panel.className = "masterful-regeneration-panel";
  panel.style.marginTop = "8px";
  panel.style.paddingTop = "6px";
  panel.style.borderTop = "1px solid rgba(0,0,0,0.15)";

  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.gap = "14px";
  row.style.alignItems = "center";
  row.style.flexWrap = "wrap";

  const title = document.createElement("div");
  title.textContent = "Masterful:";
  title.style.fontSize = "12px";
  title.style.opacity = "0.85";
  title.style.marginRight = "4px";
  row.appendChild(title);

  function mkToggle(key, label) {
    const wrap = document.createElement("label");
    wrap.style.display = "inline-flex";
    wrap.style.gap = "6px";
    wrap.style.alignItems = "center";
    wrap.style.fontSize = "12px";
    wrap.style.userSelect = "none";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!state[key];
    cb.dataset.masterfulToggle = key;

    cb.addEventListener("change", () => {
      state[key] = cb.checked;
    });

    const span = document.createElement("span");
    span.textContent = label;

    wrap.appendChild(cb);
    wrap.appendChild(span);
    return wrap;
  }

  row.appendChild(mkToggle("lp", "LP"));
  row.appendChild(mkToggle("ae", "AE"));
  row.appendChild(mkToggle("ke", "KE"));

  const hint = document.createElement("div");
  hint.className = "masterful-marker";
  hint.textContent = "hook OK";
  hint.style.fontSize = "12px";
  hint.style.opacity = "0.65";
  hint.style.marginLeft = "6px";
  row.appendChild(hint);

  panel.appendChild(row);

  const buttons =
    root.querySelector(".dialog-buttons") ||
    root.querySelector("footer") ||
    null;

  if (buttons?.parentElement) buttons.parentElement.insertBefore(panel, buttons);
  else root.appendChild(panel);
}

// ===== Submit wrapper =====
function wrapSubmitOnce(proto) {
  if (!proto || proto.__masterfulWrapped) return;

  const original = proto._onSubmit;
  if (typeof original !== "function") {
    proto.__masterfulWrapped = true;
    console.warn("MASTERFUL | _onSubmit missing on DSA5Dialog prototype");
    return;
  }

  proto.__masterfulWrapped = true;

  proto._onSubmit = async function (...args) {
    let state = null;
    let isRegen = false;

    try {
      const el = safeRoot(this?.element);
      const root = el?.querySelector ? el : null;

      if (root && isRegenDialog(this, root)) {
        isRegen = true;
        state = getState(this.id);

        const form = root.querySelector("form");
        if (form) {
          // named fields if present
          const lp = form.querySelector('[name="lp"]');
          const ae = form.querySelector('[name="ae"]');
          const ke = form.querySelector('[name="ke"]');

          // fallback by position (modifier, LP, AE)
          const inputs = [...form.querySelectorAll('input[type="text"], input[type="number"]')];
          const lpFallback = inputs[1] ?? null;
          const aeFallback = inputs[2] ?? null;

          const lpField = lp ?? lpFallback;
          const aeField = ae ?? aeFallback;

          if (lpField) lpField.value = state.lp ? replace1d6With4(String(lpField.value ?? "")) : "0";
          if (aeField) aeField.value = state.ae ? replace1d6With4(String(aeField.value ?? "")) : "0";
          if (ke) ke.value = state.ke ? replace1d6With4(String(ke.value ?? "")) : "0";

          console.log("MASTERFUL | submit patched values", {
            dialogId: this.id,
            lp: lpField?.value,
            ae: aeField?.value,
            ke: ke?.value,
            state
          });
        }
      }
    } catch (e) {
      console.error("MASTERFUL | submit wrapper error (ignored)", e);
      // даже если тут упало — не включаем контекст и просто отдаём оригиналу
    }

    // Включаем roll-контекст ТОЛЬКО для regen submit и только если state определён
    if (isRegen && state) {
      MASTERFUL._rollContext.active = true;
      MASTERFUL._rollContext.state = state;
    }

    try {
      return await original.apply(this, args);
    } finally {
      if (isRegen && state) {
        MASTERFUL._rollContext.active = false;
        MASTERFUL._rollContext.state = null;
      }
    }
  };

  console.log("MASTERFUL | _onSubmit wrapped safely");
}

// Main render hook
Hooks.on("renderDSA5Dialog", (app, html) => {
  try {
    const root = safeRoot(html);
    if (!root?.querySelector) return;

    wrapSubmitOnce(app?.constructor?.prototype);

    if (!isRegenDialog(app, root)) return;

    ensureMasterfulUI(app, root);
  } catch (e) {
    console.error("MASTERFUL | renderDSA5Dialog error", e);
  }
});
