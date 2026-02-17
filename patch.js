/**
 * Masterful Regeneration — v2.0.0
 * Foundry VTT v13 / DSA5 7.4.x
 *
 * Replaces 1d6 die rolls with a fixed result of 4 for selected resources
 * in the DSA5 regeneration dialog (Meisterliche Regeneration).
 *
 * Strategy: Die.prototype.evaluate interception with an ordered queue
 * built from the dialog's regeneration checkboxes × masterful toggles.
 */
(() => {
  const LOG = "dsa5-masterful-regeneration |";

  // Per-resource masterful toggle state (reset per dialog based on actor abilities)
  const toggles = { lp: false, ae: false, kp: false };

  // Roll interception context: queue of booleans [forceLeP?, forceAsP?, forceKaP?]
  const ctx = { active: false, queue: [] };

  /* ──────── Die.prototype.evaluate wrapper ──────── */

  Hooks.once("init", () => {
    if (typeof Die === "undefined" || !Die.prototype?.evaluate) {
      console.warn(LOG, "Die.prototype.evaluate not found");
      return;
    }

    const origEvaluate = Die.prototype.evaluate;

    Die.prototype.evaluate = function (options = {}) {
      if (ctx.active && ctx.queue.length > 0) {
        const force = ctx.queue.shift();
        if (ctx.queue.length === 0) ctx.active = false;
        if (force) {
          this.results = [{ result: 4, active: true }];
          this._evaluated = true;
          return this;
        }
      }
      return origEvaluate.call(this, options);
    };

    console.log(LOG, "Die.evaluate wrapped");
  });

  /* ──────── Dialog detection ──────── */

  function isRegenDialog(app) {
    const tpl = app?.options?.template ?? "";
    if (tpl.includes("regeneration-dialog")) return true;
    const t = (app?.title ?? "").toLowerCase();
    return t.includes("regeneration") || t.includes("regenerieren");
  }

  function getRoot(html) {
    return html instanceof HTMLElement ? html : html?.[0] ?? null;
  }

  /* ──────── Actor detection & ability check ──────── */

  function getActorFromDialog(app) {
    // Direct references on dialog
    if (app.actor) return app.actor;
    if (app.options?.actor) return app.options.actor;
    if (app.data?.actor) return app.data.actor;
    if (app.object instanceof Actor) return app.object;
    if (app.document instanceof Actor) return app.document;

    // Fallback: find an open actor sheet (the sheet that triggered the dialog)
    try {
      const apps = foundry.applications?.instances;
      if (apps) {
        for (const w of apps.values()) {
          if (w.document instanceof Actor) return w.document;
        }
      }
    } catch (_) {}

    // Fallback: legacy UI windows (Foundry v1 apps)
    try {
      for (const w of Object.values(ui.windows)) {
        if (w.actor instanceof Actor) return w.actor;
        if (w.object instanceof Actor) return w.object;
        if (w.document instanceof Actor) return w.document;
      }
    } catch (_) {}

    // Fallback: ChatMessage speaker
    try {
      const speaker = ChatMessage.getSpeaker();
      if (speaker?.actor) {
        const a = game.actors.get(speaker.actor);
        if (a) return a;
      }
    } catch (_) {}

    // Fallback: selected token on canvas
    try {
      const token = canvas?.tokens?.controlled?.[0];
      if (token?.actor) return token.actor;
    } catch (_) {}

    // Fallback: user's default character
    if (game.user?.character) return game.user.character;

    return null;
  }

  /**
   * Scan actor items for regeneration Sonderfertigkeiten and set toggles.
   *
   * DE: "Meisterliche Regeneration" / EN: "Masterful Regeneration" → AsP
   * DE: "Stabile Regeneration"      / EN: "Stable Regeneration"    → KaP
   */
  function detectRegenerationAbilities(actor) {
    if (!actor?.items) return;

    for (const item of actor.items) {
      const name = item.name ?? "";

      if (name.includes("Meisterliche Regeneration") || name.includes("Masterful Regeneration")) {
        console.log(LOG, "Found SF:", name, "| type:", item.type);
        toggles.ae = true;
      }

      if (name.includes("Stabile Regeneration") || name.includes("Stable Regeneration")) {
        console.log(LOG, "Found SF:", name, "| type:", item.type);
        toggles.kp = true;
      }
    }
  }

  /** Reset toggles based on actor's Meisterliche Regeneration abilities. */
  function updateTogglesFromActor(app, root) {
    // Only set defaults when the panel is first injected
    if (root?.querySelector(".masterful-panel")) return;

    toggles.lp = false;
    toggles.ae = false;
    toggles.kp = false;

    const actor = getActorFromDialog(app);
    if (!actor) {
      console.warn(LOG, "Could not resolve actor from dialog");
      return;
    }

    detectRegenerationAbilities(actor);

    console.log(LOG, "Actor:", actor.name,
      "| LeP:", toggles.lp, "| AsP:", toggles.ae, "| KaP:", toggles.kp);
  }

  /* ──────── UI panel injection ──────── */

  function injectPanel(root) {
    if (!root || root.querySelector(".masterful-panel")) return;

    const hasAe = !!root.querySelector('[name="AsPModifier"], [name="regenerateAsP"]');
    const hasKp = !!root.querySelector('[name="KaPModifier"], [name="regenerateKaP"]');

    const panel = document.createElement("div");
    panel.className = "masterful-panel";
    panel.style.cssText =
      "border:1px solid rgba(0,0,0,0.15);border-radius:4px;padding:6px 8px;margin:6px 0;";

    const cb = (key, label) =>
      `<label style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;cursor:pointer">` +
      `<input type="checkbox" class="masterful-cb" data-res="${key}"${toggles[key] ? " checked" : ""}> ${label}</label>`;

    let inner = cb("lp", "LeP");
    if (hasAe) inner += cb("ae", "AsP");
    if (hasKp) inner += cb("kp", "KaP");

    panel.innerHTML =
      `<div style="font-weight:bold;margin-bottom:4px">Meisterliche Regeneration</div>` +
      `<div style="display:flex;align-items:center;gap:4px">` +
      inner +
      `<span style="opacity:0.55;font-size:0.85em;margin-left:4px">(1d6 → 4)</span></div>`;

    panel.querySelectorAll(".masterful-cb").forEach(el => {
      el.addEventListener("change", e => {
        toggles[e.target.dataset.res] = e.target.checked;
      });
    });

    // Insert before dialog buttons
    const footer = root.querySelector("footer, .dialog-buttons");
    if (footer) footer.before(panel);
    else (root.querySelector("form") ?? root).appendChild(panel);
  }

  /* ──────── Roll button interception (capture phase) ──────── */

  function hookRollButton(root) {
    if (!root || root.dataset.masterfulHooked) return;
    root.dataset.masterfulHooked = "1";

    const btn = root.querySelector('[data-action="rollButton"]');
    if (!btn) return;

    btn.addEventListener("click", () => {
      const queue = [];
      const rLp = root.querySelector('[name="regenerateLeP"]');
      const rAe = root.querySelector('[name="regenerateAsP"]');
      const rKp = root.querySelector('[name="regenerateKaP"]');

      if (rLp?.checked) queue.push(toggles.lp);
      if (rAe?.checked) queue.push(toggles.ae);
      if (rKp?.checked) queue.push(toggles.kp);

      ctx.active = true;
      ctx.queue = queue;
      console.log(LOG, "Queue:", [...queue]);

      // Safety timeout: reset context after 10s to prevent leaking into unrelated rolls
      setTimeout(() => {
        if (ctx.active) {
          ctx.active = false;
          ctx.queue = [];
          console.warn(LOG, "Safety timeout: context reset");
        }
      }, 10_000);
    }, true); // capture phase — fires before DSA5 handler
  }

  /* ──────── Main hook ──────── */

  Hooks.on("renderDSA5Dialog", (app, html) => {
    if (!isRegenDialog(app)) return;
    const root = getRoot(html);
    updateTogglesFromActor(app, root);
    injectPanel(root);
    hookRollButton(root);
  });
})();
