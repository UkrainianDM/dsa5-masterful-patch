/**
 * Masterful Regeneration Module — v1.1.x (UI fix + deterministic regen)
 * Foundry VTT v13 / DSA5 7.4.6 / Forge
 *
 * Fixes:
 *  - UI panel injection now works whether the hook provides jQuery html or a plain HTMLElement.
 *  - Regen dice forcing is applied to ANY d6 Die term during regen-submit context (number>=1, any modifiers).
 *    Mapping by encountered d6 dice terms order: LP -> AE -> KE -> (extras default enabled=4).
 *
 * Diagnostics:
 *  - Traces Roll.create / Roll.roll / Roll.evaluate / Roll.evaluateSync (if present)
 *  - Traces Die.evaluate / Die.evaluateSync (if present) and logs FIX actions
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
  const stackTop = (lines = 10) => {
    const s = (new Error()).stack;
    return s ? s.split("\n").slice(0, lines).join("\n") : "(no stack)";
  };

  const diagEnabled = () => !!MASTERFUL._diag?.enabled;
  const inRegenContext = () => !!MASTERFUL._rollContext?.active;
  const canTraceMore = () => (MASTERFUL._diag?.traceCountThisSubmit ?? 0) < (MASTERFUL._diag?.maxTracesPerSubmit ?? 80);
  const bumpTrace = () => { if (MASTERFUL._diag) MASTERFUL._diag.traceCountThisSubmit = (MASTERFUL._diag.traceCountThisSubmit ?? 0) + 1; };
  const resetTraceBudget = () => { if (MASTERFUL._diag) MASTERFUL._diag.traceCountThisSubmit = 0; MASTERFUL._rollContext.dieIndex = 0; };

  const log = (...a) => { try { console.log(LOG_PREFIX, ...a); } catch {} };
  const warn = (...a) => { try { console.warn(LOG_PREFIX, ...a); } catch {} };
  const err = (...a) => { try { console.error(LOG_PREFIX, ...a); } catch {} };

  function toRootElement(html) {
    // Foundry hooks sometimes provide jQuery, sometimes HTMLElement.
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
        if (diagEnabled()) warn("UI panel: no root element (html not jQuery/HTMLElement?)");
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

      // Prefer inject into the first <form> in the dialog, else into .window-content, else root.
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

  function forceDieResults(die, value) {
    try {
      const n = Math.max(1, Number(die?.number ?? 1));
      die.results = Array.from({ length: n }, () => ({ result: value, active: true }));
      if ("_evaluated" in die) die._evaluated = true;
      if ("evaluated" in die) die.evaluated = true;
    } catch (e) {
      warn("forceDieResults failed", e);
    }
    return die;
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

  function wrapDiceAndRolls() {
    if (MASTERFUL._wrapped.diceAndRolls) return;
    MASTERFUL._wrapped.diceAndRolls = true;

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

      // Roll.prototype.evaluateSync (if exists)
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

      // Die.evaluate / Die.evaluateSync — enforce deterministic results for ANY d6 during regen context
      const Die = globalThis.foundry?.dice?.terms?.Die;
      if (Die?.prototype && typeof Die.prototype.evaluate === "function" && !MASTERFUL._wrapped.Die_evaluate) {
        const orig = Die.prototype.evaluate;
        Die.prototype.evaluate = async function (...args) {
          const isD6 = this?.faces === 6;
          if (diagEnabled() && inRegenContext() && canTraceMore()) {
            bumpTrace();
            log("TRACE Die.evaluate", { at: nowISO(), faces: this?.faces, number: this?.number, modifiers: this?.modifiers, options: args?.[0], stack: stackTop(10) });
          }
          if (!inRegenContext() || !isD6) return orig.apply(this, args);

          const { value, key } = nextFixedValueForD6();
          if (diagEnabled()) log("FIX Die.evaluate", { resource: key, forced: value });
          forceDieResults(this, value);
          return this; // do not call RNG
        };
        MASTERFUL._wrapped.Die_evaluate = true;
        if (diagEnabled()) log("Die.prototype.evaluate wrapped (diagnostic+fix)");
      }

      if (Die?.prototype && typeof Die.prototype.evaluateSync === "function" && !MASTERFUL._wrapped.Die_evaluateSync) {
        const orig = Die.prototype.evaluateSync;
        Die.prototype.evaluateSync = function (...args) {
          const isD6 = this?.faces === 6;
          if (diagEnabled() && inRegenContext() && canTraceMore()) {
            bumpTrace();
            log("TRACE Die.evaluateSync", { at: nowISO(), faces: this?.faces, number: this?.number, modifiers: this?.modifiers, options: args?.[0], stack: stackTop(10) });
          }
          if (!inRegenContext() || !isD6) return orig.apply(this, args);

          const { value, key } = nextFixedValueForD6();
          if (diagEnabled()) log("FIX Die.evaluateSync", { resource: key, forced: value });
          forceDieResults(this, value);
          return this;
        };
        MASTERFUL._wrapped.Die_evaluateSync = true;
        if (diagEnabled()) log("Die.prototype.evaluateSync wrapped (diagnostic+fix)");
      }

      if (diagEnabled()) log("dice+roll wrappers ready");
    } catch (e) {
      warn("wrapDiceAndRolls failed", e);
    }
  }

  Hooks.once("init", () => {
    if (diagEnabled()) log("init", { at: nowISO() });
    wrapDiceAndRolls();
  });

  Hooks.on("renderDSA5Dialog", (app, html) => {
    try {
      if (!looksLikeRegenDialog(app, html)) return;
      if (diagEnabled()) log("regen dialog detected", { at: nowISO(), title: app?.title, template: app?.options?.template });
      ensurePanel(html);
      wrapSubmitOnce(app);
      wrapDiceAndRolls();
    } catch (e) {
      warn("render hook failed", e);
    }
  });
})();
