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
    if (app.actor) return app.actor;
    if (app.options?.actor) return app.options.actor;
    if (app.data?.actor) return app.data.actor;
    // Fallback: ChatMessage speaker (usually the actor who opened the dialog)
    try {
      const speaker = ChatMessage.getSpeaker();
      if (speaker?.actor) return game.actors.get(speaker.actor);
    } catch (_) {}
    // Fallback: selected token on canvas
    const token = canvas?.tokens?.controlled?.[0];
    if (token?.actor) return token.actor;
    return null;
  }

  function hasMeisterlicheRegeneration(actor, resource) {
    if (!actor?.items) return false;
    return actor.items.some(i =>
      i.name.includes("Meisterliche Regeneration") && i.name.includes(resource)
    );
  }

  /** Reset toggles based on actor's Meisterliche Regeneration abilities. */
  function updateTogglesFromActor(app, root) {
    // Only set defaults when the panel is first injected
    if (root?.querySelector(".masterful-panel")) return;

    toggles.lp = false;
    toggles.ae = false;
    toggles.kp = false;

    const actor = getActorFromDialog(app);
    if (!actor) return;

    toggles.lp = hasMeisterlicheRegeneration(actor, "Lebensenergie");
    toggles.ae = hasMeisterlicheRegeneration(actor, "Astralenergie");
    toggles.kp = hasMeisterlicheRegeneration(actor, "Karmaenergie");

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
