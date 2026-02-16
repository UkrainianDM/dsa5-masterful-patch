/**
 * Masterful Regeneration Module — v1.1.x diagnostic + fixed dice (d6 -> 4) + UI panel restore
 * Foundry VTT v13 / DSA5 system 7.4.6 / Forge
 *
 * Changes vs previous diagnostic build:
 *  - UI panel injection made more robust (prepend into <form> or .window-content)
 *  - Regen dice are forced (within regen-submit context):
 *      * enabled resource => each d6 term result becomes 4
 *      * disabled resource => corresponding d6 term result becomes 0
 *    Mapping is by order of encountered d6 dice terms: LP -> AE -> KE.
 *  - Diagnostics preserved: Roll.evaluate/roll/evaluateSync + Die.evaluate/evaluateSync + Roll.create (if used)
 */
(() => {
  const LOG_PREFIX = "MASTERFUL |";
  const MASTERFUL = (globalThis.MASTERFUL = globalThis.MASTERFUL ?? {});
  MASTERFUL.state = MASTERFUL.state ?? { lp: true, ae: true, ke: true };
  MASTERFUL._rollContext = MASTERFUL._rollContext ?? { active: false, state: { ...MASTERFUL.state }, dieIndex: 0 };
  MASTERFUL._wrapped = MASTERFUL._wrapped ?? {};
  MASTERFUL._diag = MASTERFUL._diag ?? { enabled: true, maxTracesPerSubmit: 60, traceCountThisSubmit: 0 };

  const RES_ORDER = ["lp", "ae", "ke"];

  function nowISO() { try { return new Date().toISOString(); } catch { return String(Date.now()); } }
  function stackTop(lines = 10) { const s = (new Error()).stack; return s ? s.split("\n").slice(0, lines).join("\n") : "(no stack)"; }
  function diagEnabled() { return !!MASTERFUL._diag?.enabled; }
  function inRegenContext() { return !!MASTERFUL._rollContext?.active; }
  function canTraceMore() { return (MASTERFUL._diag?.traceCountThisSubmit ?? 0) < (MASTERFUL._diag?.maxTracesPerSubmit ?? 60); }
  function bumpTrace() { if (MASTERFUL._diag) MASTERFUL._diag.traceCountThisSubmit = (MASTERFUL._diag.traceCountThisSubmit ?? 0) + 1; }
  function resetTraceBudget() { if (MASTERFUL._diag) MASTERFUL._diag.traceCountThisSubmit = 0; MASTERFUL._rollContext.dieIndex = 0; }

  function log(...args) { try { console.log(LOG_PREFIX, ...args); } catch {} }
  function warn(...args) { try { console.warn(LOG_PREFIX, ...args); } catch {} }
  function err(...args) { try { console.error(LOG_PREFIX, ...args); } catch {} }

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
        if ("number" in t && cls !== "Die") base.number = t.number;
        return base;
      });
    } catch {
      return "(terms unavailable)";
    }
  }

  function looksLikeRegenDialog(app, html) {
    try {
      const title = String(app?.title ?? "").toLowerCase();
      const template = String(app?.options?.template ?? "");
      if (template.includes("regeneration-dialog.hbs")) return true;
      if (title.includes("regeneration")) return true;
      // fallback DOM heuristics
      const hasSelect = html?.find?.("select")?.length > 0;
      const hasCampsiteText = (html?.text?.() ?? "").toLowerCase().includes("campsite");
      return hasSelect && hasCampsiteText;
    } catch {
      return false;
    }
  }

  function ensurePanel(html) {
    try {
      if (!html?.find) return;
      if (html.find(".masterful-reg-panel").length) return;

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
        btn.style.background = MASTERFUL.state[key] ? "rgba(80,160,120,0.25)" : "rgba(160,80,80,0.25)";
        btn.style.cursor = "pointer";
        btn.addEventListener("click", () => {
          MASTERFUL.state[key] = !MASTERFUL.state[key];
          MASTERFUL._rollContext.state = { ...MASTERFUL.state };
          btn.style.background = MASTERFUL.state[key] ? "rgba(80,160,120,0.25)" : "rgba(160,80,80,0.25)";
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

      // Robust injection:
      // 1) into first <form> (best for dialogs)
      // 2) else into .window-content
      // 3) else at top of root
      const $form = html.find("form").first();
      if ($form?.length) {
        $form.prepend(wrap);
        if (diagEnabled()) log("UI panel injected into <form>");
        return;
      }
      const wc = html.find(".window-content").first();
      if (wc?.length) {
        wc.prepend(wrap);
        if (diagEnabled()) log("UI panel injected into .window-content");
        return;
      }
      const root = html[0];
      if (root?.prepend) root.prepend(wrap);
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

  // Decide fixed value for next encountered d6 term in regen context
  function nextFixedValueForD6() {
    const idx = (MASTERFUL._rollContext.dieIndex ?? 0);
    const key = RES_ORDER[idx] ?? null;
    MASTERFUL._rollContext.dieIndex = idx + 1;

    // If we have more dice than resources, default to enabled behavior (4)
    if (!key) return { value: 4, key: "(extra)" };

    const enabled = !!MASTERFUL._rollContext.state?.[key];
    return { value: enabled ? 4 : 0, key };
  }

  function forceDieResult(die, value) {
    // Die results format: [{result, active, ...}]
    try {
      die.results = [{ result: value, active: true }];
      // Some terms track evaluation state; set if present
      if ("_evaluated" in die) die._evaluated = true;
      if ("evaluated" in die) die.evaluated = true;
      return die;
    } catch (e) {
      warn("forceDieResult failed", e);
      return die;
    }
  }

  function wrapRollDiagnosticsAndFix() {
    if (MASTERFUL._wrapped.rollDiagnostics) return;
    MASTERFUL._wrapped.rollDiagnostics = true;

    try {
      // Roll.create (static), if present
      if (globalThis.Roll && typeof globalThis.Roll.create === "function" && !MASTERFUL._wrapped.Roll_create) {
        const origCreate = globalThis.Roll.create.bind(globalThis.Roll);
        globalThis.Roll.create = function (...args) {
          try {
            if (diagEnabled() && inRegenContext() && canTraceMore()) {
              bumpTrace();
              const [formula, data, options] = args;
              log("TRACE Roll.create", { at: nowISO(), formula, dataKeys: data ? Object.keys(data) : null, options, stack: stackTop(10) });
            }
          } catch {}
          return origCreate(...args);
        };
        MASTERFUL._wrapped.Roll_create = true;
        if (diagEnabled()) log("Roll.create wrapped (diagnostic)");
      }

      // Roll.prototype.roll
      if (globalThis.Roll?.prototype && typeof globalThis.Roll.prototype.roll === "function" && !MASTERFUL._wrapped.Roll_roll) {
        const orig = globalThis.Roll.prototype.roll;
        globalThis.Roll.prototype.roll = async function (...args) {
          try {
            if (diagEnabled() && inRegenContext() && canTraceMore()) {
              bumpTrace();
              log("TRACE Roll.roll", { at: nowISO(), formula: this?.formula, _formula: this?._formula, terms: summarizeTerms(this?.terms), options: args?.[0], stack: stackTop(10) });
            }
          } catch {}
          return orig.apply(this, args);
        };
        MASTERFUL._wrapped.Roll_roll = true;
        if (diagEnabled()) log("Roll.prototype.roll wrapped (diagnostic)");
      }

      // Roll.prototype.evaluate
      if (globalThis.Roll?.prototype && typeof globalThis.Roll.prototype.evaluate === "function" && !MASTERFUL._wrapped.Roll_evaluate) {
        const orig = globalThis.Roll.prototype.evaluate;
        globalThis.Roll.prototype.evaluate = async function (...args) {
          try {
            if (diagEnabled() && inRegenContext() && canTraceMore()) {
              bumpTrace();
              log("TRACE Roll.evaluate", { at: nowISO(), formula: this?.formula, _formula: this?._formula, terms: summarizeTerms(this?.terms), options: args?.[0], stack: stackTop(10) });
            }
          } catch {}
          return orig.apply(this, args);
        };
        MASTERFUL._wrapped.Roll_evaluate = true;
        if (diagEnabled()) log("Roll.prototype.evaluate wrapped (diagnostic)");
      }

      // Roll.prototype.evaluateSync
      if (globalThis.Roll?.prototype && typeof globalThis.Roll.prototype.evaluateSync === "function" && !MASTERFUL._wrapped.Roll_evaluateSync) {
        const orig = globalThis.Roll.prototype.evaluateSync;
        globalThis.Roll.prototype.evaluateSync = function (...args) {
          try {
            if (diagEnabled() && inRegenContext() && canTraceMore()) {
              bumpTrace();
              log("TRACE Roll.evaluateSync", { at: nowISO(), formula: this?.formula, _formula: this?._formula, terms: summarizeTerms(this?.terms), options: args?.[0], stack: stackTop(10) });
            }
          } catch {}
          return orig.apply(this, args);
        };
        MASTERFUL._wrapped.Roll_evaluateSync = true;
        if (diagEnabled()) log("Roll.prototype.evaluateSync wrapped (diagnostic)");
      }

      // Die.evaluate (where dice are actually rolled) — also enforce fixed values in regen context
      const Die = globalThis.foundry?.dice?.terms?.Die;
      if (Die?.prototype && typeof Die.prototype.evaluate === "function" && !MASTERFUL._wrapped.Die_evaluate) {
        const orig = Die.prototype.evaluate;
        Die.prototype.evaluate = async function (...args) {
          const isTarget = inRegenContext() && this?.faces === 6 && this?.number === 1 && Array.isArray(this?.modifiers) && this.modifiers.length === 0;
          if (diagEnabled() && inRegenContext() && canTraceMore()) {
            bumpTrace();
            log("TRACE Die.evaluate", { at: nowISO(), faces: this?.faces, number: this?.number, modifiers: this?.modifiers, options: args?.[0], stack: stackTop(10) });
          }

          if (!isTarget) return orig.apply(this, args);

          const { value, key } = nextFixedValueForD6();
          if (diagEnabled()) log("FIX Die.evaluate", { resource: key, forced: value });

          // Do NOT call original RNG — force deterministic
          forceDieResult(this, value);
          return this;
        };
        MASTERFUL._wrapped.Die_evaluate = true;
        if (diagEnabled()) log("Die.prototype.evaluate wrapped (diagnostic+fix)");
      }

      // Die.evaluateSync — enforce too
      if (Die?.prototype && typeof Die.prototype.evaluateSync === "function" && !MASTERFUL._wrapped.Die_evaluateSync) {
        const orig = Die.prototype.evaluateSync;
        Die.prototype.evaluateSync = function (...args) {
          const isTarget = inRegenContext() && this?.faces === 6 && this?.number === 1 && Array.isArray(this?.modifiers) && this.modifiers.length === 0;
          if (diagEnabled() && inRegenContext() && canTraceMore()) {
            bumpTrace();
            log("TRACE Die.evaluateSync", { at: nowISO(), faces: this?.faces, number: this?.number, modifiers: this?.modifiers, options: args?.[0], stack: stackTop(10) });
          }

          if (!isTarget) return orig.apply(this, args);

          const { value, key } = nextFixedValueForD6();
          if (diagEnabled()) log("FIX Die.evaluateSync", { resource: key, forced: value });

          forceDieResult(this, value);
          return this;
        };
        MASTERFUL._wrapped.Die_evaluateSync = true;
        if (diagEnabled()) log("Die.prototype.evaluateSync wrapped (diagnostic+fix)");
      }

      if (diagEnabled()) log("Roll/Die diagnostics+fix ready");
    } catch (e) {
      warn("wrapRollDiagnosticsAndFix failed", e);
    }
  }

  Hooks.once("init", () => {
    try {
      if (diagEnabled()) log("init", { at: nowISO() });
      wrapRollDiagnosticsAndFix();
    } catch (e) {
      warn("init failed", e);
    }
  });

  Hooks.on("renderDSA5Dialog", (app, html) => {
    try {
      if (!looksLikeRegenDialog(app, html)) return;

      if (diagEnabled()) log("regen dialog detected", { at: nowISO(), title: app?.title, template: app?.options?.template });

      ensurePanel(html);
      wrapSubmitOnce(app);
      wrapRollDiagnosticsAndFix();
    } catch (e) {
      warn("render hook failed", e);
    }
  });
})();
