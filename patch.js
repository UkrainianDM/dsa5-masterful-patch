/**
 * Masterful Regeneration Module — v1.1.x (stable toggles + stable deterministic regen)
 * Foundry VTT v13 / DSA5 7.4.6 / Forge
 *
 * Fix 1: Toggle buttons never submit/close dialogs.
 *  - All toggles stop propagation in capture phase.
 *  - AE/KP toggles are disabled if those resources are not present in the dialog.
 *
 * Fix 2: Deterministic regeneration without breaking DSA5 expectations.
 *  - We DO NOT replace Die.roll return type anymore (previously caused TypeError in DSA5).
 *  - Instead, we call the original method, then overwrite the resulting Die.results with fixed values.
 *  - This preserves Foundry's expected return values and DSA5's consumption of results.
 *
 * Forcing rule (regen-submit context only):
 *   Encountered d6 dice terms: LP -> AE -> KP/KE -> extras
 *     enabled => 4
 *     disabled => 0
 */
(() => {
  const LOG_PREFIX = "MASTERFUL |";
  const MASTERFUL = (globalThis.MASTERFUL = globalThis.MASTERFUL ?? {});
  MASTERFUL.state = MASTERFUL.state ?? { lp: true, ae: true, ke: true };
  MASTERFUL._rollContext = MASTERFUL._rollContext ?? { active: false, state: { ...MASTERFUL.state }, dieIndex: 0 };
  MASTERFUL._wrapped = MASTERFUL._wrapped ?? {};
  MASTERFUL._diag = MASTERFUL._diag ?? { enabled: true, maxTracesPerSubmit: 120, traceCountThisSubmit: 0 };

  const RES_ORDER = ["lp", "ae", "ke"];

  const nowISO = () => { try { return new Date().toISOString(); } catch { return String(Date.now()); } };
  const diagEnabled = () => !!MASTERFUL._diag?.enabled;
  const inRegenContext = () => !!MASTERFUL._rollContext?.active;
  const bumpTrace = () => { if (MASTERFUL._diag) MASTERFUL._diag.traceCountThisSubmit = (MASTERFUL._diag.traceCountThisSubmit ?? 0) + 1; };
  const canTraceMore = () => (MASTERFUL._diag?.traceCountThisSubmit ?? 0) < (MASTERFUL._diag?.maxTracesPerSubmit ?? 120);
  const resetTraceBudget = () => { if (MASTERFUL._diag) MASTERFUL._diag.traceCountThisSubmit = 0; MASTERFUL._rollContext.dieIndex = 0; };

  const log = (...a) => { try { console.log(LOG_PREFIX, ...a); } catch {} };
  const warn = (...a) => { try { console.warn(LOG_PREFIX, ...a); } catch {} };
  const err = (...a) => { try { console.error(LOG_PREFIX, ...a); } catch {} };

  function toRootElement(html) {
    try {
      if (!html) return null;
      if (html instanceof HTMLElement) return html;
      if (Array.isArray(html) && html[0] instanceof HTMLElement) return html[0];
      if (html[0] instanceof HTMLElement) return html[0]; // jQuery-like
      return null;
    } catch {
      return null;
    }
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
    } catch {
      return false;
    }
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
      const domHit = selectors.some(sel => qsa(root, sel).length > 0);
      return textHit || domHit;
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
      const domHit = selectors.some(sel => qsa(root, sel).length > 0);
      return textHit || domHit;
    } catch { return false; }
  }

  function ensurePanel(html) {
    try {
      const root = toRootElement(html);
      if (!root) { if (diagEnabled()) warn("UI panel: no root element"); return; }
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
          // prevent any dialog/form submit/close
          try { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation?.(); } catch {}
          if (disabled) { if (diagEnabled()) warn("toggle ignored (disabled)", key); return; }
          MASTERFUL.state[key] = !MASTERFUL.state[key];
          MASTERFUL._rollContext.state = { ...MASTERFUL.state };
          paint(btn, MASTERFUL.state[key], false);
          if (diagEnabled()) log("toggle", key, "=>", MASTERFUL.state[key]);
        }, true);

        return btn;
      };

      wrap.appendChild(makeToggle("lp", "LE", false));          // display LE/LP label per your UI wording need
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

  function wrapDeterministicD6Stable() {
    if (MASTERFUL._wrapped.detD6Stable) return;
    MASTERFUL._wrapped.detD6Stable = true;

    try {
      const Die = globalThis.foundry?.dice?.terms?.Die;
      if (!Die?.prototype || typeof Die.prototype.roll !== "function") {
        warn("Die.prototype.roll not found; cannot force d6");
        return;
      }

      const origRoll = Die.prototype.roll;
      Die.prototype.roll = async function (...args) {
        const isD6 = Number(this?.faces) === 6;
        if (diagEnabled() && inRegenContext() && isD6 && canTraceMore()) { bumpTrace(); log("TRACE Die.roll (pre)", { faces: this?.faces, number: this?.number }); }

        // Always let Foundry do its normal bookkeeping, THEN overwrite results.
        const ret = await origRoll.apply(this, args);

        if (inRegenContext() && isD6) {
          const { value, key } = nextFixedValueForD6();
          forceDieResults(this, value);
          log("FIX Die.roll (post)", { resource: key, forced: value });
        }

        return ret;
      };

      // If sync path exists, patch similarly
      if (typeof Die.prototype.rollSync === "function" && !MASTERFUL._wrapped.Die_rollSync) {
        const origRollSync = Die.prototype.rollSync;
        Die.prototype.rollSync = function (...args) {
          const isD6 = Number(this?.faces) === 6;
          const ret = origRollSync.apply(this, args);
          if (inRegenContext() && isD6) {
            const { value, key } = nextFixedValueForD6();
            forceDieResults(this, value);
            log("FIX Die.rollSync (post)", { resource: key, forced: value });
          }
          return ret;
        };
        MASTERFUL._wrapped.Die_rollSync = true;
      }

      if (diagEnabled()) log("Deterministic d6 patch installed (stable)");
    } catch (e) {
      warn("wrapDeterministicD6Stable failed", e);
    }
  }

  Hooks.once("init", () => {
    if (diagEnabled()) log("init", { at: nowISO() });
    wrapDeterministicD6Stable();
  });

  Hooks.on("renderDSA5Dialog", (app, html) => {
    try {
      if (!looksLikeRegenDialog(app, html)) return;
      ensurePanel(html);
      wrapSubmitOnce(app);
      wrapDeterministicD6Stable();
    } catch (e) {
      warn("render hook failed", e);
    }
  });
})();
