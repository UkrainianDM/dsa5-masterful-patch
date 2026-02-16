/**
 * Masterful Regeneration Module — v1.1.x (UI OK + deterministic regen FIXED)
 * Foundry VTT v13 / DSA5 7.4.6 / Forge
 *
 * Why previous "Die.evaluate" forcing did not change outcomes:
 * In Foundry v13 dice are commonly produced via DiceTerm._roll() / DiceTerm.roll(),
 * so overriding Die.evaluate can still allow RNG in the internal fulfillment path.
 *
 * This build forces deterministic regen by overriding DiceTerm._roll (and roll/evaluateSync diagnostics),
 * for ANY d6 term encountered during regen-submit context:
 *   LP -> AE -> KE (by encounter order) => 4 if enabled else 0
 *
 * UI panel is injected reliably for HTMLElement or jQuery html.
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
  const stackTop = (lines = 10) => {
    const s = (new Error()).stack;
    return s ? s.split("\n").slice(0, lines).join("\n") : "(no stack)";
  };

  const diagEnabled = () => !!MASTERFUL._diag?.enabled;
  const inRegenContext = () => !!MASTERFUL._rollContext?.active;
  const canTraceMore = () => (MASTERFUL._diag?.traceCountThisSubmit ?? 0) < (MASTERFUL._diag?.maxTracesPerSubmit ?? 120);
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

  function ensurePanel(html) {
    try {
      const root = toRootElement(html);
      if (!root) {
        if (diagEnabled()) warn("UI panel: no root element (html not HTMLElement/jQuery?)");
        return;
      }
      if (root.querySelector?.(".masterful-reg-panel")) return;

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

      const makeToggle = (key, text) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "masterful-toggle";
        btn.dataset.key = key;
        btn.textContent = `[${text}]`;
        btn.style.padding = "2px 10px";
        btn.style.borderRadius = "6px";
        btn.style.border = "1px solid rgba(255,255,255,0.22)";
        btn.style.cursor = "pointer";

        const paint = () => {
          btn.style.background = MASTERFUL.state[key] ? "rgba(80,160,120,0.25)" : "rgba(160,80,80,0.25)";
        };
        paint();

        btn.addEventListener("click", () => {
          MASTERFUL.state[key] = !MASTERFUL.state[key];
          MASTERFUL._rollContext.state = { ...MASTERFUL.state };
          paint();
          if (diagEnabled()) log("toggle", key, "=>", MASTERFUL.state[key]);
        });
        return btn;
      };

      wrap.appendChild(makeToggle("lp", "LP"));
      wrap.appendChild(makeToggle("ae", "AE"));
      wrap.appendChild(makeToggle("ke", "KE"));

      const ok = document.createElement("span");
      ok.textContent = "hook OK";
      ok.style.opacity = "0.7";
      ok.style.marginLeft = "6px";
      wrap.appendChild(ok);

      const form = root.querySelector?.("form");
      if (form?.prepend) {
        form.prepend(wrap);
        if (diagEnabled()) log("UI panel injected into <form>");
        return;
      }
      const wc = root.querySelector?.(".window-content");
      if (wc?.prepend) {
        wc.prepend(wrap);
        if (diagEnabled()) log("UI panel injected into .window-content");
        return;
      }
      if (root.prepend) root.prepend(wrap);
      if (diagEnabled()) log("UI panel injected into root");
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

  function summarizeTerms(terms) {
    try {
      if (!Array.isArray(terms)) return terms;
      return terms.map(t => {
        if (!t) return t;
        const cls = t.constructor?.name;
        const base = { type: cls };
        if (cls === "Die" || cls === "DiceTerm") {
          base.faces = t.faces;
          base.number = t.number;
          base.modifiers = t.modifiers;
        }
        if ("operator" in t) base.operator = t.operator;
        if ("value" in t) base.value = t.value;
        return base;
      });
    } catch {
      return "(terms unavailable)";
    }
  }

  function wrapRollDiagnostics() {
    if (MASTERFUL._wrapped.rollDiag) return;
    MASTERFUL._wrapped.rollDiag = true;

    try {
      // Roll.evaluate / evaluateSync diagnostics (helps confirm the roll is regen-roll)
      if (globalThis.Roll?.prototype && typeof globalThis.Roll.prototype.evaluate === "function" && !MASTERFUL._wrapped.Roll_evaluate) {
        const orig = globalThis.Roll.prototype.evaluate;
        globalThis.Roll.prototype.evaluate = async function (...args) {
          try {
            if (diagEnabled() && inRegenContext() && canTraceMore()) {
              bumpTrace();
              log("TRACE Roll.evaluate", {
                at: nowISO(),
                formula: this?.formula,
                _formula: this?._formula,
                terms: summarizeTerms(this?.terms),
                options: args?.[0],
                stack: stackTop(10),
              });
            }
          } catch {}
          return orig.apply(this, args);
        };
        MASTERFUL._wrapped.Roll_evaluate = true;
      }

      if (globalThis.Roll?.prototype && typeof globalThis.Roll.prototype.evaluateSync === "function" && !MASTERFUL._wrapped.Roll_evaluateSync) {
        const orig = globalThis.Roll.prototype.evaluateSync;
        globalThis.Roll.prototype.evaluateSync = function (...args) {
          try {
            if (diagEnabled() && inRegenContext() && canTraceMore()) {
              bumpTrace();
              log("TRACE Roll.evaluateSync", {
                at: nowISO(),
                formula: this?.formula,
                _formula: this?._formula,
                terms: summarizeTerms(this?.terms),
                options: args?.[0],
                stack: stackTop(10),
              });
            }
          } catch {}
          return orig.apply(this, args);
        };
        MASTERFUL._wrapped.Roll_evaluateSync = true;
      }
    } catch (e) {
      warn("wrapRollDiagnostics failed", e);
    }
  }

  function wrapDeterministicD6() {
    if (MASTERFUL._wrapped.detD6) return;
    MASTERFUL._wrapped.detD6 = true;

    try {
      const DiceTerm = globalThis.foundry?.dice?.terms?.DiceTerm;
      if (!DiceTerm?.prototype) {
        warn("DiceTerm prototype not found; cannot force d6");
        return;
      }

      // The core RNG path: DiceTerm._roll
      if (typeof DiceTerm.prototype._roll === "function" && !MASTERFUL._wrapped.DiceTerm__roll) {
        const orig = DiceTerm.prototype._roll;
        DiceTerm.prototype._roll = async function (...args) {
          const isD6 = this?.faces === 6;
          if (diagEnabled() && inRegenContext() && canTraceMore()) {
            bumpTrace();
            log("TRACE DiceTerm._roll", {
              at: nowISO(),
              ctor: this?.constructor?.name,
              faces: this?.faces,
              number: this?.number,
              modifiers: this?.modifiers,
              stack: stackTop(10),
            });
          }

          if (!inRegenContext() || !isD6) return orig.apply(this, args);

          const { value, key } = nextFixedValueForD6();
          log("FIX DiceTerm._roll", { resource: key, forced: value });
          return value; // <-- critical: bypass RNG entirely
        };
        MASTERFUL._wrapped.DiceTerm__roll = true;
        log("DiceTerm._roll wrapped (fix)");
      }

      // Also guard DiceTerm.roll (some code calls it directly)
      if (typeof DiceTerm.prototype.roll === "function" && !MASTERFUL._wrapped.DiceTerm_roll) {
        const orig = DiceTerm.prototype.roll;
        DiceTerm.prototype.roll = async function (...args) {
          const isD6 = this?.faces === 6;
          if (diagEnabled() && inRegenContext() && canTraceMore()) {
            bumpTrace();
            log("TRACE DiceTerm.roll", {
              at: nowISO(),
              ctor: this?.constructor?.name,
              faces: this?.faces,
              number: this?.number,
              modifiers: this?.modifiers,
              options: args?.[0],
              stack: stackTop(10),
            });
          }

          if (!inRegenContext() || !isD6) return orig.apply(this, args);

          const { value, key } = nextFixedValueForD6();
          log("FIX DiceTerm.roll", { resource: key, forced: value });

          // Return a DiceTermResult-like object; _evaluate will still manage results array.
          return { result: value, active: true };
        };
        MASTERFUL._wrapped.DiceTerm_roll = true;
        log("DiceTerm.roll wrapped (fix)");
      }
    } catch (e) {
      warn("wrapDeterministicD6 failed", e);
    }
  }

  Hooks.once("init", () => {
    if (diagEnabled()) log("init", { at: nowISO() });
    wrapRollDiagnostics();
    wrapDeterministicD6();
  });

  Hooks.on("renderDSA5Dialog", (app, html) => {
    try {
      if (!looksLikeRegenDialog(app, html)) return;
      if (diagEnabled()) log("regen dialog detected", { at: nowISO(), title: app?.title, template: app?.options?.template });

      ensurePanel(html);
      wrapSubmitOnce(app);
      wrapRollDiagnostics();
      wrapDeterministicD6();
    } catch (e) {
      warn("render hook failed", e);
    }
  });
})();
