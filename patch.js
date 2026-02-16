// patch.js — DSA5 Masterful Regeneration Toggle
// Foundry VTT v13 + DSA5 system 7.4.x
//
// What it does (regen dialog only):
// - Adds 3 toggles: LP / AE / KE (default ON)
// - On Roll: replaces "1d6" -> "4" for enabled resources
// - Can optionally exclude a resource by setting its formula to "0" when toggle OFF
// - Does not modify system files

console.log("DSA5 Masterful Regen | patch.js loaded");

const MASTERFUL = {
  REGEN_TEMPLATE: "systems/dsa5/templates/dialog/regeneration-dialog.hbs",
  // dialogId -> state
  state: new Map(),
};

function isRegenDialog(app, root) {
  // 1) самый надёжный индикатор в твоём случае — заголовок окна
  const title = (app?.title ?? "").toLowerCase();
  if (title.includes("regeneration")) return true; // "Regeneration check"

  // 2) запасной вариант на случай локализации: проверяем "сигнатуры" regen-формы
  // (в этом диалоге всегда есть селекты campsite + interruption и кнопка Roll)
  if (!root?.querySelector) return false;

  const hasCampsite =
    !!root.querySelector('select[name="camp"]') ||
    !!root.querySelector('select[name="campsite"]');

  const hasInterruption =
    !!root.querySelector('select[name="interruption"]');

  const hasRollButton =
    !!(root.querySelector('button[name="roll"]') ||
       [...root.querySelectorAll("button")].some(b => (b.textContent ?? "").trim().toLowerCase() === "roll"));

  return hasCampsite && hasInterruption && hasRollButton;
}

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

// Tries to find the 3 numeric/text inputs in the header row:
// [modifier, LP, AE] as seen in your screenshot.
// Returns { modInput, lpInput, aeInput } (some can be null).
function findHeaderInputs(root) {
  // Most DSA dialogs use inputs inside the form.
  const inputs = [...root.querySelectorAll('input[type="text"], input[type="number"]')];

  // Heuristic: in regen dialog the first row has 3 inputs.
  // In your UI: modifier (0) + LP (0) + AE (0)
  const modInput = inputs[0] ?? null;
  const lpInput = inputs[1] ?? null;
  const aeInput = inputs[2] ?? null;

  return { modInput, lpInput, aeInput };
}

function ensureMasterfulUI(app, root) {
  const dialogId = app.id;
  const state = getState(dialogId);

  // Insert once
  if (root.querySelector(".masterful-regeneration-panel")) return;

  const panel = document.createElement("section");
  panel.className = "masterful-regeneration-panel";
  panel.style.marginTop = "8px";
  panel.style.paddingTop = "6px";
  panel.style.borderTop = "1px solid rgba(0,0,0,0.15)";

  // Row container
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

  // Place panel near the bottom but above buttons if possible
  const buttons = root.querySelector(".dialog-buttons") ?? root.querySelector("footer") ?? null;
  if (buttons?.parentElement) {
    buttons.parentElement.insertBefore(panel, buttons);
  } else {
    root.appendChild(panel);
  }
}

// Find the Roll button robustly
function findRollButton(root) {
  return (
    root.querySelector('button[name="roll"]') ||
    [...root.querySelectorAll("button")].find(b => (b.textContent ?? "").trim().toLowerCase() === "roll") ||
    null
  );
}

// We hook once per dialog render, but ensure we only add one click-capture handler per dialog DOM.
function ensureRollInterception(app, root) {
  const rollBtn = findRollButton(root);
  if (!rollBtn) {
    console.warn("MASTERFUL | Roll button not found in regen dialog.");
    return;
  }

  if (rollBtn.dataset.masterfulHooked === "1") return;
  rollBtn.dataset.masterfulHooked = "1";

  // Capture phase to run BEFORE system click handlers
  rollBtn.addEventListener(
    "click",
    () => {
      const state = getState(app.id);
      const { lpInput, aeInput } = findHeaderInputs(root);

      // If a toggle is OFF, we exclude that resource by forcing formula/value to "0".
      // If a toggle is ON, we force "1d6" -> "4" if present.
      //
      // This is intentionally simple and stable: it edits the form fields before DSA reads them.
      if (lpInput) {
        if (state.lp) lpInput.value = replace1d6With4(String(lpInput.value ?? ""));
        else lpInput.value = "0";
      }

      if (aeInput) {
        if (state.ae) aeInput.value = replace1d6With4(String(aeInput.value ?? ""));
        else aeInput.value = "0";
      }

      // KE:
      // В твоём текущем диалоге KE-поля нет (по скрину). Поэтому:
      // - мы показываем toggle KE
      // - но подменить формулу можем только если найдём поле KE в будущем/у гевайтов
      //
      // Когда KE поле появится, мы расширим findHeaderInputs или найдём по name.
      if (state.ke) {
        console.log("MASTERFUL | KE toggle ON (no KE input detected in this dialog layout).");
      }
    },
    { capture: true }
  );
}

// Main hook
Hooks.on("renderDSA5Dialog", (app, html) => {
  try {
    const root = html?.[0] ?? html;
    if (!root?.querySelector) return;

    if (!isRegenDialog(app, root)) return;

    if (!root?.querySelector) return;

    console.log("MASTERFUL | Regen dialog render:", app.id, app.title);

    ensureMasterfulUI(app, root);
    ensureRollInterception(app, root);
  } catch (e) {
    console.error("MASTERFUL | renderDSA5Dialog error", e);
  }
});

// ===== Intercept DSA5Dialog submit for regeneration =====

Hooks.on("renderDSA5Dialog", (app, html) => {
  const root = html?.[0] ?? html;
  if (!root?.querySelector) return;
  if (!isRegenDialog(app, root)) return;

  // перехватываем submit только один раз на экземпляр
  if (app._masterfulWrapped) return;
  app._masterfulWrapped = true;

  const originalSubmit = app._onSubmit?.bind(app);
  if (!originalSubmit) {
    console.warn("MASTERFUL | _onSubmit not found on DSA5Dialog");
    return;
  }

  app._onSubmit = async function (event) {
    const state = MASTERFUL.state.get(app.id) ?? { lp: true, ae: true, ke: true };

    // formData — это то, что реально использует система
    const form = this.element?.querySelector("form");
    const formData = new FormData(form);

    const data = Object.fromEntries(formData.entries());

    // В regen-диалоге DSA5 использует ключи lp, ae и иногда ke
    if (data.lp) {
      if (state.lp) data.lp = replace1d6With4(data.lp);
      else data.lp = "0";
    }

    if (data.ae) {
      if (state.ae) data.ae = replace1d6With4(data.ae);
      else data.ae = "0";
    }

    if (data.ke) {
      if (state.ke) data.ke = replace1d6With4(data.ke);
      else data.ke = "0";
    }

    // Вставляем модифицированные данные обратно в форму
    for (const [key, value] of Object.entries(data)) {
      const input = form.querySelector(`[name="${key}"]`);
      if (input) input.value = value;
    }

    console.log("MASTERFUL | Modified regen data:", data);

    return originalSubmit(event);
  };
});
