/**
 * Masterful Regeneration Module — v1.1.x (install timing fix + deterministic regen via Roll internals)
 * Foundry VTT v13 / DSA5 7.4.6 / Forge
 *
 * What was happening:
 * - Your last log shows submit context ON/OFF but traces=0 and no "wrapped" log lines.
 * - That means our wrappers were NOT installed (module loaded after init, or hook missed).
 *
 * This build fixes installation timing:
 * - Installs wrappers immediately on script execution.
 * - Also installs again on Hooks.once('init') and Hooks.once('ready') (idempotent).
 *
 * Deterministic regen approach (regen-submit context only):
 * - Primary: wrap Roll.prototype._evaluateTotal if present.
 *   We force d6 Die.results BEFORE total is calculated and clear roll._total cache.
 * - Fallback: wrap Roll.prototype.evaluate/evaluateSync to clear roll._total and force dice
 *   BEFORE calling original evaluate.
 *
 * Dice forcing rule:
 * - Encountered d6 Die terms in evaluation order map to resources:
 *   1st => LP/LE, 2nd => AE, 3rd => KP/KE, extras => treated as enabled (4)
 * - enabled => 4, disabled => 0
 *
 * UI:
 * - Same stable panel injection (HTMLElement/jQuery).
 * - AE/KP toggles disabled if those resources are not present in the dialog DOM.
 * - All toggles stop event propagation in capture phase.
 */
