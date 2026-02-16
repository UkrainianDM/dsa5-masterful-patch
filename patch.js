/**
 * Masterful Regeneration Module — v1.1.x (stable UI + deterministic regen via Roll._evaluateTotal)
 * Foundry VTT v13 / DSA5 7.4.6 / Forge
 *
 * Key change (approach reset):
 * - Instead of patching Die/DiceTerm RNG entry points (which may not affect cached Roll totals),
 *   we patch Roll#_evaluateTotal (exists in Foundry v13) to ensure the cached _total is computed
 *   from forced deterministic Die.results.
 *
 * Why this works:
 * - Roll caches its numeric total in _total during evaluation. (Foundry API shows internal _total cache
 *   and private _evaluateTotal method.)  citeturn1view0
 * - If we only modify Die.results AFTER the roll, the cached total can remain "random".
 * - By forcing Die.results BEFORE calling the original _evaluateTotal, we guarantee the cached total
 *   matches our deterministic dice values.
 *
 * Forcing rule (regen-submit context only):
 *   Each encountered d6 Die term (faces===6) in the Roll is mapped by encounter order:
 *     1st d6 => LP/LE
 *     2nd d6 => AE
 *     3rd d6 => KP/KE
 *     extras => treated as enabled => 4
 *   For each resource:
 *     enabled => 4
 *     disabled => 0
 *
 * UI:
 * - Panel injected reliably for HTMLElement or jQuery html.
 * - AE/KP toggles disabled if corresponding resource isn't present in dialog DOM.
 * - All toggles stop propagation in capture phase (prevents dialog closing).
 */
(() => {
  const LOG_PREFIX = "MASTERFUL |";
  const MASTERFUL = (globalThis.MASTERFUL = globalThis.MASTERFUL ?? {});
  MASTERFUL.state = MASTERFUL.state ?? { lp: true, ae: true, ke: true };
  MASTERFUL._rollContext = MASTERFUL._rollContext ?? { active: false, state: { ...MASTERFUL.state }, dieIndex: 0 };
  MASTERFUL._wrapped = MASTERFUL._wrapped ?? {};
  MASTERFUL._diag = MASTERFUL._diag ?? { enabled: true, maxTracesPerSubmit: 80, traceCountThisSubmit: 0 };

  const RES_ORDER = ["lp", "ae", "ke"];

  const nowISO = () => { try { return new Date().toISOString(); } catch { return String(Date.now()); } };
  const diagEnabled = () => !!MASTERFUL._diag?.enabled;
  const inRegenContext = () => !!MASTERFUL._rollContext?.active;
  const bumpTrace = () => { if (MASTERFUL._diag) MASTERFUL._diag.traceCountThisSubmit = (MASTERFUL._diag.traceCountThisSubmit ?? 0) + 1; };
  const canTraceMore = () => (MASTERFUL._diag?.traceCountThisSubmit ?? 0) < (MASTERFUL._diag?.maxTracesPerSubmit ?? 80);
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
          try { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation?.(); } catch {}
          if (disabled) { if (diagEnabled()) warn("toggle ignored (disabled)", key); return; }
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

  function wrapRollEvaluateTotal() {
    if (MASTERFUL._wrapped.Roll_evaluateTotal) return;
    const Roll = globalThis.Roll;
    if (!Roll?.prototype || typeof Roll.prototype._evaluateTotal !== "function") {
      warn("Roll.prototype._evaluateTotal not found; cannot force totals");
      return;
    }

    const orig = Roll.prototype._evaluateTotal;
    Roll.prototype._evaluateTotal = function (...args) {
      try {
        if (diagEnabled() && inRegenContext() && canTraceMore()) {
          bumpTrace();
          log("TRACE Roll._evaluateTotal (pre)", { formula: this?.formula, dieIndex: MASTERFUL._rollContext.dieIndex });
        }

        if (inRegenContext()) {
          // Reset mapping for each roll total computation (regen dialog typically evaluates one roll).
          // But if DSA5 does multiple totals per submit, we still want deterministic stable mapping
          // across terms in the same roll. So: only reset if dieIndex==0 already managed per submit.
          // (No action here.)

          // Force d6 die terms in THIS roll before total is computed.
          const DieClass = globalThis.foundry?.dice?.terms?.Die;
          const terms = Array.isArray(this?.terms) ? this.terms : [];
          for (const t of terms) {
            const isDie = DieClass ? (t instanceof DieClass) : (t?.constructor?.name === "Die");
            if (!isDie) continue;
            if (Number(t?.faces) !== 6) continue;
            const { value, key } = nextFixedValueForD6();
            forceDieResults(t, value);
            if (diagEnabled()) log("FIX term before total", { resource: key, forced: value });
          }

          // Ensure cached total is recomputed from our forced results
          try { this._total = undefined; } catch {}
        }
      } catch (e) {
        warn("Roll._evaluateTotal wrapper pre failed", e);
      }

      const total = orig.apply(this, args);

      try {
        if (diagEnabled() && inRegenContext() && canTraceMore()) {
          bumpTrace();
          log("TRACE Roll._evaluateTotal (post)", { total });
        }
      } catch {}

      return total;
    };

    MASTERFUL._wrapped.Roll_evaluateTotal = true;
    log("Roll._evaluateTotal wrapped (deterministic regen)");
  }

  Hooks.once("init", () => {
    if (diagEnabled()) log("init", { at: nowISO() });
    wrapRollEvaluateTotal();
  });

  Hooks.on("renderDSA5Dialog", (app, html) => {
    try {
      if (!looksLikeRegenDialog(app, html)) return;
      ensurePanel(html);
      wrapSubmitOnce(app);
      wrapRollEvaluateTotal();
    } catch (e) {
      warn("render hook failed", e);
    }
  });
})();
