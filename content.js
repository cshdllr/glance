(() => {
  if (window.__glanceInjected) {
    // Already injected — just toggle
    window.__glanceToggle();
    return;
  }
  window.__glanceInjected = true;

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
    const savedW = parseInt(localStorage.getItem("__glance_sidebar_w__"), 10);
    if (savedW >= 200 && savedW <= 600) sidebarWidth = savedW;
  } catch {}

  let themeMode = "system";
  try {
    const saved = localStorage.getItem("__glance_theme__");
    if (saved === "light" || saved === "dark") themeMode = saved;
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
    "flex-wrap": ["nowrap","wrap","wrap-reverse"],
    "align-self": ["auto","stretch","flex-start","flex-end","center","baseline"],
    "justify-items": ["stretch","start","end","center","baseline"],
    "overflow-x": ["visible","hidden","scroll","auto","clip"],
    "overflow-y": ["visible","hidden","scroll","auto","clip"],
    "font-weight": ["100","200","300","400","500","600","700","800","900"],
    "visibility": ["visible","hidden","collapse"],
  };
  const RANGE_PROPS = {
    "opacity": { min: 0, max: 1, step: 0.01, shiftStep: 0.1 },
  };
  // CSS properties whose numeric values are unitless (no "px" suffix needed)
  const UNITLESS_PROPS = new Set(["opacity", "z-index", "line-height", "flex-grow", "flex-shrink", "flex", "order", "column-count", "font-weight"]);

  let localFontsLoaded = false;
  function loadLocalFonts() {
    if (localFontsLoaded) return;
    localFontsLoaded = true;

    const COMMON_FONTS = [
      "Arial", "Arial Black", "Arial Narrow", "Arial Rounded MT Bold",
      "Avenir", "Avenir Next", "Baskerville", "Big Caslon",
      "Bodoni 72", "Book Antiqua", "Bookman Old Style",
      "Bradley Hand", "Brush Script MT",
      "Calibri", "Cambria", "Candara", "Century Gothic", "Century Schoolbook",
      "Chalkboard", "Chalkboard SE", "Charter", "Cochin", "Comic Sans MS",
      "Consolas", "Constantia", "Copperplate", "Corbel", "Courier", "Courier New",
      "DIN Alternate", "DIN Condensed", "Damascus",
      "DejaVu Sans", "DejaVu Sans Mono", "DejaVu Serif", "Didot",
      "Franklin Gothic Medium", "Futura",
      "Garamond", "Geneva", "Georgia", "Gill Sans", "Goudy Old Style",
      "Helvetica", "Helvetica Neue", "Herculanum", "Hoefler Text",
      "Impact", "Inter",
      "JetBrains Mono",
      "Kefa", "Kohinoor Devanagari",
      "Lucida Console", "Lucida Grande", "Lucida Sans Unicode", "Luminari",
      "Marker Felt", "Menlo", "Microsoft Sans Serif", "Monaco", "Monospace",
      "Noteworthy", "Noto Sans", "Noto Serif",
      "Optima", "Osaka",
      "PT Mono", "PT Sans", "PT Serif", "Palatino", "Palatino Linotype", "Papyrus",
      "Phosphate", "Plantagenet Cherokee",
      "Roboto", "Roboto Mono", "Rockwell",
      "SF Mono", "SF Pro", "SF Pro Display", "SF Pro Rounded", "SF Pro Text",
      "Savoye LET", "Segoe UI", "SignPainter", "Skia", "Snell Roundhand",
      "Tahoma", "Times", "Times New Roman", "Trebuchet MS",
      "Ubuntu", "Ubuntu Mono",
      "Verdana",
      "Zapfino",
      "system-ui", "sans-serif", "serif", "monospace", "cursive", "fantasy"
    ];

    const detected = new Set();
    document.fonts.forEach(f => detected.add(f.family.replace(/['"]/g, "")));

    const testStr = "mmmmmmmmmmlli";
    const span = document.createElement("span");
    span.style.cssText = "position:absolute;left:-9999px;top:-9999px;font-size:72px;visibility:hidden;";
    document.body.appendChild(span);

    const baselines = {};
    ["monospace", "sans-serif", "serif"].forEach(base => {
      span.style.fontFamily = base;
      baselines[base] = span.offsetWidth;
    });

    COMMON_FONTS.forEach(font => {
      if (detected.has(font)) return;
      for (const base of ["monospace", "sans-serif", "serif"]) {
        span.textContent = testStr;
        span.style.fontFamily = `"${font}", ${base}`;
        if (span.offsetWidth !== baselines[base]) {
          detected.add(font);
          break;
        }
      }
    });

    span.remove();
    ENUM_PROPS["font-family"] = [...detected].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }

  window.__glanceToggle = function() {
    inspectorActive ? deactivate() : activate();
  };

  // Also listen for messages from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TOGGLE_INSPECTOR") window.__glanceToggle();
  });

  // ─── Activate ──────────────────────────────────────────────────────────────
  function activate() {
    inspectorActive = true;
    hoverEnabled = true;
    loadLocalFonts();
    createHighlightBox();
    createPanel();
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseleave", onMouseLeave);
    document.addEventListener("click", onClick, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("scroll", onScroll);
      window.visualViewport.addEventListener("resize", onScroll);
    }
    escListener = (e) => { if (e.key === "Escape") deactivate(); };
    document.addEventListener("keydown", escListener, true);
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onSystemThemeChange);
    }
    document.body.style.cursor = "crosshair";
    pushSidebar();
    showToast("Glance active — hover to inspect, click to pin");
  }

  // ─── Deactivate ────────────────────────────────────────────────────────────
  function deactivate() {
    inspectorActive = false;
    pinnedElement = null;
    hoveredElement = null;
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("mouseleave", onMouseLeave);
    document.removeEventListener("click", onClick, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener("scroll", onScroll);
      window.visualViewport.removeEventListener("resize", onScroll);
    }
    stopHighlightLoop();
    if (escListener) document.removeEventListener("keydown", escListener, true);
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").removeEventListener("change", onSystemThemeChange);
    }
    document.body.style.cursor = "";
    document.documentElement.classList.remove("__glance_sidebar_active__");
    document.documentElement.style.removeProperty("--__glance-sidebar-w");
    revertSidebarPush();
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
      ? "." + Array.from(el.classList).filter(c => !c.startsWith("__glance_")).slice(0, 2).join(".")
      : "";
    return tag + id + cls;
  }

  let hoverHighlight = null;

  function createHighlightBox() {
    highlightBox = document.createElement("div");
    highlightBox.id = "__glance_highlight__";
    highlightBox.classList.add("__glance_pinned__");
    const label = document.createElement("span");
    label.id = "__glance_highlight_label__";
    highlightBox.appendChild(label);
    document.body.appendChild(highlightBox);

    hoverHighlight = document.createElement("div");
    hoverHighlight.id = "__glance_hover_highlight__";
    const hoverLabel = document.createElement("span");
    hoverLabel.id = "__glance_hover_highlight_label__";
    hoverHighlight.appendChild(hoverLabel);
    document.body.appendChild(hoverHighlight);
  }

  function positionHighlight(el) {
    if (!highlightBox || !el) return;
    const r = el.getBoundingClientRect();
    highlightBox.style.left = r.left + "px";
    highlightBox.style.top = r.top + "px";
    highlightBox.style.width = r.width + "px";
    highlightBox.style.height = r.height + "px";
    highlightBox.style.display = "block";
    highlightBox.classList.toggle("__glance_pinned__", !!pinnedElement);
    const label = highlightBox.querySelector("#__glance_highlight_label__");
    if (label) label.textContent = elementLabel(el);
  }

  function positionHoverHighlight(el) {
    if (!hoverHighlight || !el) return;
    if (el === pinnedElement) {
      hoverHighlight.style.display = "none";
      return;
    }
    const r = el.getBoundingClientRect();
    hoverHighlight.style.left = r.left + "px";
    hoverHighlight.style.top = r.top + "px";
    hoverHighlight.style.width = r.width + "px";
    hoverHighlight.style.height = r.height + "px";
    hoverHighlight.style.display = "block";
    const label = hoverHighlight.querySelector("#__glance_hover_highlight_label__");
    if (label) label.textContent = elementLabel(el);
  }

  function hideHoverHighlight() {
    if (hoverHighlight) hoverHighlight.style.display = "none";
  }

  // ─── Events ────────────────────────────────────────────────────────────────
  function isGlanceUI(el) {
    return !el || el.id === "__glance_highlight__" || el.id === "__glance_hover_highlight__"
      || el.closest("#__glance_panel__")
      || el.closest("#__glance_device_frame__");
  }

  function onMouseLeave() {
    hideHoverHighlight();
    if (!pinnedElement && highlightBox) {
      highlightBox.style.display = "none";
    }
  }

  function onMouseMove(e) {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    if (devicePreviewActive) return;
    if (!hoverEnabled) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (isGlanceUI(el)) {
      hideHoverHighlight();
      return;
    }

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
    if (isGlanceUI(el)) return;
    e.preventDefault();
    e.stopPropagation();

    if (pinnedElement === el) {
      pinnedElement = null;
      stopHighlightLoop();
      hideHoverHighlight();
      highlightBox.classList.remove("__glance_pinned__");
      document.body.style.cursor = hoverEnabled ? "crosshair" : "";
    } else {
      pinnedElement = el;
      startHighlightLoop();
      hideHoverHighlight();
      positionHighlight(el);
      renderPanel(el);
      document.body.style.cursor = "default";
    }
  }

  let lastMouseX = 0, lastMouseY = 0;

  function startHighlightLoop() {}
  function stopHighlightLoop() {}

  function onScroll() {
    if (pinnedElement) positionHighlight(pinnedElement);
    if (hoverEnabled) {
      const el = document.elementFromPoint(lastMouseX, lastMouseY);
      if (el && !isGlanceUI(el)) {
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
    panel.id = "__glance_panel__";
    applySidebarWidth(sidebarWidth);
    document.documentElement.classList.add("__glance_sidebar_active__");
    panel.innerHTML = `
      <div class="__glance_resize_handle__" id="__glance_resize_handle__"></div>
      <div class="__glance_panel_header__">
        <div class="__glance_header_left__">
          <button class="__glance_icon_toggle__ __glance_hover_active__" id="__glance_hover_toggle__" title="Toggle hover inspection">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 12.5886C12 12.2698 12.25 12 12.575 12C12.7 12 12.85 12.0736 12.95 12.1471L19.8 18.1312C19.925 18.2293 20 18.3764 20 18.5236C20 18.8424 19.75 19.0631 19.425 19.0631H16.475L17.9 21.8589C18.1 22.2513 17.95 22.7173 17.55 22.9135C17.15 23.1097 16.675 22.9625 16.475 22.5701L15.025 19.7007L12.95 22.0306C12.85 22.1532 12.7 22.2023 12.55 22.2023C12.225 22.2023 12 21.9815 12 21.6627V12.5886Z" fill="currentColor"/>
              <path d="M18 5C19.0937 5 20 5.90624 20 7V17C20 17.1338 19.9853 17.264 19.9609 17.3896L19 16.5938V9H5V17C5 17.5625 5.4375 18 6 18H11.4688V19H6C4.875 19 4 18.125 4 17V7C4.00003 5.90624 4.87502 5 6 5H18ZM6 6C5.43752 6 5.00004 6.46876 5 7V8H8V6H6ZM9 8H19V7C19 6.46876 18.5312 6 18 6H9V8Z" fill="currentColor"/>
            </svg>
          </button>
          <button class="__glance_icon_toggle__" id="__glance_device_toggle__" title="Toggle device preview">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
              <line x1="12" y1="18" x2="12" y2="18"/>
            </svg>
          </button>
          <button class="__glance_icon_toggle__" id="__glance_theme_toggle__" title="Theme: system"></button>
        </div>
        <div class="__glance_header_right__">
          <button class="__glance_copy_changes__" id="__glance_copy_changes__" title="Copy all changes as CSS">Copy Changes</button>
          <button class="__glance_close__" title="Close (Esc)">✕</button>
        </div>
      </div>
      <div class="__glance_panel_body__" id="__glance_body__">
        <div class="__glance_empty__">Hover over any element</div>
      </div>
    `;
    document.body.appendChild(panel);
    panel.querySelector(".__glance_close__").addEventListener("click", deactivate);
    panel.querySelector("#__glance_copy_changes__").addEventListener("click", copyAllChanges);
    panel.querySelector("#__glance_device_toggle__").addEventListener("click", toggleDevicePreview);
    panel.querySelector("#__glance_hover_toggle__").addEventListener("click", toggleHoverInspection);
    panel.querySelector("#__glance_theme_toggle__").addEventListener("click", toggleTheme);
    initResizeHandle();
    applyTheme();
  }

  function renderPanel(el) {
    if (!panel) return;
    const body = panel.querySelector("#__glance_body__");
    if (!body) return;

    const elWin = el.ownerDocument.defaultView || window;
    const cs = elWin.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const classList = Array.from(el.classList);

    const hasParent = el.parentElement && el.parentElement !== el.ownerDocument.documentElement && el.parentElement !== el.ownerDocument.body;
    const children = Array.from(el.children).filter(c =>
      !c.id?.startsWith("__glance_") && !c.classList?.contains("__glance_highlight__")
    );

    const parentTag = hasParent ? el.parentElement.tagName.toLowerCase() : "";
    const childTag = children.length ? children[0].tagName.toLowerCase() : "";

    body.innerHTML = `
      ${section("Typography", `
        ${propRow("Font", shortFont(cs.fontFamily), "font-family", "enum")}
        ${propRow("Size", cs.fontSize, "font-size", "numeric")}
        ${propRow("Line", cs.lineHeight, "line-height", "numeric")}
        ${propRow("Weight", cs.fontWeight, "font-weight", "enum")}
        ${propRowColor("Color", cs.color, "color")}
      `)}

      ${section("Layout", (() => {
        const isFlex = cs.display.includes("flex");
        const parentCs = hasParent ? elWin.getComputedStyle(el.parentElement) : null;
        const parentIsFlex = parentCs && parentCs.display.includes("flex");
        return `
        ${propRow("Width", px(rect.width), "width", "numeric")}
        ${propRow("Height", px(rect.height), "height", "numeric")}
        ${propRow("Display", cs.display, "display", "enum")}
        ${isFlex ? propRow("Direction", cs.flexDirection, "flex-direction", "enum") : ""}
        ${isFlex ? propRow("Wrap", cs.flexWrap, "flex-wrap", "enum") : ""}
        ${isFlex ? propRow("Align", cs.alignItems, "align-items", "enum") : ""}
        ${isFlex ? propRow("Justify", cs.justifyContent, "justify-content", "enum") : ""}
        ${isFlex && cs.gap !== "normal" && cs.gap !== "0px" ? propRow("Gap", cs.gap, "gap", "numeric") : ""}
        ${parentIsFlex ? propRow("Align Self", cs.alignSelf, "align-self", "enum") : ""}
        ${propRow("Position", cs.position, "position", "enum")}
        ${propRow("Overflow X", cs.overflowX, "overflow-x", "enum")}
        ${propRow("Overflow Y", cs.overflowY, "overflow-y", "enum")}
        `;
      })())}

      ${section("Spacing", `
        <div class="__glance_spacing_group__" data-shorthand="margin" data-top="${stripPx(cs.marginTop)}" data-right="${stripPx(cs.marginRight)}" data-bottom="${stripPx(cs.marginBottom)}" data-left="${stripPx(cs.marginLeft)}">
          <div class="__glance_subsection_label__">margin</div>
          <div class="__glance_paired_row__">
            ${propRow("Top", cs.marginTop, "margin-top", "numeric")}
            ${propRow("Bottom", cs.marginBottom, "margin-bottom", "numeric")}
          </div>
          <div class="__glance_paired_row__">
            ${propRow("Left", cs.marginLeft, "margin-left", "numeric")}
            ${propRow("Right", cs.marginRight, "margin-right", "numeric")}
          </div>
        </div>
        <div class="__glance_spacing_group__" data-shorthand="padding" data-top="${stripPx(cs.paddingTop)}" data-right="${stripPx(cs.paddingRight)}" data-bottom="${stripPx(cs.paddingBottom)}" data-left="${stripPx(cs.paddingLeft)}">
          <div class="__glance_subsection_label__">padding</div>
          <div class="__glance_paired_row__">
            ${propRow("Top", cs.paddingTop, "padding-top", "numeric")}
            ${propRow("Bottom", cs.paddingBottom, "padding-bottom", "numeric")}
          </div>
          <div class="__glance_paired_row__">
            ${propRow("Left", cs.paddingLeft, "padding-left", "numeric")}
            ${propRow("Right", cs.paddingRight, "padding-right", "numeric")}
          </div>
        </div>
        ${propRow("Border", cs.borderTopWidth, "border-top-width", "numeric")}
      `)}

      ${section("Appearance", `
        ${propRow("Opacity", cs.opacity, "opacity", "numeric")}
        ${propRow("Radius", cs.borderRadius === "0px" ? "0" : cs.borderRadius, "border-radius", "numeric")}
      `)}

      ${section("Element", (() => {
        const parentLabel = hasParent ? elementLabel(el.parentElement) : "";
        const selfLabel = elementLabel(el);
        const childEls = children.slice(0, 8);
        return `
        <div class="__glance_dom_nav__">
          ${hasParent ? `<div class="__glance_dom_item__ __glance_dom_parent__" data-nav="parent">${parentLabel}</div>` : ""}
          <div class="__glance_dom_item__ __glance_dom_current__">${selfLabel}</div>
          ${childEls.map((c, i) =>
            `<div class="__glance_dom_item__ __glance_dom_child__" data-nav="child" data-child-idx="${i}">${elementLabel(c)}</div>`
          ).join("")}
          ${children.length > 8 ? `<div class="__glance_dom_item__ __glance_dom_child__ __glance_dom_more__">… ${children.length - 8} more</div>` : ""}
        </div>
        ${classList.length ? `
          <div class="__glance_classes__">
            ${classList.map(c => `
              <button class="__glance_class_pill__" data-classname="${c}">.${c}</button>
            `).join("")}
          </div>
          <div class="__glance_class_details__" id="__glance_class_details__"></div>
        ` : ""}
        `;
      })())}
    `;

    attachPropRowHandlers(body, el);
    attachRowCopyHandlers(body);
    attachClassPillHandlers(body, el);
    attachDomNavHandlers(body, el, children, hasParent);
    updateCopyChangesButton();
  }

  function selectElement(el) {
    const isIframeEl = el.ownerDocument !== document;
    if (isIframeEl) {
      iframePinnedElement = el;
      const idoc = el.ownerDocument;
      positionIframeHighlight(el, idoc);
      if (iframeHighlight) {
        iframeHighlight.style.outline = "2px solid #18a0fb";
        iframeHighlight.style.background = "rgba(24,160,251,0.06)";
      }
      idoc.body.style.cursor = "default";
    } else {
      pinnedElement = el;
      startHighlightLoop();
      positionHighlight(el);
      document.body.style.cursor = "default";
    }
    renderPanel(el);
  }

  function showRowCopied(el) {
    el.querySelectorAll(".__glance_row_copied__").forEach(e => e.remove());
    const badge = document.createElement("span");
    badge.className = "__glance_row_copied__";
    badge.textContent = "Copied";
    el.style.position = "relative";
    el.appendChild(badge);
    badge.addEventListener("animationend", () => badge.remove());
  }

  function attachRowCopyHandlers(container) {
    container.querySelectorAll(".__glance_spacing_group__").forEach(group => {
      const prop = group.dataset.shorthand;
      const subsectionLabel = group.querySelector(".__glance_subsection_label__");

      const copyGroup = (e) => {
        if (e.target.closest(".__glance_prop_value__") || e.target.closest(".__glance_edit_input__")) return;
        if (Date.now() - lastDragEndTime < 100) return;
        e.stopPropagation();
        const t = group.dataset.top || "0";
        const r = group.dataset.right || "0";
        const b = group.dataset.bottom || "0";
        const l = group.dataset.left || "0";
        const addPx = (v) => v === "0" ? "0" : v + "px";
        const text = `${prop}: ${addPx(t)} ${addPx(r)} ${addPx(b)} ${addPx(l)};`;
        navigator.clipboard.writeText(text).catch(() => {});
        showRowCopied(group);
      };

      group.addEventListener("click", copyGroup);

      group.querySelectorAll(".__glance_prop_row__").forEach(row => {
        row.removeAttribute("style");
        row.addEventListener("click", (e) => {
          if (e.target.closest(".__glance_prop_value__") || e.target.closest(".__glance_edit_input__")) return;
          e.stopPropagation();
          copyGroup(e);
        });
      });
    });

    container.querySelectorAll(".__glance_prop_row__").forEach(row => {
      if (row.closest(".__glance_spacing_group__")) return;
      const valEl = row.querySelector(".__glance_prop_value__");
      if (!valEl) return;
      const cssProp = valEl.dataset.cssprop;
      if (!cssProp) return;

      row.addEventListener("click", (e) => {
        if (e.target.closest(".__glance_prop_value__") || e.target.closest(".__glance_edit_input__")) return;
        if (Date.now() - lastDragEndTime < 100) return;
        e.stopPropagation();
        const val = valEl.dataset.copy || valEl.textContent.trim();
        const text = `${cssProp}: ${val};`;
        navigator.clipboard.writeText(text).catch(() => {});
        showRowCopied(row);
      });
    });
  }

  function attachDomNavHandlers(container, el, children, hasParent) {
    container.querySelectorAll(".__glance_dom_item__[data-nav]").forEach(item => {
      const nav = item.dataset.nav;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        if (nav === "parent" && hasParent) {
          selectElement(el.parentElement);
        } else if (nav === "child") {
          const idx = parseInt(item.dataset.childIdx || "0", 10);
          if (children[idx]) selectElement(children[idx]);
        }
      });
    });

    const currentItem = container.querySelector(".__glance_dom_current__");
    if (currentItem) {
      currentItem.addEventListener("click", (e) => {
        e.stopPropagation();
        const text = currentItem.textContent.trim();
        if (!text) return;
        navigator.clipboard.writeText(text).catch(() => {});
        currentItem.classList.add("__glance_copied__");
        setTimeout(() => currentItem.classList.remove("__glance_copied__"), 800);
      });
    }
  }

  const DRAG_THRESHOLD = 3;
  let lastDragEndTime = 0;

  function attachPropRowHandlers(container, targetEl) {
    container.querySelectorAll(".__glance_prop_row__").forEach(row => {
      const valEl = row.querySelector(".__glance_prop_value__");
      if (!valEl) return;
      const cssProp = valEl.dataset.cssprop;
      const fieldType = row.dataset.fieldtype || "";

      if (fieldType === "color") {
        const swatch = row.querySelector(".__glance_color_preview__");
        valEl.addEventListener("click", (e) => {
          e.stopPropagation();
          if (swatch && cssProp) showColorPicker(swatch, valEl, cssProp, targetEl);
        });
        if (swatch) {
          swatch.addEventListener("click", (e) => {
            e.stopPropagation();
            if (cssProp) showColorPicker(swatch, valEl, cssProp, targetEl);
          });
        }
        return;
      }

      if ((fieldType === "numeric" || fieldType === "range") && cssProp) {
        valEl.style.cursor = "ew-resize";
        valEl.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const startX = e.clientX;
          let dragged = false;
          const raw = valEl.dataset.copy || valEl.textContent.trim();
          const match = raw.match(/^(-?[\d.]+)(.*)$/);
          const startNum = match ? parseFloat(match[1]) : NaN;
          const unit = match ? (match[2] || (UNITLESS_PROPS.has(cssProp) ? "" : "px")) : "";
          const rangeDef = RANGE_PROPS[cssProp];

          const onMove = (ev) => {
            const dx = ev.clientX - startX;
            if (!dragged && Math.abs(dx) >= DRAG_THRESHOLD) dragged = true;
            if (!dragged || isNaN(startNum)) return;
            document.body.style.cursor = "ew-resize";
            document.body.style.userSelect = "none";
            let step, shiftStep;
            if (rangeDef) { step = rangeDef.step; shiftStep = rangeDef.shiftStep; }
            else { step = 1; shiftStep = 10; }
            const mult = ev.shiftKey ? shiftStep : step;
            let newVal = startNum + dx * mult;
            if (rangeDef) newVal = Math.max(rangeDef.min, Math.min(rangeDef.max, newVal));
            newVal = Math.round(newVal * 1000) / 1000;
            const newStr = newVal + unit;
            valEl.textContent = newStr;
            valEl.dataset.copy = newStr;
            applyChange(targetEl, cssProp, raw, newStr);
            positionHighlight(targetEl);
          };
          const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            document.body.style.cursor = pinnedElement ? "default" : "crosshair";
            document.body.style.userSelect = "";
            if (dragged) { lastDragEndTime = Date.now(); }
            else { startEditing(valEl, cssProp, targetEl); }
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        });
        return;
      }

      if (fieldType === "enum" && cssProp) {
        valEl.style.cursor = "pointer";
        valEl.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const startX = e.clientX;
          let dragged = false;
          const options = ENUM_PROPS[cssProp];
          if (!options) { return; }
          const startVal = valEl.dataset.copy || valEl.textContent.trim();
          let startIdx = options.indexOf(startVal);
          if (startIdx < 0) startIdx = 0;
          let lastIdx = startIdx;

          const onMove = (ev) => {
            const dx = ev.clientX - startX;
            if (!dragged && Math.abs(dx) >= DRAG_THRESHOLD) dragged = true;
            if (!dragged) return;
            document.body.style.cursor = "ew-resize";
            document.body.style.userSelect = "none";
            const step = Math.round(dx / 30);
            let newIdx = startIdx + step;
            newIdx = Math.max(0, Math.min(options.length - 1, newIdx));
            if (newIdx !== lastIdx) {
              lastIdx = newIdx;
              const newVal = options[newIdx];
              valEl.textContent = newVal;
              valEl.dataset.copy = newVal;
              applyChange(targetEl, cssProp, startVal, newVal);
              positionHighlight(targetEl);
            }
          };
          const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            document.body.style.cursor = pinnedElement ? "default" : "crosshair";
            document.body.style.userSelect = "";
            if (dragged) { lastDragEndTime = Date.now(); }
            else { showEnumDropdown(row, valEl, cssProp, targetEl); }
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        });
        return;
      }

      valEl.addEventListener("click", (e) => {
        e.stopPropagation();
        if (valEl.querySelector(".__glance_edit_input__")) return;
        navigator.clipboard.writeText(valEl.dataset.copy || valEl.textContent.trim()).catch(() => {});
        valEl.classList.add("__glance_copied__");
        setTimeout(() => valEl.classList.remove("__glance_copied__"), 800);
      });
    });
  }

  // startScrub removed — scrubbing is handled inline in attachPropRowHandlers

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

  function showEnumDropdown(rowOrLabel, valEl, cssProp, targetEl) {
    const fieldEl = rowOrLabel.closest(".__glance_prop_row__") || rowOrLabel;
    if (activeDropdownLabel === fieldEl) {
      dismissDropdown();
      return;
    }
    dismissDropdown();
    const options = ENUM_PROPS[cssProp];
    if (!options) return;
    const currentVal = valEl.dataset.copy || valEl.textContent.trim();

    const dd = document.createElement("div");
    dd.className = "__glance_enum_dropdown__";
    options.forEach(opt => {
      const item = document.createElement("div");
      item.className = "__glance_enum_option__";
      if (opt === currentVal) item.classList.add("__glance_enum_active__");
      if (cssProp === "font-family") item.style.fontFamily = opt;
      item.textContent = opt;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        applyChange(targetEl, cssProp, currentVal, opt);
        dismissDropdown();
        renderPanel(targetEl);
      });
      dd.appendChild(item);
    });

    fieldEl.style.position = "relative";
    fieldEl.appendChild(dd);
    activeDropdown = dd;
    activeDropdownLabel = fieldEl;

    const activeItem = dd.querySelector(".__glance_enum_active__");
    if (activeItem) activeItem.scrollIntoView({ block: "nearest" });

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
    picker.className = "__glance_color_picker__";
    picker.innerHTML = `
      <canvas class="__glance_cp_sv__" width="220" height="140"></canvas>
      <div class="__glance_cp_sliders__">
        <canvas class="__glance_cp_hue__" width="220" height="12"></canvas>
        <canvas class="__glance_cp_alpha__" width="220" height="12"></canvas>
      </div>
      <div class="__glance_cp_inputs__">
        <div class="__glance_cp_preview_swatch__"></div>
        <input class="__glance_cp_hex_input__" type="text" spellcheck="false" />
      </div>
    `;

    const colorField = swatch.closest(".__glance_prop_row__") || swatch.closest(".__glance_color_field__");
    if (!colorField) return;
    colorField.style.position = "relative";
    colorField.appendChild(picker);
    activeColorPicker = picker;

    const svCanvas = picker.querySelector(".__glance_cp_sv__");
    const hueCanvas = picker.querySelector(".__glance_cp_hue__");
    const alphaCanvas = picker.querySelector(".__glance_cp_alpha__");
    const hexInput = picker.querySelector(".__glance_cp_hex_input__");
    const previewSwatch = picker.querySelector(".__glance_cp_preview_swatch__");

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
      ctx.fillStyle = "#e0e0e0";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#ccc";
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
    container.querySelectorAll(".__glance_val__, .__glance_prop_value__[data-cssprop]").forEach(v => {
      v.addEventListener("click", (e) => {
        if (v.querySelector(".__glance_edit_input__")) return;
        navigator.clipboard.writeText(v.dataset.copy || v.textContent.trim()).catch(() => {});
        v.classList.add("__glance_copied__");
        setTimeout(() => v.classList.remove("__glance_copied__"), 800);
      });
      const cssProp = v.dataset.cssprop;
      if (cssProp) {
        v.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          if (v.querySelector(".__glance_edit_input__")) return;
          startEditing(v, cssProp, targetEl);
        });
      }
    });
  }

  function startEditing(valEl, cssProp, targetEl) {
    const currentVal = valEl.dataset.copy || valEl.textContent.trim();
    const input = document.createElement("input");
    input.type = "text";
    input.className = "__glance_edit_input__";
    input.value = currentVal;
    const syncInputSize = () => {
      const len = input.value.length;
      input.size = Math.max(6, len + 1);
    };
    syncInputSize();
    valEl.textContent = "";
    valEl.querySelectorAll(".__glance_swatch__").forEach(s => s.remove());
    valEl.appendChild(input);
    input.addEventListener("input", syncInputSize);
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
      const unit = match[2] || (UNITLESS_PROPS.has(cssProp) ? "" : "px");
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
    const btn = document.getElementById("__glance_copy_changes__");
    if (!btn) return;
    const totalChanges = Array.from(changedStyles.values())
      .reduce((sum, m) => sum + m.size, 0);
    btn.classList.toggle("__glance_has_changes__", totalChanges > 0);
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
    body.querySelectorAll(".__glance_class_pill__").forEach(pill => {
      pill.addEventListener("click", () => {
        const className = pill.dataset.classname;
        const detailsContainer = body.querySelector("#__glance_class_details__");
        if (!detailsContainer) return;

        if (pill.classList.contains("__glance_class_active__")) {
          pill.classList.remove("__glance_class_active__");
          detailsContainer.innerHTML = "";
          return;
        }

        body.querySelectorAll(".__glance_class_pill__").forEach(p =>
          p.classList.remove("__glance_class_active__")
        );
        pill.classList.add("__glance_class_active__");

        const rules = getClassRules(className, targetEl.ownerDocument);
        if (rules.length === 0) {
          detailsContainer.innerHTML = `<div class="__glance_class_empty__">No defined properties found</div>`;
        } else {
          detailsContainer.innerHTML = rules.map(rule => `
            <div class="__glance_class_rule__">
              <div class="__glance_class_rule_selector__">${rule.selector}</div>
              ${rule.properties.map(p => {
                const isChanged = targetEl && changedStyles.has(targetEl)
                  && changedStyles.get(targetEl).has(p.name);
                const changedClass = isChanged ? " __glance_val_changed__" : "";
                return `
                <div class="__glance_row__">
                  <span class="__glance_key__" style="width:auto;flex:1">${p.name}</span>
                  <span class="__glance_val__${changedClass}" data-copy="${p.value}" data-cssprop="${p.name}">${p.value}</span>
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

  let pushStyleEl = null;
  const pushedEls = new Set();

  function applySidebarWidth(w) {
    sidebarWidth = Math.max(200, Math.min(600, w));
    if (panel) panel.style.width = sidebarWidth + "px";
    document.documentElement.style.setProperty("--__glance-sidebar-w", sidebarWidth + "px");
    if (inspectorActive && !devicePreviewActive) pushSidebar();
  }

  function pushSidebar() {
    revertSidebarPush();
    const sw = sidebarWidth;
    const shrinkW = `calc(100vw - ${sw}px)`;

    const htmlCs = window.getComputedStyle(document.documentElement);
    const bodyCs = window.getComputedStyle(document.body);
    const htmlFixed = htmlCs.position === "fixed";
    const bodyFixed = bodyCs.position === "fixed";

    if (htmlFixed || bodyFixed) {
      if (!pushStyleEl) {
        pushStyleEl = document.createElement("style");
        pushStyleEl.id = "__glance_push_style__";
        document.head.appendChild(pushStyleEl);
      }
      let css = "";
      if (htmlFixed) {
        css += `html.__glance_sidebar_active__ { width: ${shrinkW} !important; right: auto !important; }\n`;
      }
      if (bodyFixed) {
        css += `html.__glance_sidebar_active__ body { width: ${shrinkW} !important; right: auto !important; }\n`;
      }
      pushStyleEl.textContent = css;
    }

    const scanFixed = (parent, depth) => {
      if (depth > 3) return;
      for (const el of parent.children) {
        if (el.id?.startsWith("__glance_")) continue;
        const cs = window.getComputedStyle(el);
        if (cs.position === "fixed") {
          const r = parseFloat(cs.right);
          const l = parseFloat(cs.left);
          const elW = parseFloat(cs.width);
          const vw = window.innerWidth;
          if ((r === 0 && l === 0) || (Math.abs(elW - vw) < 2)) {
            el.style.setProperty("width", shrinkW, "important");
            el.style.setProperty("right", "auto", "important");
            pushedEls.add(el);
          }
        }
        scanFixed(el, depth + 1);
      }
    };
    scanFixed(document.body, 0);
  }

  function revertSidebarPush() {
    if (pushStyleEl) { pushStyleEl.remove(); pushStyleEl = null; }
    pushedEls.forEach(el => {
      el.style.removeProperty("width");
      el.style.removeProperty("right");
    });
    pushedEls.clear();
  }

  // ─── Theme Toggle ──────────────────────────────────────────────────────────
  const ICON_SUN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
  const ICON_MOON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  const ICON_SYSTEM = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;

  function resolvedDark() {
    if (themeMode === "dark") return true;
    if (themeMode === "light") return false;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function applyTheme() {
    if (!panel) return;
    const isDark = resolvedDark();
    panel.classList.toggle("__glance_dark__", isDark);
    const btn = panel.querySelector("#__glance_theme_toggle__");
    if (btn) {
      if (themeMode === "system") { btn.innerHTML = ICON_SYSTEM; btn.title = "Theme: system"; }
      else if (themeMode === "light") { btn.innerHTML = ICON_SUN; btn.title = "Theme: light"; }
      else { btn.innerHTML = ICON_MOON; btn.title = "Theme: dark"; }
    }
  }

  function toggleTheme() {
    if (themeMode === "system") themeMode = "light";
    else if (themeMode === "light") themeMode = "dark";
    else themeMode = "system";
    try { localStorage.setItem("__glance_theme__", themeMode); } catch {}
    applyTheme();
  }

  function onSystemThemeChange() {
    if (themeMode === "system") applyTheme();
  }

  // ─── Hover Inspection Toggle ────────────────────────────────────────────────
  function toggleHoverInspection() {
    hoverEnabled = !hoverEnabled;
    const btn = panel.querySelector("#__glance_hover_toggle__");
    btn.classList.toggle("__glance_hover_active__", hoverEnabled);

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
        const iframe = document.getElementById("__glance_device_iframe__");
        if (iframe?.contentDocument?.body) iframe.contentDocument.body.style.cursor = "";
      } catch {}
    } else {
      if (highlightBox) highlightBox.style.display = "";
      if (iframeHighlight) iframeHighlight.style.display = "";
      if (!pinnedElement) document.body.style.cursor = "crosshair";
      try {
        const iframe = document.getElementById("__glance_device_iframe__");
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
    revertSidebarPush();

    const toggleBtn = document.getElementById("__glance_device_toggle__");
    if (toggleBtn) toggleBtn.classList.add("__glance_device_active__");

    createDeviceFrame();
    applyDeviceSize();
    showToast(`${DEVICE.name} preview`);
  }

  function disableDevicePreview() {
    devicePreviewActive = false;

    const toggleBtn = document.getElementById("__glance_device_toggle__");
    if (toggleBtn) toggleBtn.classList.remove("__glance_device_active__");

    removeDeviceFrame();
    pushSidebar();
    showToast("Device preview off");
  }

  let iframeHighlight = null;
  let iframePinnedElement = null;
  let iframeCleanup = null;

  function createDeviceFrame() {
    removeDeviceFrame();
    deviceFrame = document.createElement("div");
    deviceFrame.id = "__glance_device_frame__";

    const frameSrc = chrome.runtime.getURL("assets/iphone-frame.png");
    deviceFrame.innerHTML = `
      <iframe id="__glance_device_iframe__" src="${window.location.href}"></iframe>
      <img class="__glance_device_frame_img__" src="${frameSrc}" draggable="false" />
    `;
    document.body.appendChild(deviceFrame);
    document.documentElement.classList.add("__glance_device_mode__");

    const iframe = deviceFrame.querySelector("#__glance_device_iframe__");

    iframe.addEventListener("load", () => {
      try {
        const idoc = iframe.contentDocument;
        if (!idoc || !idoc.body) return;
        const style = idoc.createElement("style");
        style.textContent = `html { padding-top: ${FRAME.statusBarH}px !important; scrollbar-width: none !important; } html::-webkit-scrollbar { display: none !important; }`;
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
    iframeLabel.id = "__glance_iframe_highlight_label__";
    iframeHighlight.appendChild(iframeLabel);
    idoc.documentElement.appendChild(iframeHighlight);
    idoc.body.style.cursor = "crosshair";

    function updateIframeLabel(el) {
      const lbl = iframeHighlight.querySelector("#__glance_iframe_highlight_label__");
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

    function onIframeScroll() {
      if (iframePinnedElement) positionIframeHighlight(iframePinnedElement, idoc);
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
    (idoc.defaultView || window).addEventListener("scroll", onIframeScroll, true);

    iframeCleanup = () => {
      try {
        idoc.removeEventListener("mousemove", onIframeMove, true);
        idoc.removeEventListener("click", onIframeClick, true);
        (idoc.defaultView || window).removeEventListener("scroll", onIframeScroll, true);
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
    document.documentElement.classList.remove("__glance_device_mode__");
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
      <div class="__glance_section__">
        <div class="__glance_section_title__">${title}</div>
        <div class="__glance_section_content__">${content}</div>
      </div>`;
  }

  function classifyField(cssProp, value) {
    if (cssProp && RANGE_PROPS[cssProp]) return "range";
    if (cssProp && ENUM_PROPS[cssProp]) return "enum";
    if (value && /^-?[\d.]+/.test(value)) return "numeric";
    return "";
  }

  function propRow(label, value, cssProp, hint, navAttr) {
    if (!value || value === "" || value === "undefined") return "";
    const propAttr = cssProp ? ` data-cssprop="${cssProp}"` : "";
    const isChanged = cssProp && pinnedElement && changedStyles.has(pinnedElement)
      && changedStyles.get(pinnedElement).has(cssProp);
    const changedClass = isChanged ? " __glance_val_changed__" : "";
    const fieldType = hint || classifyField(cssProp, value);
    const ftAttr = fieldType ? ` data-fieldtype="${fieldType}"` : "";
    const navData = navAttr ? ` data-nav="${navAttr}"` : "";

    return `
      <div class="__glance_prop_row__"${navData}${ftAttr}>
        <span class="__glance_prop_label__">${label}</span>
        <span class="__glance_prop_dots__"></span>
        <span class="__glance_prop_value__${changedClass}" data-copy="${value}"${propAttr}>${value}</span>
      </div>`;
  }

  function propRowColor(label, color, cssProp) {
    if (!color) return "";
    const isTransparent = color === "transparent" || color === "rgba(0, 0, 0, 0)";
    const hex = isTransparent ? "transparent" : rgbToHex(color);
    const propAttr = cssProp ? ` data-cssprop="${cssProp}"` : "";
    const preview = isTransparent ? "transparent" : color;
    return `
      <div class="__glance_prop_row__" data-fieldtype="color">
        <span class="__glance_prop_label__">${label}</span>
        <span class="__glance_prop_dots__"></span>
        <div class="__glance_color_preview__" style="background:${preview}"></div>
        <span class="__glance_prop_value__" data-copy="${color}"${propAttr}>${hex}</span>
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
    const handle = document.getElementById("__glance_resize_handle__");
    if (!handle) return;
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarWidth;
      handle.classList.add("__glance_resizing__");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (e) => {
        const delta = startX - e.clientX;
        applySidebarWidth(startW + delta);
      };
      const onUp = () => {
        handle.classList.remove("__glance_resizing__");
        document.body.style.cursor = inspectorActive && !pinnedElement ? "crosshair" : "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        try { localStorage.setItem("__glance_sidebar_w__", String(sidebarWidth)); } catch {}
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  // ─── Toast ─────────────────────────────────────────────────────────────────
  function showToast(msg) {
    const existing = document.getElementById("__glance_toast__");
    if (existing) existing.remove();
    const t = document.createElement("div");
    t.id = "__glance_toast__";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add("__glance_toast_show__"), 10);
    setTimeout(() => {
      t.classList.remove("__glance_toast_show__");
      setTimeout(() => t.remove(), 400);
    }, 2800);
  }

})();