(() => {
  const LOG_PREFIX = "MASTERFUL |";
  const MASTERFUL = (globalThis.MASTERFUL = globalThis.MASTERFUL ?? {});
  MASTERFUL.state = MASTERFUL.state ?? { lp: true, ae: true, ke: true };
  MASTERFUL._rollContext = MASTERFUL._rollContext ?? { active: false, state: { ...MASTERFUL.state }, dieIndex: 0 };
  MASTERFUL._wrapped = MASTERFUL._wrapped ?? {};
  MASTERFUL._diag = MASTERFUL._diag ?? { enabled: true, maxTracesPerSubmit: 200, traceCountThisSubmit: 0 };

  const RES_ORDER = ["lp", "ae", "ke"];

  const nowISO = () => { try { return new Date().toISOString(); } catch { return String(Date.now()); } };
  const diagEnabled = () => !!MASTERFUL._diag?.enabled;
  const inRegenContext = () => !!MASTERFUL._rollContext?.active;
  const bumpTrace = () => { if (MASTERFUL._diag) MASTERFUL._diag.traceCountThisSubmit = (MASTERFUL._diag.traceCountThisSubmit ?? 0) + 1; };
  const canTraceMore = () => (MASTERFUL._diag?.traceCountThisSubmit ?? 0) < (MASTERFUL._diag?.maxTracesPerSubmit ?? 200);
  const resetTraceBudget = () => { if (MASTERFUL._diag) MASTERFUL._diag.traceCountThisSubmit = 0; MASTERFUL._rollContext.dieIndex = 0; };

  const log = (...a) => { try { console.log(LOG_PREFIX, ...a); } catch {} };
  const warn = (...a) => { try { console.warn(LOG_PREFIX, ...a); } catch {} };
  const err = (...a) => { try { console.error(LOG_PREFIX, ...a); } catch {} };

  function toRootElement(html) {
    try {
      if (!html) return null;
      if (html instanceof HTMLElement) return html;
      if (Array.isArray(html) && html[0] instanceof HTMLElement) return html[0];
      if (html[0] instanceof HTMLElement) return html[0];
      return null;
    } catch { return null; }
  }
  function qsa(root, sel) { try { return root?.querySelectorAll?.(sel) ?? []; } catch { return []; } }

  function looksLikeRegenDialog(app, html) {
    try {
      const title = String(app?.title ?? "").toLowerCase();
      const template = String(app?.options?.template ?? "");
      if (template.includes("regeneration-dialog.hbs")) return true;
      if (title.includes("regeneration")) return true;
      const root = toRootElement(html);
      if (!root) return false;
      const hasSelect = qsa(root, "select").length > 0;
      const text = (root.textContent ?? "").toLowerCase();
      return hasSelect && text.includes("campsite");
    } catch { return false; }
  }

  function dialogHasAE(root) {
    try {
      if (!root) return false;
      const text = (root.textContent ?? "").toLowerCase();
      const textHit = /\bae\b/.test(text) || text.includes("asp") || text.includes("astral") || text.includes("astralenergie");
      const selectors = [
        'input[name*="ae" i]','input[name*="asp" i]','input[name*="astral" i]',
        'select[name*="ae" i]','select[name*="asp" i]','select[name*="astral" i]',
        '[id*="ae" i]','[id*="asp" i]','[id*="astral" i]',
        '[class*="ae" i]','[class*="asp" i]','[class*="astral" i]',
      ];
      return textHit || selectors.some(sel => qsa(root, sel).length > 0);
    } catch { return false; }
  }

  function dialogHasKE(root) {
    try {
      if (!root) return false;
      const text = (root.textContent ?? "").toLowerCase();
      const textHit = text.includes("kap") || text.includes("karma") || /\bkp\b/.test(text) || /\bke\b/.test(text);
      const selectors = [
        'input[name*="ke" i]','input[name*="kp" i]','input[name*="kap" i]','input[name*="karma" i]',
        'select[name*="ke" i]','select[name*="kp" i]','select[name*="kap" i]','select[name*="karma" i]',
        '[id*="ke" i]','[id*="kp" i]','[id*="kap" i]','[id*="karma" i]',
        '[class*="ke" i]','[class*="kp" i]','[class*="kap" i]','[class*="karma" i]',
      ];
      return textHit || selectors.some(sel => qsa(root, sel).length > 0);
    } catch { return false; }
  }

  function ensurePanel(html) {
    try {
      const root = toRootElement(html);
      if (!root) return;
      if (root.querySelector?.(".masterful-reg-panel")) return;

      const hasAE = dialogHasAE(root);
      const hasKE = dialogHasKE(root);

      const wrap = document.createElement("div");
      wrap.className = "masterful-reg-panel";
      wrap.style.display = "flex";
      wrap.style.gap = "8px";
      wrap.style.alignItems = "center";
      wrap.style.padding = "6px 8px";
      wrap.style.marginBottom = "8px";
      wrap.style.border = "1px solid rgba(255,255,255,0.18)";
      wrap.style.borderRadius = "6px";

      const label = document.createElement("div");
      label.textContent = "Masterful:";
      label.style.opacity = "0.85";
      wrap.appendChild(label);

      const paint = (btn, enabled, disabled=false) => {
        btn.style.background = disabled ? "rgba(120,120,120,0.12)" : (enabled ? "rgba(80,160,120,0.25)" : "rgba(160,80,80,0.25)");
        btn.style.opacity = disabled ? "0.55" : "1";
        btn.style.cursor = disabled ? "not-allowed" : "pointer";
      };

      const makeToggle = (key, text, disabled=false) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = `[${text}]`;
        btn.style.padding = "2px 10px";
        btn.style.borderRadius = "6px";
        btn.style.border = "1px solid rgba(255,255,255,0.22)";
        paint(btn, MASTERFUL.state[key], disabled);

        btn.addEventListener("click", (ev) => {
          try { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation?.(); } catch {}
          if (disabled) return;
          MASTERFUL.state[key] = !MASTERFUL.state[key];
          MASTERFUL._rollContext.state = { ...MASTERFUL.state };
          paint(btn, MASTERFUL.state[key], false);
          if (diagEnabled()) log("toggle", key, "=>", MASTERFUL.state[key]);
        }, true);

        return btn;
      };

      wrap.appendChild(makeToggle("lp", "LE", false));
      wrap.appendChild(makeToggle("ae", "AE", !hasAE));
      wrap.appendChild(makeToggle("ke", "KP", !hasKE));

      const note = document.createElement("span");
      const notes = [];
      if (!hasAE) notes.push("AE нет");
      if (!hasKE) notes.push("KP нет");
      note.textContent = notes.length ? notes.join(" · ") : "hook OK";
      note.style.opacity = "0.7";
      note.style.marginLeft = "6px";
      wrap.appendChild(note);

      const form = root.querySelector?.("form");
      if (form?.prepend) form.prepend(wrap);
      else (root.querySelector?.(".window-content") ?? root).prepend?.(wrap);

      if (diagEnabled()) log("UI panel injected", { hasAE, hasKE });
    } catch (e) {
      warn("ensurePanel failed", e);
    }
  }

  function wrapSubmitOnce(app) {
    try {
      if (!app || MASTERFUL._wrapped.submit) return;
      if (typeof app._onSubmit !== "function") return;

      const orig = app._onSubmit.bind(app);
      app._onSubmit = async function (...args) {
        resetTraceBudget();
        MASTERFUL._rollContext.active = true;
        MASTERFUL._rollContext.state = { ...MASTERFUL.state };
        MASTERFUL._rollContext.dieIndex = 0;

        if (diagEnabled()) log("submit context ON", { at: nowISO(), state: MASTERFUL._rollContext.state });

        try {
          return await orig(...args);
        } catch (e) {
          err("submit wrapper suppressed exception", e);
        } finally {
          MASTERFUL._rollContext.active = false;
          if (diagEnabled()) log("submit context OFF", { at: nowISO(), traces: MASTERFUL._diag?.traceCountThisSubmit ?? 0 });
        }
      };

      MASTERFUL._wrapped.submit = true;
      if (diagEnabled()) log("Submit wrapped safely");
    } catch (e) {
      warn("wrapSubmitOnce failed", e);
    }
  }

  function nextFixedValueForD6() {
    const idx = (MASTERFUL._rollContext.dieIndex ?? 0);
    const key = RES_ORDER[idx] ?? null;
    MASTERFUL._rollContext.dieIndex = idx + 1;
    if (!key) return { value: 4, key: "(extra)" };
    const enabled = !!MASTERFUL._rollContext.state?.[key];
    return { value: enabled ? 4 : 0, key };
  }

  function forceDieResults(die, value) {
    try {
      const n = Math.max(1, Number(die?.number ?? 1));
      die.results = Array.from({ length: n }, () => ({ result: value, active: true }));
      if ("_evaluated" in die) die._evaluated = true;
      if ("evaluated" in die) die.evaluated = true;
    } catch {}
  }

  function forceD6TermsInRoll(roll) {
    try {
      const terms = Array.isArray(roll?.terms) ? roll.terms : [];
      for (const t of terms) {
        const isDie = (t?.constructor?.name === "Die") || (Number(t?.faces) > 0 && Array.isArray(t?.results));
        if (!isDie) continue;
        if (Number(t?.faces) !== 6) continue;
        const { value, key } = nextFixedValueForD6();
        forceDieResults(t, value);
        if (diagEnabled()) log("FIX Die term", { resource: key, forced: value });
      }
      try { roll._total = undefined; } catch {}
      try { roll.total = undefined; } catch {}
    } catch (e) {
      warn("forceD6TermsInRoll failed", e);
    }
  }

  function installDeterministicRollWrappers() {
    if (MASTERFUL._wrapped.detInstall) return;
    MASTERFUL._wrapped.detInstall = true;

    const Roll = globalThis.Roll;
    if (!Roll?.prototype) {
      warn("Roll.prototype not available yet; will retry on ready");
      MASTERFUL._wrapped.detInstall = false;
      return;
    }

    const hasEvalTotal = typeof Roll.prototype._evaluateTotal === "function";
    const hasEval = typeof Roll.prototype.evaluate === "function";
    const hasEvalSync = typeof Roll.prototype.evaluateSync === "function";

    log("install wrappers", { hasEvalTotal, hasEval, hasEvalSync });

    // Primary: _evaluateTotal
    if (hasEvalTotal && !MASTERFUL._wrapped.Roll__evaluateTotal) {
      const orig = Roll.prototype._evaluateTotal;
      Roll.prototype._evaluateTotal = function (...args) {
        if (inRegenContext()) {
          if (diagEnabled() && canTraceMore()) { bumpTrace(); log("TRACE Roll._evaluateTotal", { formula: this?.formula, dieIndex: MASTERFUL._rollContext.dieIndex }); }
          forceD6TermsInRoll(this);
        }
        return orig.apply(this, args);
      };
      MASTERFUL._wrapped.Roll__evaluateTotal = true;
      log("wrapped Roll._evaluateTotal");
    }

    // Fallback: evaluate
    if (hasEval && !MASTERFUL._wrapped.Roll_evaluate) {
      const orig = Roll.prototype.evaluate;
      Roll.prototype.evaluate = async function (...args) {
        if (inRegenContext()) {
          if (diagEnabled() && canTraceMore()) { bumpTrace(); log("TRACE Roll.evaluate (pre)", { formula: this?.formula }); }
          forceD6TermsInRoll(this);
        }
        const ret = await orig.apply(this, args);
        if (inRegenContext()) {
          // Some paths set totals after dice; ensure our forced dice still match cached total by clearing cache.
          try { this._total = undefined; } catch {}
        }
        return ret;
      };
      MASTERFUL._wrapped.Roll_evaluate = true;
      log("wrapped Roll.evaluate");
    }

    // Fallback: evaluateSync
    if (hasEvalSync && !MASTERFUL._wrapped.Roll_evaluateSync) {
      const orig = Roll.prototype.evaluateSync;
      Roll.prototype.evaluateSync = function (...args) {
        if (inRegenContext()) {
          if (diagEnabled() && canTraceMore()) { bumpTrace(); log("TRACE Roll.evaluateSync (pre)", { formula: this?.formula }); }
          forceD6TermsInRoll(this);
        }
        const ret = orig.apply(this, args);
        if (inRegenContext()) {
          try { this._total = undefined; } catch {}
        }
        return ret;
      };
      MASTERFUL._wrapped.Roll_evaluateSync = true;
      log("wrapped Roll.evaluateSync");
    }

    log("deterministic roll wrappers ready");
  }

  // Install immediately (critical for Forge/module load timing)
  try { installDeterministicRollWrappers(); } catch (e) { warn("immediate install failed", e); }

  Hooks.once("init", () => {
    try { installDeterministicRollWrappers(); } catch (e) { warn("init install failed", e); }
  });
  Hooks.once("ready", () => {
    try { installDeterministicRollWrappers(); } catch (e) { warn("ready install failed", e); }
  });

  Hooks.on("renderDSA5Dialog", (app, html) => {
    try {
      if (!looksLikeRegenDialog(app, html)) return;
      ensurePanel(html);
      wrapSubmitOnce(app);
      installDeterministicRollWrappers();
    } catch (e) {
      warn("render hook failed", e);
    }
  });
})();
