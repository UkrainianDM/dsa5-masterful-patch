/**
 * Masterful Regeneration Module — v1.1.x (LP/AE/KP safe toggles + deterministic regen hard-force)
 * Foundry VTT v13 / DSA5 7.4.6 / Forge
 *
 * Fixes:
 * 1) AE and KP toggles no longer close the dialog when actor has no AE/KP:
 *    - Detects whether AE and KP/KE are present in the regen dialog DOM.
 *    - If absent: corresponding toggle is shown as disabled and click is ignored.
 *    - All toggles stop event propagation in capture phase to avoid form submit/close.
 * 2) Deterministic regen:
 *    - Forces d6 outcomes in regen-submit context by patching multiple dice RNG entry points:
 *        DiceTerm._roll / DiceTerm.roll
 *        Die._roll / Die.roll
 *    - Any d6 encountered during regen context is forced by encounter order: LP -> AE -> KP -> extras.
 */
(() => {
  const LOG_PREFIX = "MASTERFUL |";
  const MASTERFUL = (globalThis.MASTERFUL = globalThis.MASTERFUL ?? {});
  MASTERFUL.state = MASTERFUL.state ?? { lp: true, ae: true, ke: true };
  MASTERFUL._rollContext = MASTERFUL._rollContext ?? { active: false, state: { ...MASTERFUL.state }, dieIndex: 0 };
  MASTERFUL._wrapped = MASTERFUL._wrapped ?? {};
  MASTERFUL._diag = MASTERFUL._diag ?? { enabled: true, maxTracesPerSubmit: 160, traceCountThisSubmit: 0 };

  const RES_ORDER = ["lp", "ae", "ke"];

  const nowISO = () => { try { return new Date().toISOString(); } catch { return String(Date.now()); } };
  const stackTop = (lines = 10) => {
    const s = (new Error()).stack;
    return s ? s.split("\n").slice(0, lines).join("\n") : "(no stack)";
  };

  const diagEnabled = () => !!MASTERFUL._diag?.enabled;
  const inRegenContext = () => !!MASTERFUL._rollContext?.active;
  const canTraceMore = () => (MASTERFUL._diag?.traceCountThisSubmit ?? 0) < (MASTERFUL._diag?.maxTracesPerSubmit ?? 160);
  const bumpTrace = () => { if (MASTERFUL._diag) MASTERFUL._diag.traceCountThisSubmit = (MASTERFUL._diag.traceCountThisSubmit ?? 0) + 1; };
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

  function qsa(root, sel) {
    try { return root?.querySelectorAll?.(sel) ?? []; } catch { return []; }
  }

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
      const hasCampsiteText = text.includes("campsite");
      return hasSelect && hasCampsiteText;
    } catch {
      return false;
    }
  }

  /**
   * Detect whether AE exists in this regen dialog (best-effort).
   */
  function dialogHasAE(root) {
    try {
      if (!root) return false;
      const text = (root.textContent ?? "").toLowerCase();
      // Common labels: AE, AsP, Astral, Astralenergie
      const textHit =
        /\bae\b/.test(text) ||
        text.includes("asp") ||
        text.includes("astral") ||
        text.includes("astralenergie");

      const selectors = [
        'input[name*="ae" i]', 'input[name*="asp" i]', 'input[name*="astral" i]',
        'select[name*="ae" i]', 'select[name*="asp" i]', 'select[name*="astral" i]',
        '[id*="ae" i]', '[id*="asp" i]', '[id*="astral" i]',
        '[class*="ae" i]', '[class*="asp" i]', '[class*="astral" i]',
      ];
      const domHit = selectors.some(sel => qsa(root, sel).length > 0);
      return textHit || domHit;
    } catch {
      return false;
    }
  }

  /**
   * Detect whether KP/KE exists in this regen dialog (best-effort).
   */
  function dialogHasKE(root) {
    try {
      if (!root) return false;
      const text = (root.textContent ?? "").toLowerCase();
      // Common labels: KaP, KP, Karma, KE
      const textHit =
        text.includes("kap") ||
        text.includes("karma") ||
        /\bkp\b/.test(text) ||
        /\bke\b/.test(text);

      const selectors = [
        'input[name*="ke" i]', 'input[name*="kp" i]', 'input[name*="kap" i]', 'input[name*="karma" i]',
        'select[name*="ke" i]', 'select[name*="kp" i]', 'select[name*="kap" i]', 'select[name*="karma" i]',
        '[id*="ke" i]', '[id*="kp" i]', '[id*="kap" i]', '[id*="karma" i]',
        '[class*="ke" i]', '[class*="kp" i]', '[class*="kap" i]', '[class*="karma" i]',
      ];
      const domHit = selectors.some(sel => qsa(root, sel).length > 0);
      return textHit || domHit;
    } catch {
      return false;
    }
  }

  function ensurePanel(html) {
    try {
      const root = toRootElement(html);
      if (!root) {
        if (diagEnabled()) warn("UI panel: no root element (html not HTMLElement/jQuery?)");
        return;
      }
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

      const paintBtn = (btn, enabled, disabled = false) => {
        btn.style.background = disabled
          ? "rgba(120,120,120,0.12)"
          : (enabled ? "rgba(80,160,120,0.25)" : "rgba(160,80,80,0.25)");
        btn.style.opacity = disabled ? "0.55" : "1";
        btn.style.cursor = disabled ? "not-allowed" : "pointer";
      };

      const makeToggle = (key, text, disabled = false) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "masterful-toggle";
        btn.dataset.key = key;
        btn.textContent = `[${text}]`;
        btn.style.padding = "2px 10px";
        btn.style.borderRadius = "6px";
        btn.style.border = "1px solid rgba(255,255,255,0.22)";

        paintBtn(btn, MASTERFUL.state[key], disabled);

        btn.addEventListener("click", (ev) => {
          // Prevent the dialog/form from interpreting the click as submit/close.
          try {
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation?.();
          } catch {}

          if (disabled) {
            if (diagEnabled()) warn("toggle ignored (disabled)", key);
            return;
          }

          MASTERFUL.state[key] = !MASTERFUL.state[key];
          MASTERFUL._rollContext.state = { ...MASTERFUL.state };
          paintBtn(btn, MASTERFUL.state[key], false);
          if (diagEnabled()) log("toggle", key, "=>", MASTERFUL.state[key]);
        }, true); // capture

        return btn;
      };

      wrap.appendChild(makeToggle("lp", "LP", false));
      wrap.appendChild(makeToggle("ae", "AE", !hasAE));
      // Display as KP but keep internal key 'ke'
      wrap.appendChild(makeToggle("ke", "KP", !hasKE));

      const ok = document.createElement("span");
      const notes = [];
      if (!hasAE) notes.push("AE отсутствует");
      if (!hasKE) notes.push("KP отсутствует");
      ok.textContent = notes.length ? notes.join(" · ") : "hook OK";
      ok.style.opacity = "0.7";
      ok.style.marginLeft = "6px";
      wrap.appendChild(ok);

      const form = root.querySelector?.("form");
      if (form?.prepend) {
        form.prepend(wrap);
        if (diagEnabled()) log("UI panel injected into <form>", { hasAE, hasKE });
        return;
      }
      const wc = root.querySelector?.(".window-content");
      if (wc?.prepend) {
        wc.prepend(wrap);
        if (diagEnabled()) log("UI panel injected into .window-content", { hasAE, hasKE });
        return;
      }
      root.prepend?.(wrap);
      if (diagEnabled()) log("UI panel injected into root", { hasAE, hasKE });
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

        if (diagEnabled()) {
          log("submit context ON", {
            at: nowISO(),
            appTitle: app?.title,
            template: app?.options?.template,
            state: MASTERFUL._rollContext.state,
          });
        }

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

  function wrapDeterministicD6() {
    if (MASTERFUL._wrapped.detD6) return;
    MASTERFUL._wrapped.detD6 = true;

    try {
      const DiceTerm = globalThis.foundry?.dice?.terms?.DiceTerm;
      const Die = globalThis.foundry?.dice?.terms?.Die;

      if (!DiceTerm?.prototype) warn("DiceTerm prototype not found");
      if (!Die?.prototype) warn("Die prototype not found");

      const isD6 = (term) => Number(term?.faces) === 6;

      if (DiceTerm?.prototype && typeof DiceTerm.prototype._roll === "function" && !MASTERFUL._wrapped.DiceTerm__roll) {
        const orig = DiceTerm.prototype._roll;
        DiceTerm.prototype._roll = async function (...args) {
          if (diagEnabled() && inRegenContext() && canTraceMore()) { bumpTrace(); log("TRACE DiceTerm._roll", { faces: this?.faces, number: this?.number, stack: stackTop(6) }); }
          if (!inRegenContext() || !isD6(this)) return orig.apply(this, args);
          const { value, key } = nextFixedValueForD6();
          log("FIX DiceTerm._roll", { resource: key, forced: value });
          return value;
        };
        MASTERFUL._wrapped.DiceTerm__roll = true;
      }

      if (DiceTerm?.prototype && typeof DiceTerm.prototype.roll === "function" && !MASTERFUL._wrapped.DiceTerm_roll) {
        const orig = DiceTerm.prototype.roll;
        DiceTerm.prototype.roll = async function (...args) {
          if (diagEnabled() && inRegenContext() && canTraceMore()) { bumpTrace(); log("TRACE DiceTerm.roll", { faces: this?.faces, number: this?.number, stack: stackTop(6) }); }
          if (!inRegenContext() || !isD6(this)) return orig.apply(this, args);
          const { value, key } = nextFixedValueForD6();
          log("FIX DiceTerm.roll", { resource: key, forced: value });
          return { result: value, active: true };
        };
        MASTERFUL._wrapped.DiceTerm_roll = true;
      }

      if (Die?.prototype && typeof Die.prototype._roll === "function" && !MASTERFUL._wrapped.Die__roll) {
        const orig = Die.prototype._roll;
        Die.prototype._roll = async function (...args) {
          if (diagEnabled() && inRegenContext() && canTraceMore()) { bumpTrace(); log("TRACE Die._roll", { faces: this?.faces, number: this?.number, stack: stackTop(6) }); }
          if (!inRegenContext() || !isD6(this)) return orig.apply(this, args);
          const { value, key } = nextFixedValueForD6();
          log("FIX Die._roll", { resource: key, forced: value });
          return value;
        };
        MASTERFUL._wrapped.Die__roll = true;
      }

      if (Die?.prototype && typeof Die.prototype.roll === "function" && !MASTERFUL._wrapped.Die_roll) {
        const orig = Die.prototype.roll;
        Die.prototype.roll = async function (...args) {
          if (diagEnabled() && inRegenContext() && canTraceMore()) { bumpTrace(); log("TRACE Die.roll", { faces: this?.faces, number: this?.number, stack: stackTop(6) }); }
          if (!inRegenContext() || !isD6(this)) return orig.apply(this, args);
          const { value, key } = nextFixedValueForD6();
          log("FIX Die.roll", { resource: key, forced: value });
          return { result: value, active: true };
        };
        MASTERFUL._wrapped.Die_roll = true;
      }

      log("deterministic d6 hooks ready");
    } catch (e) {
      warn("wrapDeterministicD6 failed", e);
    }
  }

  Hooks.once("init", () => {
    if (diagEnabled()) log("init", { at: nowISO() });
    wrapDeterministicD6();
  });

  Hooks.on("renderDSA5Dialog", (app, html) => {
    try {
      if (!looksLikeRegenDialog(app, html)) return;
      if (diagEnabled()) log("regen dialog detected", { at: nowISO(), title: app?.title, template: app?.options?.template });
      ensurePanel(html);
      wrapSubmitOnce(app);
      wrapDeterministicD6();
    } catch (e) {
      warn("render hook failed", e);
    }
  });
})();
