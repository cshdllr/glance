(() => {
  if (window.__lookerInjected) {
    // Already injected — just toggle
    window.__lookerToggle();
    return;
  }
  window.__lookerInjected = true;

  let inspectorActive = false;
  let pinnedElement = null;
  let hoveredElement = null;
  let highlightBox = null;
  let panel = null;
  let escListener = null;
  const changedStyles = new Map(); // element -> Map<property, {original, current}>

  window.__lookerToggle = function() {
    inspectorActive ? deactivate() : activate();
  };

  // Also listen for messages from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TOGGLE_INSPECTOR") window.__lookerToggle();
  });

  // ─── Activate ──────────────────────────────────────────────────────────────
  function activate() {
    inspectorActive = true;
    createHighlightBox();
    createPanel();
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    escListener = (e) => { if (e.key === "Escape") deactivate(); };
    document.addEventListener("keydown", escListener, true);
    document.body.style.cursor = "crosshair";
    showToast("Looker active — hover to inspect, click to pin");
  }

  // ─── Deactivate ────────────────────────────────────────────────────────────
  function deactivate() {
    inspectorActive = false;
    pinnedElement = null;
    hoveredElement = null;
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    if (escListener) document.removeEventListener("keydown", escListener, true);
    document.body.style.cursor = "";
    if (highlightBox) { highlightBox.remove(); highlightBox = null; }
    if (panel) { panel.remove(); panel = null; }
  }

  // ─── Highlight box ─────────────────────────────────────────────────────────
  function createHighlightBox() {
    highlightBox = document.createElement("div");
    highlightBox.id = "__looker_highlight__";
    document.body.appendChild(highlightBox);
  }

  function positionHighlight(el) {
    if (!highlightBox || !el) return;
    const r = el.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    highlightBox.style.left = (r.left + scrollX) + "px";
    highlightBox.style.top = (r.top + scrollY) + "px";
    highlightBox.style.width = r.width + "px";
    highlightBox.style.height = r.height + "px";
    highlightBox.classList.toggle("__looker_pinned__", el === pinnedElement);
  }

  // ─── Events ────────────────────────────────────────────────────────────────
  function onMouseMove(e) {
    if (pinnedElement) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.id === "__looker_highlight__" || el.closest("#__looker_panel__")) return;
    hoveredElement = el;
    positionHighlight(el);
    renderPanel(el);
  }

  function onClick(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.id === "__looker_highlight__" || el.closest("#__looker_panel__")) return;
    e.preventDefault();
    e.stopPropagation();

    if (pinnedElement === el) {
      pinnedElement = null;
      document.body.style.cursor = "crosshair";
    } else {
      pinnedElement = el;
      positionHighlight(el);
      renderPanel(el);
      document.body.style.cursor = "default";
    }
  }

  // ─── Panel ─────────────────────────────────────────────────────────────────
  function createPanel() {
    panel = document.createElement("div");
    panel.id = "__looker_panel__";
    panel.innerHTML = `
      <div class="__looker_panel_header__">
        <span class="__looker_logo__">◈ Looker</span>
        <div class="__looker_header_actions__">
          <button class="__looker_copy_changes__" id="__looker_copy_changes__" title="Copy all changes as CSS">Copy Changes</button>
          <button class="__looker_close__" title="Close (Esc)">✕</button>
        </div>
      </div>
      <div class="__looker_panel_body__" id="__looker_body__">
        <div class="__looker_empty__">Hover over any element</div>
      </div>
    `;
    document.body.appendChild(panel);
    panel.querySelector(".__looker_close__").addEventListener("click", deactivate);
    panel.querySelector("#__looker_copy_changes__").addEventListener("click", copyAllChanges);
    makeDraggable(panel);
  }

  function renderPanel(el) {
    if (!panel) return;
    const body = panel.querySelector("#__looker_body__");
    if (!body) return;

    const cs = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const classes = el.classList.length
      ? "." + Array.from(el.classList).slice(0, 3).join(".")
      : "";

    const contentW = Math.round(rect.width
      - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth));
    const contentH = Math.round(rect.height
      - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth));

    const classList = Array.from(el.classList);

    body.innerHTML = `
      ${section("Element", `
        <div class="__looker_selector__">${tag}${id}${classes}</div>
      `)}

      ${classList.length ? section("Classes", `
        <div class="__looker_classes__">
          ${classList.map(c => `
            <button class="__looker_class_pill__" data-classname="${c}">.${c}</button>
          `).join("")}
        </div>
        <div class="__looker_class_details__" id="__looker_class_details__"></div>
      `) : ""}

      ${section("Size", `
        ${row("W", px(rect.width), "width")}
        ${row("H", px(rect.height), "height")}
      `)}

      ${section("Spacing", `
        <div class="__looker_box_model__">
          <div class="__looker_bm_label__ __looker_bm_area_label__">margin</div>
          <div class="__looker_bm_margin__">
            <div class="__looker_bm_val__ __looker_bm_top__">${stripPx(cs.marginTop)}</div>
            <div class="__looker_bm_inner__">
              <div class="__looker_bm_val__ __looker_bm_left__">${stripPx(cs.marginLeft)}</div>
              <div class="__looker_bm_border__">
                <div class="__looker_bm_label__ __looker_bm_area_label__">border</div>
                <div class="__looker_bm_val__ __looker_bm_btop__">${stripPx(cs.borderTopWidth)}</div>
                <div class="__looker_bm_padding__">
                  <div class="__looker_bm_label__ __looker_bm_area_label__">padding</div>
                  <div class="__looker_bm_val__ __looker_bm_ptop__">${stripPx(cs.paddingTop)}</div>
                  <div class="__looker_bm_pcenter__">
                    <div class="__looker_bm_val__ __looker_bm_pleft__">${stripPx(cs.paddingLeft)}</div>
                    <div class="__looker_bm_content__">${contentW} × ${contentH}</div>
                    <div class="__looker_bm_val__ __looker_bm_pright__">${stripPx(cs.paddingRight)}</div>
                  </div>
                  <div class="__looker_bm_val__ __looker_bm_pbottom__">${stripPx(cs.paddingBottom)}</div>
                </div>
                <div class="__looker_bm_val__ __looker_bm_bbottom__">${stripPx(cs.borderBottomWidth)}</div>
              </div>
              <div class="__looker_bm_val__ __looker_bm_right__">${stripPx(cs.marginRight)}</div>
            </div>
            <div class="__looker_bm_val__ __looker_bm_bottom__">${stripPx(cs.marginBottom)}</div>
          </div>
        </div>
      `)}

      ${section("Typography", `
        ${row("Font", shortFont(cs.fontFamily), "font-family")}
        ${row("Size", cs.fontSize, "font-size")}
        ${row("Weight", cs.fontWeight, "font-weight")}
        ${row("Line H", cs.lineHeight, "line-height")}
        ${row("Tracking", cs.letterSpacing === "normal" ? "0" : cs.letterSpacing, "letter-spacing")}
        ${row("Align", cs.textAlign, "text-align")}
        ${row("Color", colorSwatch(cs.color) + cs.color, "color")}
      `)}

      ${section("Fill & Border", `
        ${row("BG", colorSwatch(cs.backgroundColor) + cs.backgroundColor, "background-color")}
        ${row("Radius", cs.borderRadius === "0px" ? "—" : cs.borderRadius, "border-radius")}
        ${cs.borderTopWidth !== "0px" ? row("Border", cs.borderTopWidth + " " + cs.borderTopStyle, "border") : ""}
        ${row("Opacity", cs.opacity, "opacity")}
        ${cs.boxShadow !== "none" ? row("Shadow", "···", "box-shadow") : ""}
      `)}

      ${section("Layout", `
        ${row("Display", cs.display, "display")}
        ${cs.display.includes("flex") ? row("Direction", cs.flexDirection, "flex-direction") : ""}
        ${cs.display.includes("flex") ? row("Align", cs.alignItems, "align-items") : ""}
        ${cs.display.includes("flex") ? row("Justify", cs.justifyContent, "justify-content") : ""}
        ${cs.display.includes("flex") && cs.gap !== "normal" ? row("Gap", cs.gap, "gap") : ""}
        ${cs.display.includes("grid") ? row("Columns", cs.gridTemplateColumns, "grid-template-columns") : ""}
        ${row("Position", cs.position, "position")}
        ${cs.position !== "static" ? row("Z-index", cs.zIndex, "z-index") : ""}
        ${cs.overflow !== "visible" ? row("Overflow", cs.overflow, "overflow") : ""}
      `)}
    `;

    attachValHandlers(body, el);
    attachClassPillHandlers(body, el);
    updateCopyChangesButton();
  }

  function attachValHandlers(container, targetEl) {
    container.querySelectorAll(".__looker_val__").forEach(v => {
      // Single click = copy value
      v.addEventListener("click", (e) => {
        if (v.querySelector(".__looker_edit_input__")) return;
        navigator.clipboard.writeText(v.dataset.copy || v.textContent.trim()).catch(() => {});
        v.classList.add("__looker_copied__");
        setTimeout(() => v.classList.remove("__looker_copied__"), 800);
      });

      // Double click = edit value
      const cssProp = v.dataset.cssprop;
      if (cssProp) {
        v.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          if (v.querySelector(".__looker_edit_input__")) return;
          startEditing(v, cssProp, targetEl);
        });
      }
    });
  }

  function startEditing(valEl, cssProp, targetEl) {
    const currentVal = valEl.dataset.copy || valEl.textContent.trim();
    const input = document.createElement("input");
    input.type = "text";
    input.className = "__looker_edit_input__";
    input.value = currentVal;
    valEl.textContent = "";
    // Remove swatch if present
    valEl.querySelectorAll(".__looker_swatch__").forEach(s => s.remove());
    valEl.appendChild(input);
    input.focus();
    input.select();

    const commit = () => {
      const newVal = input.value.trim();
      input.remove();
      if (newVal && newVal !== currentVal) {
        applyChange(targetEl, cssProp, currentVal, newVal);
        // Re-render to reflect the change
        renderPanel(targetEl);
      } else {
        valEl.innerHTML = valEl.dataset.copy || currentVal;
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      if (e.key === "Escape") { e.preventDefault(); input.remove(); valEl.innerHTML = currentVal; }
      e.stopPropagation();
    });
    input.addEventListener("blur", commit);
    // Prevent panel interactions while editing
    input.addEventListener("click", (e) => e.stopPropagation());
  }

  function applyChange(targetEl, cssProp, originalVal, newVal) {
    // Apply to the element
    targetEl.style.setProperty(cssProp, newVal);

    // Track the change
    if (!changedStyles.has(targetEl)) {
      changedStyles.set(targetEl, new Map());
    }
    const elChanges = changedStyles.get(targetEl);
    // Store original only on first change for this prop
    if (!elChanges.has(cssProp)) {
      elChanges.set(cssProp, { original: originalVal, current: newVal });
    } else {
      const entry = elChanges.get(cssProp);
      entry.current = newVal;
      // If reverted to original, remove the tracking
      if (entry.current === entry.original) {
        elChanges.delete(cssProp);
        if (elChanges.size === 0) changedStyles.delete(targetEl);
      }
    }
    updateCopyChangesButton();
  }

  function updateCopyChangesButton() {
    const btn = document.getElementById("__looker_copy_changes__");
    if (!btn) return;
    const totalChanges = Array.from(changedStyles.values())
      .reduce((sum, m) => sum + m.size, 0);
    btn.classList.toggle("__looker_has_changes__", totalChanges > 0);
    btn.textContent = totalChanges > 0 ? `Copy Changes (${totalChanges})` : "Copy Changes";
  }

  function copyAllChanges() {
    if (changedStyles.size === 0) {
      showToast("No changes to copy");
      return;
    }
    let css = "";
    changedStyles.forEach((props, el) => {
      if (props.size === 0) return;
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const cls = el.classList.length
        ? "." + Array.from(el.classList).slice(0, 3).join(".")
        : "";
      const selector = `${tag}${id}${cls}`;
      css += `/* ${selector} */\n`;
      props.forEach((val, prop) => {
        css += `${prop}: ${val.current};\n`;
      });
      css += "\n";
    });
    css = css.trim();
    navigator.clipboard.writeText(css).then(() => {
      showToast("Changes copied to clipboard");
    }).catch(() => {
      showToast("Failed to copy");
    });
  }

  function attachClassPillHandlers(body, targetEl) {
    body.querySelectorAll(".__looker_class_pill__").forEach(pill => {
      pill.addEventListener("click", () => {
        const className = pill.dataset.classname;
        const detailsContainer = body.querySelector("#__looker_class_details__");
        if (!detailsContainer) return;

        if (pill.classList.contains("__looker_class_active__")) {
          pill.classList.remove("__looker_class_active__");
          detailsContainer.innerHTML = "";
          return;
        }

        body.querySelectorAll(".__looker_class_pill__").forEach(p =>
          p.classList.remove("__looker_class_active__")
        );
        pill.classList.add("__looker_class_active__");

        const rules = getClassRules(className);
        if (rules.length === 0) {
          detailsContainer.innerHTML = `<div class="__looker_class_empty__">No defined properties found</div>`;
        } else {
          detailsContainer.innerHTML = rules.map(rule => `
            <div class="__looker_class_rule__">
              <div class="__looker_class_rule_selector__">${rule.selector}</div>
              ${rule.properties.map(p => {
                const isChanged = targetEl && changedStyles.has(targetEl)
                  && changedStyles.get(targetEl).has(p.name);
                const changedClass = isChanged ? " __looker_val_changed__" : "";
                return `
                <div class="__looker_row__">
                  <span class="__looker_key__" style="width:auto;flex:1">${p.name}</span>
                  <span class="__looker_val__${changedClass}" data-copy="${p.value}" data-cssprop="${p.name}">${p.value}</span>
                </div>`;
              }).join("")}
            </div>
          `).join("");

          attachValHandlers(detailsContainer, targetEl);
        }
      });
    });
  }

  function getClassRules(className) {
    const results = [];
    try {
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules || sheet.rules; } catch { continue; }
        if (!rules) continue;
        for (const rule of rules) {
          if (rule.type !== CSSRule.STYLE_RULE) continue;
          // Check if this selector targets the class
          const selectors = rule.selectorText.split(",").map(s => s.trim());
          for (const sel of selectors) {
            if (sel.includes("." + className)) {
              const props = [];
              for (let i = 0; i < rule.style.length; i++) {
                const name = rule.style[i];
                props.push({ name, value: rule.style.getPropertyValue(name).trim() });
              }
              if (props.length > 0) {
                results.push({ selector: sel, properties: props });
              }
              break;
            }
          }
        }
      }
    } catch {}
    return results;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function section(title, content) {
    return `
      <div class="__looker_section__">
        <div class="__looker_section_title__">${title}</div>
        <div class="__looker_section_content__">${content}</div>
      </div>`;
  }

  function row(label, value, cssProp) {
    if (!value || value === "" || value === "undefined") return "";
    const propAttr = cssProp ? ` data-cssprop="${cssProp}"` : "";
    const isChanged = cssProp && pinnedElement && changedStyles.has(pinnedElement)
      && changedStyles.get(pinnedElement).has(cssProp);
    const changedClass = isChanged ? " __looker_val_changed__" : "";
    return `
      <div class="__looker_row__">
        <span class="__looker_key__">${label}</span>
        <span class="__looker_val__${changedClass}" data-copy="${value}"${propAttr}>${value}</span>
      </div>`;
  }

  function colorSwatch(color) {
    if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") return "";
    return `<span class="__looker_swatch__" style="background:${color}"></span>`;
  }

  function px(n) { return Math.round(n) + "px"; }
  function stripPx(v) { return v ? v.replace("px", "") : "0"; }
  function shortFont(f) {
    if (!f) return "";
    return f.split(",")[0].replace(/['"]/g, "").trim();
  }

  // ─── Drag ──────────────────────────────────────────────────────────────────
  function makeDraggable(el) {
    const header = el.querySelector(".__looker_panel_header__");
    let ox = 0, oy = 0, mx = 0, my = 0;
    header.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("__looker_close__")) return;
      e.preventDefault();
      mx = e.clientX; my = e.clientY;
      const r = el.getBoundingClientRect();
      ox = r.left; oy = r.top;
      const onMove = (e) => {
        el.style.left = (ox + e.clientX - mx) + "px";
        el.style.top = (oy + e.clientY - my) + "px";
        el.style.right = "auto";
        el.style.bottom = "auto";
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  // ─── Toast ─────────────────────────────────────────────────────────────────
  function showToast(msg) {
    const existing = document.getElementById("__looker_toast__");
    if (existing) existing.remove();
    const t = document.createElement("div");
    t.id = "__looker_toast__";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add("__looker_toast_show__"), 10);
    setTimeout(() => {
      t.classList.remove("__looker_toast_show__");
      setTimeout(() => t.remove(), 400);
    }, 2800);
  }

})();
