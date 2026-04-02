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
  let hoverEnabled = true;
  const changedStyles = new Map();

  let sidebarWidth = 280;
  try {
    const savedW = parseInt(localStorage.getItem("__looker_sidebar_w__"), 10);
    if (savedW >= 200 && savedW <= 600) sidebarWidth = savedW;
  } catch {}

  // ─── Device Preview ──────────────────────────────────────────────────────
  let devicePreviewActive = false;
  let deviceFrame = null;
  const DEVICE = { name: "iPhone", w: 393, h: 780 };
  const FRAME = { w: 417, h: 876, cutoutX: 12, cutoutY: 19, statusBarH: 54 };

  // ─── Field type lookups ────────────────────────────────────────────────────
  const ENUM_PROPS = {
    "display": ["block","inline","inline-block","flex","inline-flex","grid","inline-grid","none"],
    "position": ["static","relative","absolute","fixed","sticky"],
    "text-align": ["left","center","right","justify"],
    "overflow": ["visible","hidden","scroll","auto","clip"],
    "flex-direction": ["row","row-reverse","column","column-reverse"],
    "align-items": ["stretch","flex-start","flex-end","center","baseline"],
    "justify-content": ["flex-start","flex-end","center","space-between","space-around","space-evenly"],
    "font-weight": ["100","200","300","400","500","600","700","800","900"],
    "visibility": ["visible","hidden","collapse"],
  };
  const RANGE_PROPS = {
    "opacity": { min: 0, max: 1, step: 0.01, shiftStep: 0.1 },
  };

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
    hoverEnabled = true;
    createHighlightBox();
    createPanel();
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("scroll", onScroll, true);
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
    document.removeEventListener("scroll", onScroll, true);
    if (escListener) document.removeEventListener("keydown", escListener, true);
    document.body.style.cursor = "";
    document.documentElement.classList.remove("__looker_sidebar_active__");
    if (highlightBox) { highlightBox.remove(); highlightBox = null; }
    if (hoverHighlight) { hoverHighlight.remove(); hoverHighlight = null; }
    if (panel) { panel.remove(); panel = null; }
    if (devicePreviewActive) disableDevicePreview();
  }

  // ─── Highlight box ─────────────────────────────────────────────────────────
  function elementLabel(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? "#" + el.id : "";
    const cls = el.classList.length
      ? "." + Array.from(el.classList).filter(c => !c.startsWith("__looker_")).slice(0, 2).join(".")
      : "";
    return tag + id + cls;
  }

  let hoverHighlight = null;

  function createHighlightBox() {
    highlightBox = document.createElement("div");
    highlightBox.id = "__looker_highlight__";
    highlightBox.classList.add("__looker_pinned__");
    const label = document.createElement("span");
    label.id = "__looker_highlight_label__";
    highlightBox.appendChild(label);
    document.body.appendChild(highlightBox);

    hoverHighlight = document.createElement("div");
    hoverHighlight.id = "__looker_hover_highlight__";
    const hoverLabel = document.createElement("span");
    hoverLabel.id = "__looker_hover_highlight_label__";
    hoverHighlight.appendChild(hoverLabel);
    document.body.appendChild(hoverHighlight);
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
    highlightBox.style.display = "block";
    highlightBox.classList.toggle("__looker_pinned__", !!pinnedElement);
    const label = highlightBox.querySelector("#__looker_highlight_label__");
    if (label) label.textContent = elementLabel(el);
  }

  function positionHoverHighlight(el) {
    if (!hoverHighlight || !el) return;
    if (el === pinnedElement) {
      hoverHighlight.style.display = "none";
      return;
    }
    const r = el.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    hoverHighlight.style.left = (r.left + scrollX) + "px";
    hoverHighlight.style.top = (r.top + scrollY) + "px";
    hoverHighlight.style.width = r.width + "px";
    hoverHighlight.style.height = r.height + "px";
    hoverHighlight.style.display = "block";
    const label = hoverHighlight.querySelector("#__looker_hover_highlight_label__");
    if (label) label.textContent = elementLabel(el);
  }

  function hideHoverHighlight() {
    if (hoverHighlight) hoverHighlight.style.display = "none";
  }

  // ─── Events ────────────────────────────────────────────────────────────────
  function isLookerUI(el) {
    return !el || el.id === "__looker_highlight__" || el.id === "__looker_hover_highlight__"
      || el.closest("#__looker_panel__")
      || el.closest("#__looker_device_frame__");
  }

  function onMouseMove(e) {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    if (devicePreviewActive) return;
    if (!hoverEnabled) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (isLookerUI(el)) return;

    if (pinnedElement) {
      positionHoverHighlight(el);
    } else {
      hoveredElement = el;
      positionHighlight(el);
      renderPanel(el);
    }
  }

  function onClick(e) {
    if (devicePreviewActive) return;
    if (!hoverEnabled) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (isLookerUI(el)) return;
    e.preventDefault();
    e.stopPropagation();

    if (pinnedElement === el) {
      pinnedElement = null;
      hideHoverHighlight();
      highlightBox.classList.remove("__looker_pinned__");
      document.body.style.cursor = hoverEnabled ? "crosshair" : "";
    } else {
      pinnedElement = el;
      hideHoverHighlight();
      positionHighlight(el);
      renderPanel(el);
      document.body.style.cursor = "default";
    }
  }

  let lastMouseX = 0, lastMouseY = 0;

  function onScroll() {
    if (pinnedElement) positionHighlight(pinnedElement);
    if (hoverEnabled) {
      const el = document.elementFromPoint(lastMouseX, lastMouseY);
      if (el && !isLookerUI(el)) {
        if (pinnedElement) {
          positionHoverHighlight(el);
        } else {
          hoveredElement = el;
          positionHighlight(el);
        }
      }
    }
  }

  // ─── Panel ─────────────────────────────────────────────────────────────────
  function createPanel() {
    panel = document.createElement("div");
    panel.id = "__looker_panel__";
    applySidebarWidth(sidebarWidth);
    document.documentElement.classList.add("__looker_sidebar_active__");
    panel.innerHTML = `
      <div class="__looker_resize_handle__" id="__looker_resize_handle__"></div>
      <div class="__looker_panel_header__">
        <span class="__looker_logo__">◈ Looker</span>
        <div class="__looker_header_actions__">
          <button class="__looker_copy_changes__" id="__looker_copy_changes__" title="Copy all changes as CSS">Copy Changes</button>
          <button class="__looker_icon_toggle__ __looker_hover_active__" id="__looker_hover_toggle__" title="Toggle hover inspection">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 12.5886C12 12.2698 12.25 12 12.575 12C12.7 12 12.85 12.0736 12.95 12.1471L19.8 18.1312C19.925 18.2293 20 18.3764 20 18.5236C20 18.8424 19.75 19.0631 19.425 19.0631H16.475L17.9 21.8589C18.1 22.2513 17.95 22.7173 17.55 22.9135C17.15 23.1097 16.675 22.9625 16.475 22.5701L15.025 19.7007L12.95 22.0306C12.85 22.1532 12.7 22.2023 12.55 22.2023C12.225 22.2023 12 21.9815 12 21.6627V12.5886Z" fill="currentColor"/>
              <path d="M18 5C19.0937 5 20 5.90624 20 7V17C20 17.1338 19.9853 17.264 19.9609 17.3896L19 16.5938V9H5V17C5 17.5625 5.4375 18 6 18H11.4688V19H6C4.875 19 4 18.125 4 17V7C4.00003 5.90624 4.87502 5 6 5H18ZM6 6C5.43752 6 5.00004 6.46876 5 7V8H8V6H6ZM9 8H19V7C19 6.46876 18.5312 6 18 6H9V8Z" fill="currentColor"/>
            </svg>
          </button>
          <button class="__looker_icon_toggle__" id="__looker_device_toggle__" title="Toggle device preview">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
              <line x1="12" y1="18" x2="12" y2="18"/>
            </svg>
          </button>
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
    panel.querySelector("#__looker_device_toggle__").addEventListener("click", toggleDevicePreview);
    panel.querySelector("#__looker_hover_toggle__").addEventListener("click", toggleHoverInspection);
    initResizeHandle();
  }

  function renderPanel(el) {
    if (!panel) return;
    const body = panel.querySelector("#__looker_body__");
    if (!body) return;

    const elWin = el.ownerDocument.defaultView || window;
    const cs = elWin.getComputedStyle(el);
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

    const hasParent = el.parentElement && el.parentElement !== el.ownerDocument.documentElement && el.parentElement !== el.ownerDocument.body;
    const children = Array.from(el.children).filter(c =>
      !c.id?.startsWith("__looker_") && !c.classList?.contains("__looker_highlight__")
    );

    const parentTag = hasParent ? el.parentElement.tagName.toLowerCase() : "";
    const parentId = hasParent && el.parentElement.id ? "#" + el.parentElement.id : "";
    const parentCls = hasParent && el.parentElement.classList.length
      ? "." + Array.from(el.parentElement.classList).slice(0, 1).join(".") : "";

    body.innerHTML = `
      ${section("Element", `
        <div class="__looker_dom_tree__">
          ${hasParent ? `<button class="__looker_dom_tree_item__" id="__looker_nav_parent__" title="Select parent element">
            <span class="__looker_dom_tree_tag__">&lt;${parentTag}${parentId}${parentCls}&gt;</span>
          </button>` : ""}
          <div class="__looker_dom_tree_current__">
            <span class="__looker_dom_tree_tag__">&lt;${tag}${elId}${classes}&gt;</span>
          </div>
          ${children.length ? `<div class="__looker_dom_tree_children__">
            ${children.slice(0, 12).map((c, i) => {
              const cTag = c.tagName.toLowerCase();
              const cId = c.id ? "#" + c.id : "";
              const cCls = c.classList.length ? "." + Array.from(c.classList).slice(0,1).join(".") : "";
              return `<button class="__looker_dom_tree_item__ __looker_dom_child_btn__" data-child-idx="${i}" title="Select child element">
                <span class="__looker_dom_tree_tag__">&lt;${cTag}${cId}${cCls}&gt;</span>
              </button>`;
            }).join("")}
            ${children.length > 12 ? `<span class="__looker_dom_more__">+${children.length - 12} more</span>` : ""}
          </div>` : ""}
        </div>
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
    attachDomNavHandlers(body, el, children, hasParent);
    updateCopyChangesButton();
  }

  function selectElement(el) {
    pinnedElement = el;
    positionHighlight(el);
    renderPanel(el);
    document.body.style.cursor = "default";
  }

  function attachDomNavHandlers(container, el, children, hasParent) {
    const parentBtn = container.querySelector("#__looker_nav_parent__");
    if (parentBtn && hasParent) {
      parentBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        selectElement(el.parentElement);
      });
    }
    container.querySelectorAll(".__looker_dom_child_btn__").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.childIdx, 10);
        if (children[idx]) selectElement(children[idx]);
      });
    });
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

    // Label interactions: scrub + dropdown
    container.querySelectorAll(".__looker_field_label__").forEach(lbl => {
      const fieldType = lbl.dataset.fieldtype;
      const valEl = lbl.nextElementSibling;
      if (!valEl) return;
      const cssProp = valEl.dataset.cssprop;
      if (!cssProp) return;

      if (fieldType === "numeric" || fieldType === "range") {
        lbl.addEventListener("mousedown", (e) => {
          e.preventDefault();
          startScrub(e, lbl, valEl, cssProp, targetEl, fieldType);
        });
      } else if (fieldType === "enum") {
        lbl.addEventListener("click", (e) => {
          e.stopPropagation();
          showEnumDropdown(lbl, valEl, cssProp, targetEl);
        });
      }
    });

    // Color swatch click -> color picker
    container.querySelectorAll(".__looker_color_preview__").forEach(swatch => {
      const colorField = swatch.closest(".__looker_color_field__");
      if (!colorField) return;
      const hexEl = colorField.querySelector(".__looker_color_hex__");
      if (!hexEl) return;
      const cssProp = hexEl.dataset.cssprop;
      if (!cssProp) return;
      swatch.addEventListener("click", (e) => {
        e.stopPropagation();
        showColorPicker(swatch, hexEl, cssProp, targetEl);
      });
    });
  }

  // ─── Scrub (numeric + range) ───────────────────────────────────────────────
  function startScrub(e, lbl, valEl, cssProp, targetEl, fieldType) {
    const startX = e.clientX;
    const raw = valEl.dataset.copy || valEl.textContent.trim();
    const match = raw.match(/^(-?[\d.]+)(.*)$/);
    if (!match) return;
    const startNum = parseFloat(match[1]);
    if (isNaN(startNum)) return;
    const unit = match[2] || "";
    const rangeDef = RANGE_PROPS[cssProp];

    lbl.classList.add("__looker_scrubbing__");
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev) => {
      const delta = ev.clientX - startX;
      let step, shiftStep;
      if (rangeDef) {
        step = rangeDef.step;
        shiftStep = rangeDef.shiftStep;
      } else {
        step = 1;
        shiftStep = 10;
      }
      const mult = ev.shiftKey ? shiftStep : step;
      let newVal = startNum + delta * mult;
      if (rangeDef) newVal = Math.max(rangeDef.min, Math.min(rangeDef.max, newVal));
      newVal = Math.round(newVal * 1000) / 1000;
      const newStr = newVal + unit;
      valEl.textContent = newStr;
      valEl.dataset.copy = newStr;
      applyChange(targetEl, cssProp, raw, newStr);
      positionHighlight(targetEl);
    };

    const onUp = () => {
      lbl.classList.remove("__looker_scrubbing__");
      document.body.style.cursor = pinnedElement ? "default" : "crosshair";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // ─── Enum dropdown ─────────────────────────────────────────────────────────
  let activeDropdown = null;
  let activeDropdownLabel = null;

  function dismissDropdown() {
    if (activeDropdown) { activeDropdown.remove(); activeDropdown = null; }
    activeDropdownLabel = null;
    document.removeEventListener("click", onDropdownOutsideClick, true);
  }

  function onDropdownOutsideClick(e) {
    if (activeDropdown && !activeDropdown.contains(e.target)) {
      if (activeDropdownLabel && (activeDropdownLabel === e.target || activeDropdownLabel.contains(e.target))) return;
      dismissDropdown();
    }
  }

  function showEnumDropdown(lbl, valEl, cssProp, targetEl) {
    if (activeDropdownLabel === lbl) {
      dismissDropdown();
      return;
    }
    dismissDropdown();
    const options = ENUM_PROPS[cssProp];
    if (!options) return;
    const currentVal = valEl.dataset.copy || valEl.textContent.trim();

    const dd = document.createElement("div");
    dd.className = "__looker_enum_dropdown__";
    options.forEach(opt => {
      const item = document.createElement("div");
      item.className = "__looker_enum_option__";
      if (opt === currentVal) item.classList.add("__looker_enum_active__");
      item.textContent = opt;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        applyChange(targetEl, cssProp, currentVal, opt);
        dismissDropdown();
        renderPanel(targetEl);
      });
      dd.appendChild(item);
    });

    const fieldEl = lbl.closest(".__looker_field__");
    if (!fieldEl) return;
    fieldEl.style.position = "relative";
    fieldEl.appendChild(dd);
    activeDropdown = dd;
    activeDropdownLabel = lbl;

    setTimeout(() => document.addEventListener("click", onDropdownOutsideClick, true), 0);
  }

  // ─── Color Picker ──────────────────────────────────────────────────────────
  let activeColorPicker = null;

  function dismissColorPicker() {
    if (activeColorPicker) { activeColorPicker.remove(); activeColorPicker = null; }
    document.removeEventListener("click", onPickerOutsideClick, true);
    document.removeEventListener("keydown", onPickerEscape, true);
  }

  function onPickerOutsideClick(e) {
    if (activeColorPicker && !activeColorPicker.contains(e.target)) {
      dismissColorPicker();
    }
  }

  function onPickerEscape(e) {
    if (e.key === "Escape") { dismissColorPicker(); e.stopPropagation(); }
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0, s = max === 0 ? 0 : d / max, v = max;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d + 6) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s, v };
  }

  function hsvToRgb(h, s, v) {
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255)
    };
  }

  function parseColorToRgba(color) {
    const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? parseFloat(m[4]) : 1 };
    if (/^#[0-9a-f]{6}$/i.test(color)) {
      return { r: parseInt(color.slice(1,3),16), g: parseInt(color.slice(3,5),16), b: parseInt(color.slice(5,7),16), a: 1 };
    }
    return { r: 0, g: 0, b: 0, a: 1 };
  }

  function showColorPicker(swatch, hexEl, cssProp, targetEl) {
    dismissColorPicker();
    dismissDropdown();

    const rawColor = hexEl.dataset.copy || hexEl.textContent.trim();
    const rgba = parseColorToRgba(rawColor);
    const hsv = rgbToHsv(rgba.r, rgba.g, rgba.b);
    let state = { h: hsv.h, s: hsv.s, v: hsv.v, a: rgba.a };

    const picker = document.createElement("div");
    picker.className = "__looker_color_picker__";
    picker.innerHTML = `
      <canvas class="__looker_cp_sv__" width="220" height="140"></canvas>
      <div class="__looker_cp_sliders__">
        <canvas class="__looker_cp_hue__" width="220" height="12"></canvas>
        <canvas class="__looker_cp_alpha__" width="220" height="12"></canvas>
      </div>
      <div class="__looker_cp_inputs__">
        <div class="__looker_cp_preview_swatch__"></div>
        <input class="__looker_cp_hex_input__" type="text" spellcheck="false" />
      </div>
    `;

    const colorField = swatch.closest(".__looker_color_field__");
    if (!colorField) return;
    colorField.style.position = "relative";
    colorField.appendChild(picker);
    activeColorPicker = picker;

    const svCanvas = picker.querySelector(".__looker_cp_sv__");
    const hueCanvas = picker.querySelector(".__looker_cp_hue__");
    const alphaCanvas = picker.querySelector(".__looker_cp_alpha__");
    const hexInput = picker.querySelector(".__looker_cp_hex_input__");
    const previewSwatch = picker.querySelector(".__looker_cp_preview_swatch__");

    function outputColor() {
      const rgb = hsvToRgb(state.h, state.s, state.v);
      if (state.a < 1) {
        return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.round(state.a * 100) / 100})`;
      }
      return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    }

    function hexFromState() {
      const rgb = hsvToRgb(state.h, state.s, state.v);
      return "#" + [rgb.r, rgb.g, rgb.b].map(n => n.toString(16).padStart(2, "0")).join("").toUpperCase();
    }

    function applyColor() {
      const color = outputColor();
      const hex = hexFromState();
      swatch.style.background = color;
      previewSwatch.style.background = color;
      hexInput.value = hex;
      hexEl.textContent = hex;
      hexEl.dataset.copy = color;
      applyChange(targetEl, cssProp, rawColor, color);
    }

    function drawSV() {
      const ctx = svCanvas.getContext("2d");
      const w = svCanvas.width, h = svCanvas.height;
      const hueRgb = hsvToRgb(state.h, 1, 1);
      ctx.fillStyle = `rgb(${hueRgb.r},${hueRgb.g},${hueRgb.b})`;
      ctx.fillRect(0, 0, w, h);
      const wGrad = ctx.createLinearGradient(0, 0, w, 0);
      wGrad.addColorStop(0, "rgba(255,255,255,1)");
      wGrad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = wGrad;
      ctx.fillRect(0, 0, w, h);
      const bGrad = ctx.createLinearGradient(0, 0, 0, h);
      bGrad.addColorStop(0, "rgba(0,0,0,0)");
      bGrad.addColorStop(1, "rgba(0,0,0,1)");
      ctx.fillStyle = bGrad;
      ctx.fillRect(0, 0, w, h);
      // thumb
      const tx = state.s * w, ty = (1 - state.v) * h;
      ctx.beginPath();
      ctx.arc(tx, ty, 5, 0, Math.PI * 2);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tx, ty, 4, 0, Math.PI * 2);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    function drawHue() {
      const ctx = hueCanvas.getContext("2d");
      const w = hueCanvas.width, h = hueCanvas.height;
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      for (let i = 0; i <= 6; i++) {
        const rgb = hsvToRgb(i * 60, 1, 1);
        grad.addColorStop(i / 6, `rgb(${rgb.r},${rgb.g},${rgb.b})`);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      const tx = (state.h / 360) * w;
      ctx.fillStyle = "#fff";
      ctx.fillRect(tx - 2, 0, 4, h);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.strokeRect(tx - 2, 0, 4, h);
    }

    function drawAlpha() {
      const ctx = alphaCanvas.getContext("2d");
      const w = alphaCanvas.width, h = alphaCanvas.height;
      // checkerboard
      ctx.fillStyle = "#2a2a3a";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#3a3a4a";
      for (let x = 0; x < w; x += 6) {
        for (let y = 0; y < h; y += 6) {
          if ((Math.floor(x / 6) + Math.floor(y / 6)) % 2 === 0) ctx.fillRect(x, y, 6, 6);
        }
      }
      const rgb = hsvToRgb(state.h, state.s, state.v);
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
      grad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},1)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      const tx = state.a * w;
      ctx.fillStyle = "#fff";
      ctx.fillRect(tx - 2, 0, 4, h);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.strokeRect(tx - 2, 0, 4, h);
    }

    function redraw() { drawSV(); drawHue(); drawAlpha(); }

    function canvasDrag(canvas, onDrag) {
      const handler = (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        onDrag(x, y);
      };
      canvas.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        handler(e);
        const onMove = (ev) => handler(ev);
        const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    }

    canvasDrag(svCanvas, (x, y) => {
      state.s = x;
      state.v = 1 - y;
      redraw();
      applyColor();
    });

    canvasDrag(hueCanvas, (x) => {
      state.h = x * 360;
      redraw();
      applyColor();
    });

    canvasDrag(alphaCanvas, (x) => {
      state.a = x;
      redraw();
      applyColor();
    });

    hexInput.value = hexFromState();
    hexInput.addEventListener("input", () => {
      const val = hexInput.value.trim();
      if (/^#?[0-9a-f]{6}$/i.test(val)) {
        const hex = val.startsWith("#") ? val : "#" + val;
        const rgba2 = parseColorToRgba(hex);
        const hsv2 = rgbToHsv(rgba2.r, rgba2.g, rgba2.b);
        state.h = hsv2.h; state.s = hsv2.s; state.v = hsv2.v;
        redraw();
        applyColor();
      }
    });
    hexInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { dismissColorPicker(); e.preventDefault(); }
      if (e.key === "Escape") { dismissColorPicker(); e.preventDefault(); }
      e.stopPropagation();
    });
    hexInput.addEventListener("click", (e) => e.stopPropagation());

    previewSwatch.style.background = outputColor();
    redraw();

    setTimeout(() => {
      document.addEventListener("click", onPickerOutsideClick, true);
      document.addEventListener("keydown", onPickerEscape, true);
    }, 0);
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

        const rules = getClassRules(className, targetEl.ownerDocument);
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

  function getClassRules(className, doc) {
    const targetDoc = doc || document;
    const results = [];
    try {
      for (const sheet of targetDoc.styleSheets) {
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

  function applySidebarWidth(w) {
    sidebarWidth = Math.max(200, Math.min(600, w));
    if (panel) panel.style.width = sidebarWidth + "px";
    document.documentElement.style.setProperty("--__looker-sidebar-w", sidebarWidth + "px");
  }

  // ─── Hover Inspection Toggle ────────────────────────────────────────────────
  function toggleHoverInspection() {
    hoverEnabled = !hoverEnabled;
    const btn = panel.querySelector("#__looker_hover_toggle__");
    btn.classList.toggle("__looker_hover_active__", hoverEnabled);

    if (!hoverEnabled) {
      if (!pinnedElement && highlightBox) {
        highlightBox.style.display = "none";
      }
      hideHoverHighlight();
      if (!iframePinnedElement && iframeHighlight) {
        iframeHighlight.style.display = "none";
      }
      document.body.style.cursor = "";
      try {
        const iframe = document.getElementById("__looker_device_iframe__");
        if (iframe?.contentDocument?.body) iframe.contentDocument.body.style.cursor = "";
      } catch {}
    } else {
      if (highlightBox) highlightBox.style.display = "";
      if (iframeHighlight) iframeHighlight.style.display = "";
      if (!pinnedElement) document.body.style.cursor = "crosshair";
      try {
        const iframe = document.getElementById("__looker_device_iframe__");
        if (iframe?.contentDocument?.body && !iframePinnedElement) {
          iframe.contentDocument.body.style.cursor = "crosshair";
        }
      } catch {}
    }
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

    const toggleBtn = document.getElementById("__looker_device_toggle__");
    if (toggleBtn) toggleBtn.classList.add("__looker_device_active__");

    createDeviceFrame();
    applyDeviceSize();
    showToast(`${DEVICE.name} preview`);
  }

  function disableDevicePreview() {
    devicePreviewActive = false;

    const toggleBtn = document.getElementById("__looker_device_toggle__");
    if (toggleBtn) toggleBtn.classList.remove("__looker_device_active__");

    removeDeviceFrame();
    showToast("Device preview off");
  }

  let iframeHighlight = null;
  let iframePinnedElement = null;
  let iframeCleanup = null;

  function createDeviceFrame() {
    removeDeviceFrame();
    deviceFrame = document.createElement("div");
    deviceFrame.id = "__looker_device_frame__";

    const frameSrc = chrome.runtime.getURL("assets/iphone-frame.png");
    deviceFrame.innerHTML = `
      <iframe id="__looker_device_iframe__" src="${window.location.href}"></iframe>
      <img class="__looker_device_frame_img__" src="${frameSrc}" draggable="false" />
    `;
    document.body.appendChild(deviceFrame);
    document.documentElement.classList.add("__looker_device_mode__");

    const iframe = deviceFrame.querySelector("#__looker_device_iframe__");

    iframe.addEventListener("load", () => {
      try {
        const idoc = iframe.contentDocument;
        if (!idoc || !idoc.body) return;
        const style = idoc.createElement("style");
        style.textContent = `html { padding-top: ${FRAME.statusBarH}px !important; }`;
        idoc.head.appendChild(style);
        initIframeInspection(idoc);
      } catch {}
    });
  }

  function initIframeInspection(idoc) {
    iframeHighlight = idoc.createElement("div");
    iframeHighlight.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;" +
      "outline:1px dashed #18a0fb;outline-offset:-1px;background:rgba(24,160,251,0.04);" +
      "border-radius:2px;transition:outline 0.08s ease,background 0.08s ease;display:none;";
    const iframeLabel = idoc.createElement("span");
    iframeLabel.style.cssText = "position:absolute;bottom:100%;left:-1px;background:#18a0fb;color:#fff;" +
      "font-family:'JetBrains Mono','Fira Code','SF Mono',monospace;font-size:10px;line-height:1;" +
      "padding:3px 6px;border-radius:3px 3px 0 0;white-space:nowrap;max-width:200px;" +
      "overflow:hidden;text-overflow:ellipsis;pointer-events:none;";
    iframeLabel.id = "__looker_iframe_highlight_label__";
    iframeHighlight.appendChild(iframeLabel);
    idoc.body.appendChild(iframeHighlight);
    idoc.body.style.cursor = "crosshair";

    function updateIframeLabel(el) {
      const lbl = iframeHighlight.querySelector("#__looker_iframe_highlight_label__");
      if (lbl) lbl.textContent = elementLabel(el);
    }

    function onIframeMove(e) {
      if (!hoverEnabled) return;
      if (iframePinnedElement) return;
      const el = idoc.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === iframeHighlight) return;
      positionIframeHighlight(el, idoc);
      updateIframeLabel(el);
      renderPanel(el);
    }

    function onIframeClick(e) {
      if (!hoverEnabled) return;
      const el = idoc.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === iframeHighlight) return;
      e.preventDefault();
      e.stopPropagation();

      if (iframePinnedElement === el) {
        iframePinnedElement = null;
        idoc.body.style.cursor = hoverEnabled ? "crosshair" : "";
        iframeHighlight.style.outline = "1px dashed #18a0fb";
        iframeHighlight.style.background = "rgba(24,160,251,0.04)";
      } else {
        iframePinnedElement = el;
        idoc.body.style.cursor = "default";
        positionIframeHighlight(el, idoc);
        updateIframeLabel(el);
        renderPanel(el);
        iframeHighlight.style.outline = "2px solid #18a0fb";
        iframeHighlight.style.background = "rgba(24,160,251,0.06)";
      }
    }

    idoc.addEventListener("mousemove", onIframeMove, true);
    idoc.addEventListener("click", onIframeClick, true);

    iframeCleanup = () => {
      try {
        idoc.removeEventListener("mousemove", onIframeMove, true);
        idoc.removeEventListener("click", onIframeClick, true);
        if (iframeHighlight && iframeHighlight.parentNode) iframeHighlight.remove();
      } catch {}
    };
  }

  function positionIframeHighlight(el, idoc) {
    if (!iframeHighlight) return;
    try {
      const r = el.getBoundingClientRect();
      iframeHighlight.style.display = "block";
      iframeHighlight.style.left = r.left + "px";
      iframeHighlight.style.top = r.top + "px";
      iframeHighlight.style.width = r.width + "px";
      iframeHighlight.style.height = r.height + "px";
    } catch {}
  }

  function removeDeviceFrame() {
    if (iframeCleanup) { iframeCleanup(); iframeCleanup = null; }
    if (deviceFrame) { deviceFrame.remove(); deviceFrame = null; }
    iframeHighlight = null;
    iframePinnedElement = null;
    document.documentElement.classList.remove("__looker_device_mode__");
  }

  function applyDeviceSize() {
    if (!deviceFrame) return;
    deviceFrame.style.width = FRAME.w + "px";
    deviceFrame.style.height = FRAME.h + "px";

    const panelWidth = sidebarWidth;
    const maxW = window.innerWidth - panelWidth;
    const maxH = window.innerHeight - 40;
    const scale = Math.min(1, maxW / FRAME.w, maxH / FRAME.h);
    const panelOffset = Math.round(sidebarWidth / 2);
    deviceFrame.style.left = `calc(50% - ${panelOffset}px)`;
    deviceFrame.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function section(title, content) {
    return `
      <div class="__looker_section__">
        <div class="__looker_section_title__">${title}</div>
        <div class="__looker_section_content__">${content}</div>
      </div>`;
  }

  function classifyField(cssProp, value) {
    if (cssProp && RANGE_PROPS[cssProp]) return "range";
    if (cssProp && ENUM_PROPS[cssProp]) return "enum";
    if (value && /^-?[\d.]+/.test(value)) return "numeric";
    return "";
  }

  function field(label, value, cssProp, full) {
    if (!value || value === "" || value === "undefined") return "";
    const propAttr = cssProp ? ` data-cssprop="${cssProp}"` : "";
    const isChanged = cssProp && pinnedElement && changedStyles.has(pinnedElement)
      && changedStyles.get(pinnedElement).has(cssProp);
    const changedClass = isChanged ? " __looker_val_changed__" : "";
    const fullClass = full ? " __looker_field_full__" : "";
    const fieldType = classifyField(cssProp, value);
    const labelAttrs = [];
    if (fieldType === "numeric" || fieldType === "range") labelAttrs.push('data-scrub');
    if (fieldType === "enum") labelAttrs.push('data-enum');
    if (fieldType) labelAttrs.push(`data-fieldtype="${fieldType}"`);
    return `
      <div class="__looker_field__${fullClass}">
        <span class="__looker_field_label__" ${labelAttrs.join(" ")}>${label}</span>
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
