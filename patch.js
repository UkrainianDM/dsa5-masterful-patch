/**
 * Masterful Regeneration Module — diagnostics build (no behavior changes beyond logging)
 * Foundry VTT v13 / DSA5 system 7.4.6
 *
 * What this adds:
 * - Deep tracing for regen context only:
 *   - Roll.create
 *   - Roll.prototype.roll
 *   - Roll.prototype.evaluate
 *   - Roll.prototype.evaluateSync (if present)
 *   - foundry.dice.terms.Die.prototype.evaluate (and evaluateSync if present)
 *
 * NOTE: This file intentionally keeps your current functional logic as-is.
 * It only adds logging and widens interception points for diagnosis.
 */
(() => {
  const MODULE_NS = "MASTERFUL";
  const LOG_PREFIX = "MASTERFUL |";

  // --- global state (preserve if already present) ---
  const MASTERFUL = (globalThis.MASTERFUL = globalThis.MASTERFUL ?? {});
  MASTERFUL.state = MASTERFUL.state ?? { lp: true, ae: true, ke: true };
  MASTERFUL._rollContext = MASTERFUL._rollContext ?? { active: false, state: { ...MASTERFUL.state } };
  MASTERFUL._wrapped = MASTERFUL._wrapped ?? {};
  MASTERFUL._diag = MASTERFUL._diag ?? {
    enabled: true,
    // safety: prevents console spam if regen triggers many sub-rolls
    maxTracesPerSubmit: 50,
    traceCountThisSubmit: 0,
    lastSubmitAt: 0,
  };

  function nowISO() {
    try { return new Date().toISOString(); } catch { return String(Date.now()); }
  }

  function safeStringify(obj) {
    try {
      return JSON.stringify(obj, (k, v) => {
        if (v instanceof Map) return { __map__: Array.from(v.entries()) };
        if (v instanceof Set) return { __set__: Array.from(v.values()) };
        if (typeof v === "bigint") return v.toString();
        return v;
      });
    } catch (e) {
      return String(obj);
    }
  }

  function stackTop(lines = 10) {
    const s = (new Error()).stack;
    if (!s) return "(no stack)";
    return s.split("\n").slice(0, lines).join("\n");
  }

  function diagEnabled() {
    return !!MASTERFUL._diag?.enabled;
  }

  function inRegenContext() {
    return !!MASTERFUL._rollContext?.active;
  }

  function canTraceMore() {
    const d = MASTERFUL._diag;
    if (!d) return true;
    return d.traceCountThisSubmit < d.maxTracesPerSubmit;
  }

  function bumpTrace() {
    const d = MASTERFUL._diag;
    if (!d) return;
    d.traceCountThisSubmit += 1;
  }

  function resetTraceBudget() {
    const d = MASTERFUL._diag;
    if (!d) return;
    d.traceCountThisSubmit = 0;
    d.lastSubmitAt = Date.now();
  }

  function log(...args) {
    // Keep your style; do not throw if console is missing
    try { console.log(LOG_PREFIX, ...args); } catch {}
  }

  function warn(...args) {
    try { console.warn(LOG_PREFIX, ...args); } catch {}
  }

  function err(...args) {
    try { console.error(LOG_PREFIX, ...args); } catch {}
  }

  // --- Helpers to detect regen dialog (keep your existing heuristics, but add optional template check) ---
  function looksLikeRegenDialog(app, html) {
    try {
      const title = String(app?.title ?? "");
      const titleHit = title.toLowerCase().includes("regeneration");
      const template = String(app?.options?.template ?? "");
      const templateHit = template.includes("regeneration-dialog.hbs");
      // DOM signature heuristic: select + roll button + campsite text
      const hasSelect = html?.find?.("select")?.length > 0;
      const hasRollBtn = html?.find?.("button")?.filter?.((i, el) => {
        const t = (el?.innerText ?? "").toLowerCase();
        return t.includes("roll") || t.includes("würf") || t.includes("wuerf") || t.includes("würfel") || t.includes("regener");
      })?.length > 0;
      const hasCampsiteText = (html?.text?.() ?? "").toLowerCase().includes("campsite");

      return templateHit || titleHit || (hasSelect && hasRollBtn) || (hasSelect && hasCampsiteText);
    } catch {
      return false;
    }
  }

  // --- UI panel (keep existing behavior; minimal) ---
  function ensurePanel(html) {
    try {
      // do not duplicate
      if (html.find?.(".masterful-reg-panel")?.length) return;

      const wrap = document.createElement("div");
      wrap.className = "masterful-reg-panel";
      wrap.style.display = "flex";
      wrap.style.gap = "8px";
      wrap.style.alignItems = "center";
      wrap.style.padding = "6px 8px";
      wrap.style.marginBottom = "6px";
      wrap.style.border = "1px solid rgba(255,255,255,0.15)";
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
        btn.style.padding = "2px 8px";
        btn.style.borderRadius = "6px";
        btn.style.border = "1px solid rgba(255,255,255,0.2)";
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

      // Inject at top of dialog content
      const content = html[0]?.querySelector?.(".window-content") ?? html[0];
      if (content?.firstChild) content.insertBefore(wrap, content.firstChild);
      else content?.appendChild(wrap);
    } catch (e) {
      warn("ensurePanel failed", e);
    }
  }

  // --- Submit wrapper: just sets rollContext and trace budget ---
  function wrapSubmitOnce(app) {
    try {
      if (!app || MASTERFUL._wrapped?.submit) return;
      if (typeof app._onSubmit !== "function") return;

      const orig = app._onSubmit.bind(app);
      app._onSubmit = async function (...args) {
        // Enable context only for this submit
        resetTraceBudget();
        MASTERFUL._rollContext.active = true;
        MASTERFUL._rollContext.state = { ...MASTERFUL.state };

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
          // keep your safety policy: suppress so Forge doesn't refresh
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

  // --- Roll diagnostics wrappers ---
  function wrapRollDiagnostics() {
    if (MASTERFUL._wrapped.rollDiagnostics) return;
    MASTERFUL._wrapped.rollDiagnostics = true;

    try {
      // Wrap Roll.create (static), if present
      if (globalThis.Roll && typeof globalThis.Roll.create === "function" && !MASTERFUL._wrapped.Roll_create) {
        const origCreate = globalThis.Roll.create.bind(globalThis.Roll);
        globalThis.Roll.create = function (...args) {
          try {
            if (diagEnabled() && inRegenContext() && canTraceMore()) {
              bumpTrace();
              const [formula, data, options] = args;
              log("TRACE Roll.create", {
                at: nowISO(),
                formula,
                dataKeys: data ? Object.keys(data) : null,
                options,
                stack: stackTop(12),
              });
            }
          } catch {}
          return origCreate(...args);
        };
        MASTERFUL._wrapped.Roll_create = true;
        if (diagEnabled()) log("Roll.create wrapped (diagnostic)");
      }

      // Wrap Roll.prototype.roll
      if (globalThis.Roll?.prototype && typeof globalThis.Roll.prototype.roll === "function" && !MASTERFUL._wrapped.Roll_roll) {
        const orig = globalThis.Roll.prototype.roll;
        globalThis.Roll.prototype.roll = async function (...args) {
          try {
            if (diagEnabled() && inRegenContext() && canTraceMore()) {
              bumpTrace();
              log("TRACE Roll.roll", {
                at: nowISO(),
                formula: this?.formula,
                _formula: this?._formula,
                terms: summarizeTerms(this?.terms),
                options: args?.[0],
                stack: stackTop(12),
              });
            }
          } catch {}
          return orig.apply(this, args);
        };
        MASTERFUL._wrapped.Roll_roll = true;
        if (diagEnabled()) log("Roll.prototype.roll wrapped (diagnostic)");
      }

      // Wrap Roll.prototype.evaluate
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
                stack: stackTop(12),
              });
            }
          } catch {}
          return orig.apply(this, args);
        };
        MASTERFUL._wrapped.Roll_evaluate = true;
        if (diagEnabled()) log("Roll.prototype.evaluate wrapped (diagnostic)");
      }

      // Wrap Roll.prototype.evaluateSync (if exists)
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
                stack: stackTop(12),
              });
            }
          } catch {}
          return orig.apply(this, args);
        };
        MASTERFUL._wrapped.Roll_evaluateSync = true;
        if (diagEnabled()) log("Roll.prototype.evaluateSync wrapped (diagnostic)");
      }

      // Wrap Die.evaluate (actual dice roll)
      const Die = globalThis.foundry?.dice?.terms?.Die;
      if (Die?.prototype && typeof Die.prototype.evaluate === "function" && !MASTERFUL._wrapped.Die_evaluate) {
        const orig = Die.prototype.evaluate;
        Die.prototype.evaluate = async function (...args) {
          try {
            if (diagEnabled() && inRegenContext() && canTraceMore()) {
              bumpTrace();
              log("TRACE Die.evaluate", {
                at: nowISO(),
                faces: this?.faces,
                number: this?.number,
                modifiers: this?.modifiers,
                options: args?.[0],
                // results can be huge; show a small snapshot
                resultsBefore: snapshotResults(this?.results),
                stack: stackTop(12),
              });
            }
          } catch {}
          return orig.apply(this, args);
        };
        MASTERFUL._wrapped.Die_evaluate = true;
        if (diagEnabled()) log("Die.prototype.evaluate wrapped (diagnostic)");
      }

      // Wrap Die.evaluateSync (if exists)
      if (Die?.prototype && typeof Die.prototype.evaluateSync === "function" && !MASTERFUL._wrapped.Die_evaluateSync) {
        const orig = Die.prototype.evaluateSync;
        Die.prototype.evaluateSync = function (...args) {
          try {
            if (diagEnabled() && inRegenContext() && canTraceMore()) {
              bumpTrace();
              log("TRACE Die.evaluateSync", {
                at: nowISO(),
                faces: this?.faces,
                number: this?.number,
                modifiers: this?.modifiers,
                options: args?.[0],
                resultsBefore: snapshotResults(this?.results),
                stack: stackTop(12),
              });
            }
          } catch {}
          return orig.apply(this, args);
        };
        MASTERFUL._wrapped.Die_evaluateSync = true;
        if (diagEnabled()) log("Die.prototype.evaluateSync wrapped (diagnostic)");
      }

      if (diagEnabled()) log("Roll/Die diagnostics ready");
    } catch (e) {
      warn("wrapRollDiagnostics failed", e);
    }
  }

  function snapshotResults(results) {
    try {
      if (!Array.isArray(results)) return results;
      return results.slice(0, 5).map(r => {
        if (!r) return r;
        return {
          result: r.result,
          active: r.active,
          discarded: r.discarded,
          success: r.success,
          failure: r.failure,
          count: r.count,
        };
      });
    } catch {
      return "(unavailable)";
    }
  }

  function summarizeTerms(terms) {
    try {
      if (!Array.isArray(terms)) return terms;
      return terms.map(t => {
        if (!t) return t;
        const cls = t.constructor?.name;
        // Die, OperatorTerm, NumericTerm, Grouping, ParentheticalTerm, etc.
        const base = { type: cls };
        if (cls === "Die" || cls === "DiceTerm") {
          base.faces = t.faces;
          base.number = t.number;
          base.modifiers = t.modifiers;
        }
        if ("operator" in t) base.operator = t.operator;
        if ("number" in t && cls !== "Die") base.number = t.number;
        if ("value" in t) base.value = t.value;
        return base;
      });
    } catch {
      return "(terms unavailable)";
    }
  }

  // --- Hooks ---
  Hooks.once("init", () => {
    try {
      if (diagEnabled()) log("init", { at: nowISO() });
      wrapRollDiagnostics();
    } catch (e) {
      warn("init failed", e);
    }
  });

  Hooks.on("renderDSA5Dialog", (app, html) => {
    try {
      if (!looksLikeRegenDialog(app, html)) return;

      if (diagEnabled()) {
        log("regen dialog detected", {
          at: nowISO(),
          title: app?.title,
          template: app?.options?.template,
        });
      }

      ensurePanel(html);
      wrapSubmitOnce(app);
      wrapRollDiagnostics();
    } catch (e) {
      warn("render hook failed", e);
    }
  });

})();
