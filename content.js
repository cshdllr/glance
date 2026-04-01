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
  const changedStyles = new Map();

  // Layout mode: "sidebar" (default) or "float"
  let layoutMode = "sidebar";
  let sidebarWidth = 280;
  try {
    const saved = localStorage.getItem("__looker_layout_mode__");
    if (saved === "float" || saved === "sidebar") layoutMode = saved;
    const savedW = parseInt(localStorage.getItem("__looker_sidebar_w__"), 10);
    if (savedW >= 200 && savedW <= 600) sidebarWidth = savedW;
  } catch {}

  // ─── Device Preview ──────────────────────────────────────────────────────
  let devicePreviewActive = false;
  let deviceFrame = null;
  let currentDevice = null;
  let isLandscape = false;

  const DEVICES = [
    { name: "iPhone SE",     w: 375, h: 667 },
    { name: "iPhone 15",     w: 393, h: 852 },
    { name: "iPhone 15 Pro Max", w: 430, h: 932 },
    { name: "Pixel 8",       w: 412, h: 924 },
    { name: "Galaxy S24",    w: 360, h: 780 },
    { name: "iPad Mini",     w: 768, h: 1024 },
    { name: "iPad Air",      w: 820, h: 1180 },
  ];

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
    document.documentElement.classList.remove("__looker_sidebar_active__");
    if (highlightBox) { highlightBox.remove(); highlightBox = null; }
    if (panel) { panel.remove(); panel = null; }
    if (devicePreviewActive) disableDevicePreview();
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
    applyLayoutMode();
    panel.innerHTML = `
      <div class="__looker_resize_handle__" id="__looker_resize_handle__"></div>
      <div class="__looker_panel_header__">
        <span class="__looker_logo__">◈ Looker</span>
        <div class="__looker_header_actions__">
          <button class="__looker_layout_toggle__ ${layoutMode === "sidebar" ? "__looker_layout_sidebar__" : ""}" id="__looker_layout_toggle__" title="Toggle sidebar / float">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="15" y1="3" x2="15" y2="21"/>
            </svg>
          </button>
          <button class="__looker_device_toggle__" id="__looker_device_toggle__" title="Toggle device preview">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
              <line x1="12" y1="18" x2="12" y2="18"/>
            </svg>
          </button>
          <button class="__looker_copy_changes__" id="__looker_copy_changes__" title="Copy all changes as CSS">Copy Changes</button>
          <button class="__looker_close__" title="Close (Esc)">✕</button>
        </div>
      </div>
      <div class="__looker_device_bar__" id="__looker_device_bar__">
        <div class="__looker_device_selector__">
          <select id="__looker_device_select__">
            ${DEVICES.map((d, i) => `<option value="${i}">${d.name}</option>`).join("")}
          </select>
          <button class="__looker_rotate_btn__" id="__looker_rotate_btn__" title="Rotate device">⟳</button>
        </div>
        <div class="__looker_device_dims__" id="__looker_device_dims__"></div>
      </div>
      <div class="__looker_panel_body__" id="__looker_body__">
        <div class="__looker_empty__">Hover over any element</div>
      </div>
    `;
    document.body.appendChild(panel);
    panel.querySelector(".__looker_close__").addEventListener("click", deactivate);
    panel.querySelector("#__looker_copy_changes__").addEventListener("click", copyAllChanges);
    panel.querySelector("#__looker_layout_toggle__").addEventListener("click", toggleLayoutMode);
    panel.querySelector("#__looker_device_toggle__").addEventListener("click", toggleDevicePreview);
    panel.querySelector("#__looker_device_select__").addEventListener("change", onDeviceChange);
    panel.querySelector("#__looker_rotate_btn__").addEventListener("click", rotateDevice);
    initResizeHandle();
    if (layoutMode === "float") makeDraggable(panel);
  }

  function renderPanel(el) {
    if (!panel) return;
    const body = panel.querySelector("#__looker_body__");
    if (!body) return;

    const cs = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const elId = el.id ? `#${el.id}` : "";
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

    const posFields = [];
    if (cs.position !== "static") {
      ["top","right","bottom","left"].forEach(d => {
        const v = cs.getPropertyValue(d);
        if (v && v !== "auto") posFields.push(field(d.charAt(0).toUpperCase(), v, d));
      });
    }

    const layoutFields = [];
    if (cs.display.includes("flex")) {
      layoutFields.push(field("Dir", cs.flexDirection, "flex-direction"));
      layoutFields.push(field("Align", cs.alignItems, "align-items"));
      layoutFields.push(field("Justify", cs.justifyContent, "justify-content"));
      if (cs.gap !== "normal" && cs.gap !== "0px") layoutFields.push(field("Gap", cs.gap, "gap"));
    }
    if (cs.display.includes("grid")) {
      layoutFields.push(field("Cols", cs.gridTemplateColumns, "grid-template-columns", true));
    }

    body.innerHTML = `
      ${section("Element", `
        <div class="__looker_selector__">&lt;${tag}${elId}${classes}&gt;</div>
      `)}

      ${classList.length ? section("Classes", `
        <div class="__looker_classes__">
          ${classList.map(c => `
            <button class="__looker_class_pill__" data-classname="${c}">.${c}</button>
          `).join("")}
        </div>
        <div class="__looker_class_details__" id="__looker_class_details__"></div>
      `) : ""}

      ${section("Position", `
        <div class="__looker_field_grid__">
          ${field("X", Math.round(rect.left) + "", null)}
          ${field("Y", Math.round(rect.top) + "", null)}
        </div>
      `)}

      ${section("Layout", `
        <div class="__looker_field_grid__">
          ${field("W", px(rect.width), "width")}
          ${field("H", px(rect.height), "height")}
          ${field("Display", cs.display, "display")}
          ${field("Position", cs.position, "position")}
          ${posFields.join("")}
          ${cs.position !== "static" ? field("Z", cs.zIndex, "z-index") : ""}
          ${cs.overflow !== "visible" ? field("Overflow", cs.overflow, "overflow") : ""}
          ${layoutFields.join("")}
        </div>
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

      ${section("Appearance", `
        ${colorField("Fill", cs.backgroundColor, "background-color")}
        ${colorField("Color", cs.color, "color")}
        <div class="__looker_field_grid__" style="margin-top:4px">
          ${field("Opacity", cs.opacity, "opacity")}
          ${field("Radius", cs.borderRadius === "0px" ? "0" : cs.borderRadius, "border-radius")}
          ${cs.borderTopWidth !== "0px" ? field("Border", cs.borderTopWidth + " " + cs.borderTopStyle, "border") : ""}
          ${cs.boxShadow !== "none" ? field("Shadow", "yes", "box-shadow") : ""}
        </div>
      `)}

      ${section("Typography", `
        <div class="__looker_field_grid__">
          ${field("Font", shortFont(cs.fontFamily), "font-family", true)}
          ${field("Weight", cs.fontWeight, "font-weight")}
          ${field("Size", cs.fontSize, "font-size")}
          ${field("Line", cs.lineHeight, "line-height")}
          ${field("Spacing", cs.letterSpacing === "normal" ? "0" : cs.letterSpacing, "letter-spacing")}
          ${field("Align", cs.textAlign, "text-align")}
        </div>
      `)}
    `;

    attachFieldHandlers(body, el);
    attachClassPillHandlers(body, el);
    updateCopyChangesButton();
  }

  function attachFieldHandlers(container, targetEl) {
    container.querySelectorAll(".__looker_field_value__, .__looker_color_hex__").forEach(v => {
      v.addEventListener("click", (e) => {
        if (v.querySelector(".__looker_edit_input__")) return;
        navigator.clipboard.writeText(v.dataset.copy || v.textContent.trim()).catch(() => {});
        v.classList.add("__looker_copied__");
        setTimeout(() => v.classList.remove("__looker_copied__"), 800);
      });
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

  function attachValHandlers(container, targetEl) {
    container.querySelectorAll(".__looker_val__").forEach(v => {
      v.addEventListener("click", (e) => {
        if (v.querySelector(".__looker_edit_input__")) return;
        navigator.clipboard.writeText(v.dataset.copy || v.textContent.trim()).catch(() => {});
        v.classList.add("__looker_copied__");
        setTimeout(() => v.classList.remove("__looker_copied__"), 800);
      });
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
    valEl.querySelectorAll(".__looker_swatch__").forEach(s => s.remove());
    valEl.appendChild(input);
    input.focus();
    input.select();

    const commit = () => {
      const newVal = input.value.trim();
      input.remove();
      if (newVal && newVal !== currentVal) {
        applyChange(targetEl, cssProp, currentVal, newVal);
        renderPanel(targetEl);
      } else {
        valEl.innerHTML = valEl.dataset.copy || currentVal;
      }
    };

    function nudge(direction, amount) {
      const val = input.value.trim();
      const match = val.match(/^(-?[\d.]+)(.*)$/);
      if (!match) return false;
      const num = parseFloat(match[1]);
      if (isNaN(num)) return false;
      const unit = match[2] || "";
      const newNum = Math.round((num + direction * amount) * 100) / 100;
      input.value = newNum + unit;
      applyChange(targetEl, cssProp, val, input.value);
      positionHighlight(targetEl);
      return true;
    }

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); return; }
      if (e.key === "Escape") { e.preventDefault(); input.remove(); valEl.innerHTML = currentVal; return; }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const dir = e.key === "ArrowUp" ? 1 : -1;
        const step = e.shiftKey ? 10 : 1;
        if (nudge(dir, step)) e.preventDefault();
      }
      e.stopPropagation();
    });
    input.addEventListener("blur", commit);
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

  // ─── Layout Mode ────────────────────────────────────────────────────────────
  function applyLayoutMode() {
    if (!panel) return;
    panel.classList.remove("__looker_mode_sidebar__", "__looker_mode_float__");
    panel.classList.add(layoutMode === "sidebar" ? "__looker_mode_sidebar__" : "__looker_mode_float__");

    if (layoutMode === "sidebar") {
      panel.style.left = "";
      panel.style.top = "";
      panel.style.right = "";
      panel.style.bottom = "";
      applySidebarWidth(sidebarWidth);
      document.documentElement.classList.add("__looker_sidebar_active__");
    } else {
      panel.style.width = "";
      document.documentElement.style.removeProperty("--__looker-sidebar-w");
      document.documentElement.classList.remove("__looker_sidebar_active__");
    }
  }

  function applySidebarWidth(w) {
    sidebarWidth = Math.max(200, Math.min(600, w));
    if (panel) panel.style.width = sidebarWidth + "px";
    document.documentElement.style.setProperty("--__looker-sidebar-w", sidebarWidth + "px");
  }

  function toggleLayoutMode() {
    layoutMode = layoutMode === "sidebar" ? "float" : "sidebar";
    try { localStorage.setItem("__looker_layout_mode__", layoutMode); } catch {}
    applyLayoutMode();

    const toggleBtn = document.getElementById("__looker_layout_toggle__");
    if (toggleBtn) {
      toggleBtn.classList.toggle("__looker_layout_sidebar__", layoutMode === "sidebar");
    }

    // Enable/disable dragging
    if (layoutMode === "float") {
      makeDraggable(panel);
    }

    showToast(layoutMode === "sidebar" ? "Sidebar mode" : "Float mode");
  }

  // ─── Device Preview ─────────────────────────────────────────────────────────
  function toggleDevicePreview() {
    if (devicePreviewActive) {
      disableDevicePreview();
    } else {
      enableDevicePreview();
    }
  }

  function enableDevicePreview() {
    devicePreviewActive = true;
    isLandscape = false;
    currentDevice = DEVICES[0];

    const toggleBtn = document.getElementById("__looker_device_toggle__");
    if (toggleBtn) toggleBtn.classList.add("__looker_device_active__");

    const bar = document.getElementById("__looker_device_bar__");
    if (bar) bar.classList.add("__looker_device_bar_open__");

    const select = document.getElementById("__looker_device_select__");
    if (select) select.value = "0";

    createDeviceFrame();
    applyDeviceSize();
    showToast(`Device preview: ${currentDevice.name}`);
  }

  function disableDevicePreview() {
    devicePreviewActive = false;
    currentDevice = null;
    isLandscape = false;

    const toggleBtn = document.getElementById("__looker_device_toggle__");
    if (toggleBtn) toggleBtn.classList.remove("__looker_device_active__");

    const bar = document.getElementById("__looker_device_bar__");
    if (bar) bar.classList.remove("__looker_device_bar_open__");

    removeDeviceFrame();
    showToast("Device preview off");
  }

  function createDeviceFrame() {
    removeDeviceFrame();
    deviceFrame = document.createElement("div");
    deviceFrame.id = "__looker_device_frame__";
    deviceFrame.innerHTML = `
      <div class="__looker_device_notch__"></div>
      <iframe id="__looker_device_iframe__" src="${window.location.href}"></iframe>
      <div class="__looker_device_home_bar__"></div>
    `;
    document.body.appendChild(deviceFrame);

    // Hide page content behind the frame
    document.documentElement.classList.add("__looker_device_mode__");
  }

  function removeDeviceFrame() {
    if (deviceFrame) { deviceFrame.remove(); deviceFrame = null; }
    document.documentElement.classList.remove("__looker_device_mode__");
  }

  function applyDeviceSize() {
    if (!currentDevice || !deviceFrame) return;
    const w = isLandscape ? currentDevice.h : currentDevice.w;
    const h = isLandscape ? currentDevice.w : currentDevice.h;

    const iframe = deviceFrame.querySelector("#__looker_device_iframe__");
    if (iframe) {
      iframe.style.width = w + "px";
      iframe.style.height = h + "px";
    }
    deviceFrame.style.width = (w + 24) + "px";
    deviceFrame.style.height = (h + 80) + "px";

    const panelWidth = layoutMode === "sidebar" ? sidebarWidth : 320;
    const maxW = window.innerWidth - panelWidth;
    const maxH = window.innerHeight - 40;
    const frameW = w + 24;
    const frameH = h + 80;
    const scale = Math.min(1, maxW / frameW, maxH / frameH);
    const panelOffset = layoutMode === "sidebar" ? Math.round(sidebarWidth / 2) : 140;
    deviceFrame.style.left = `calc(50% - ${panelOffset}px)`;
    deviceFrame.style.transform = `translate(-50%, -50%) scale(${scale})`;

    const dims = document.getElementById("__looker_device_dims__");
    if (dims) dims.textContent = `${w} × ${h}`;
  }

  function onDeviceChange(e) {
    const idx = parseInt(e.target.value, 10);
    currentDevice = DEVICES[idx];
    applyDeviceSize();
    showToast(`Device: ${currentDevice.name}`);
  }

  function rotateDevice() {
    isLandscape = !isLandscape;
    applyDeviceSize();
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function section(title, content) {
    return `
      <div class="__looker_section__">
        <div class="__looker_section_title__">${title}</div>
        <div class="__looker_section_content__">${content}</div>
      </div>`;
  }

  function field(label, value, cssProp, full) {
    if (!value || value === "" || value === "undefined") return "";
    const propAttr = cssProp ? ` data-cssprop="${cssProp}"` : "";
    const isChanged = cssProp && pinnedElement && changedStyles.has(pinnedElement)
      && changedStyles.get(pinnedElement).has(cssProp);
    const changedClass = isChanged ? " __looker_val_changed__" : "";
    const fullClass = full ? " __looker_field_full__" : "";
    return `
      <div class="__looker_field__${fullClass}">
        <span class="__looker_field_label__">${label}</span>
        <span class="__looker_field_value__${changedClass}" data-copy="${value}"${propAttr}>${value}</span>
      </div>`;
  }

  function colorField(label, color, cssProp) {
    if (!color) return "";
    const isTransparent = color === "transparent" || color === "rgba(0, 0, 0, 0)";
    const hex = isTransparent ? "transparent" : rgbToHex(color);
    const opacity = isTransparent ? "0%" : parseOpacity(color);
    const propAttr = cssProp ? ` data-cssprop="${cssProp}"` : "";
    const preview = isTransparent ? "transparent" : color;
    return `
      <div class="__looker_color_field__">
        <div class="__looker_color_preview__" style="background:${preview}"></div>
        <span class="__looker_color_hex__" data-copy="${color}"${propAttr}>${hex}</span>
        <span class="__looker_color_opacity__">${opacity}</span>
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

  function rgbToHex(rgb) {
    const m = rgb.match(/\d+/g);
    if (!m || m.length < 3) return rgb;
    return "#" + [m[0],m[1],m[2]].map(n => parseInt(n).toString(16).padStart(2,"0")).join("").toUpperCase();
  }

  function parseOpacity(color) {
    const m = color.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+)\s*)?\)/);
    if (m && m[1] !== undefined) return Math.round(parseFloat(m[1]) * 100) + "%";
    return "100%";
  }

  function px(n) { return Math.round(n) + "px"; }
  function stripPx(v) { return v ? v.replace("px", "") : "0"; }
  function shortFont(f) {
    if (!f) return "";
    return f.split(",")[0].replace(/['"]/g, "").trim();
  }

  // ─── Resize handle ─────────────────────────────────────────────────────────
  function initResizeHandle() {
    const handle = document.getElementById("__looker_resize_handle__");
    if (!handle) return;
    handle.addEventListener("mousedown", (e) => {
      if (layoutMode !== "sidebar") return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarWidth;
      handle.classList.add("__looker_resizing__");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (e) => {
        const delta = startX - e.clientX;
        applySidebarWidth(startW + delta);
      };
      const onUp = () => {
        handle.classList.remove("__looker_resizing__");
        document.body.style.cursor = inspectorActive && !pinnedElement ? "crosshair" : "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        try { localStorage.setItem("__looker_sidebar_w__", String(sidebarWidth)); } catch {}
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  // ─── Drag ──────────────────────────────────────────────────────────────────
  function makeDraggable(el) {
    const header = el.querySelector(".__looker_panel_header__");
    let ox = 0, oy = 0, mx = 0, my = 0;
    header.addEventListener("mousedown", (e) => {
      if (layoutMode !== "float") return;
      if (e.target.closest("button")) return;
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
