/**
 * Content script — injected into all frames.
 * Handles: DOM snapshot capture, screenshot requests (via service worker), action execution.
 */

// Import locally since content scripts can't use ES modules
// These are inlined at build or loaded via chrome.scripting.executeScript

(function () {
  // ---- Dialog auto-handler ----
  window.addEventListener("beforeunload", () => {});
  window.__chromePilotDialogAction = null;
  window.__chromePilotDialogText = "";

  // Override window methods to catch dialogs
  const origAlert = window.alert;
  const origConfirm = window.confirm;
  const origPrompt = window.prompt;

  window.alert = function(msg) {
    if (window.__chromePilotDialogAction) { window.__chromePilotDialogAction = null; return; }
    return origAlert.call(window, msg);
  };
  window.confirm = function(msg) {
    if (window.__chromePilotDialogAction) {
      const accept = window.__chromePilotDialogAction === "accept";
      window.__chromePilotDialogAction = null;
      return accept;
    }
    return origConfirm.call(window, msg);
  };
  window.prompt = function(msg, def) {
    if (window.__chromePilotDialogAction) {
      const text = window.__chromePilotDialogText || def || "";
      const action = window.__chromePilotDialogAction;
      window.__chromePilotDialogAction = null;
      return action === "dismiss" ? null : text;
    }
    return origPrompt.call(window, msg, def);
  };

  // ---- Network capture ----
  const __chromePilotNetworkLogs = [];
  const MAX_NETWORK_LOGS = 50;

  const origFetch = window.fetch;
  window.fetch = function(...args) {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
    const method = args[1]?.method || "GET";
    const entry = { method, url, time: Date.now() };
    __chromePilotNetworkLogs.push(entry);
    if (__chromePilotNetworkLogs.length > MAX_NETWORK_LOGS) __chromePilotNetworkLogs.shift();
    return origFetch.apply(window, args).then(resp => {
      entry.status = resp.status;
      return resp;
    });
  };

  const origXhrOpen = XMLHttpRequest.prototype.open;
  const origXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__chromePilotMethod = method;
    this.__chromePilotUrl = url;
    return origXhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function() {
    const entry = { method: this.__chromePilotMethod, url: this.__chromePilotUrl, time: Date.now() };
    __chromePilotNetworkLogs.push(entry);
    if (__chromePilotNetworkLogs.length > MAX_NETWORK_LOGS) __chromePilotNetworkLogs.shift();
    this.addEventListener("load", () => { entry.status = this.status; });
    return origXhrSend.apply(this, arguments);
  };

  // ---- Console capture ----
  const __chromePilotConsoleLogs = [];
  const MAX_CONSOLE_LOGS = 50;

  ["log", "warn", "error", "info"].forEach(level => {
    const orig = console[level];
    console[level] = function(...args) {
      __chromePilotConsoleLogs.push({ level, message: args.map(a => String(a)).join(" "), time: Date.now() });
      if (__chromePilotConsoleLogs.length > MAX_CONSOLE_LOGS) __chromePilotConsoleLogs.shift();
      orig.apply(console, args);
    };
  });

  // ---- DOM Snapshot (inlined from lib/dom-snapshot.js) ----

  function getElementSelector(el) {
    if (el.id) return `#${el.id}`;
    if (el.getAttribute("data-test-id")) return `[data-test-id="${el.getAttribute("data-test-id")}"]`;
    if (el.name) return `[name="${el.name}"]`;
    if (el.getAttribute("aria-label")) return `[aria-label="${el.getAttribute("aria-label")}"]`;
    const tag = el.tagName.toLowerCase();
    const parent = el.parentElement;
    if (!parent) return tag;
    const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
    if (siblings.length === 1) return `${getElementSelector(parent)} > ${tag}`;
    const idx = siblings.indexOf(el) + 1;
    return `${getElementSelector(parent)} > ${tag}:nth-child(${idx})`;
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function getLabel(el) {
    if (el.getAttribute("aria-label")) return el.getAttribute("aria-label");
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return label.textContent.trim();
    }
    if (el.placeholder) return el.placeholder;
    if (el.tagName === "BUTTON" || el.tagName === "A") return el.textContent.trim().slice(0, 50);
    if (el.title) return el.title;
    return "";
  }

  function getElementType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "input") return `input[${el.type || "text"}]`;
    if (tag === "select") return "dropdown";
    if (tag === "textarea") return "textarea";
    if (tag === "button") return "button";
    if (tag === "a") return "link";
    if (el.getAttribute("role")) return el.getAttribute("role");
    if (el.contentEditable === "true") return "editable";
    return tag;
  }

  function captureSnapshot(maxDepth) {
    maxDepth = maxDepth || 3;
    const selectors = "input, select, textarea, button, a[href], [role='button'], [role='tab'], [role='link'], [role='menuitem'], [contenteditable='true'], [onclick]";
    const elements = [];
    let index = 0;

    function processDoc(doc, frameLabel) {
      let output = "";
      try {
        const nodes = doc.querySelectorAll(selectors);
        let hasElements = false;
        for (const el of nodes) {
          if (!isVisible(el)) continue;
          if (!hasElements) {
            output += `--- Frame: ${frameLabel} ---\n`;
            hasElements = true;
          }
          let line = `[${index}] ${getElementType(el)}`;
          const label = getLabel(el);
          if (label) line += ` "${label}"`;
          if (el.value && el.type !== "password") line += ` value="${el.value}"`;
          if (el.tagName === "SELECT") {
            const opts = Array.from(el.options).slice(0, 10).map(o => `"${o.text.trim()}"`);
            line += ` options=[${opts.join(",")}]`;
          }
          if (el.disabled) line += " disabled";
          if (el.required) line += " required";
          line += ` ${getElementSelector(el)}`;
          output += line + "\n";
          elements.push({ index, selector: getElementSelector(el), el });
          index++;
        }
      } catch (e) { /* cross-origin */ }
      return output;
    }

    function processIframes(doc, depth, maxDepth) {
      if (depth >= maxDepth) return "";
      let output = "";
      const iframes = doc.querySelectorAll("iframe");
      for (let i = 0; i < iframes.length; i++) {
        try {
          const iframeDoc = iframes[i].contentDocument;
          if (!iframeDoc) continue;
          const label = iframes[i].id || iframes[i].name || `iframe[${i}]`;
          output += processDoc(iframeDoc, label);
          output += processIframes(iframeDoc, depth + 1, maxDepth);
        } catch (e) { /* cross-origin */ }
      }
      return output;
    }

    let text = processDoc(document, `top | ${window.location.href}`);
    text += processIframes(document, 0, maxDepth);

    return { text, count: index, elements };
  }

  // ---- Action execution ----

  let lastSnapshot = null;

  function findElement(selector, doc) {
    doc = doc || document;
    let el = doc.querySelector(selector);
    if (el) return el;
    const iframes = doc.querySelectorAll("iframe");
    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument;
        if (!iframeDoc) continue;
        el = findElement(selector, iframeDoc);
        if (el) return el;
      } catch (e) { /* cross-origin */ }
    }
    return null;
  }

  function findByIndex(idx) {
    if (!lastSnapshot || !lastSnapshot.elements[idx]) return null;
    return lastSnapshot.elements[idx].el;
  }

  function resolveElement(action) {
    if (action.index !== undefined) return findByIndex(action.index);
    if (action.selector) return findElement(action.selector);
    return null;
  }

  function executeAction(action) {
    switch (action.action) {
      case "click": {
        const el = resolveElement(action);
        if (!el) return { success: false, error: `Element not found` };
        el.scrollIntoView({ block: "center" });
        el.focus();
        el.click();
        return { success: true };
      }
      case "type": {
        const el = resolveElement(action);
        if (!el) return { success: false, error: `Element not found` };
        el.scrollIntoView({ block: "center" });
        el.focus();
        if (action.clear !== false) {
          el.value = "";
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
        for (const char of action.value) {
          el.value += char;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true };
      }
      case "select": {
        const el = resolveElement(action);
        if (!el) return { success: false, error: `Element not found` };
        const option = Array.from(el.options).find(o => o.value === action.value || o.text.trim() === action.value);
        if (!option) return { success: false, error: `Option not found: ${action.value}` };
        el.value = option.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true };
      }
      case "scroll": {
        if (action.direction === "to-element") {
          const el = resolveElement(action);
          if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
        } else {
          const amount = action.amount || 300;
          window.scrollBy({ top: action.direction === "up" ? -amount : amount, behavior: "smooth" });
        }
        return { success: true };
      }
      case "press_key": {
        const target = resolveElement(action) || document.activeElement || document.body;
        const opts = { key: action.key, code: action.key, bubbles: true, cancelable: true };
        target.dispatchEvent(new KeyboardEvent("keydown", opts));
        target.dispatchEvent(new KeyboardEvent("keyup", opts));
        return { success: true };
      }
      case "hover": {
        const el = resolveElement(action);
        if (!el) return { success: false, error: "Element not found" };
        el.scrollIntoView({ block: "center" });
        el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        return { success: true };
      }
      case "highlight": {
        // Clear previous highlights
        document.querySelectorAll("[data-chrome-pilot-highlight]").forEach(el => {
          el.style.outline = el.dataset.chromePilotOrigOutline || "";
          el.removeAttribute("data-chrome-pilot-highlight");
          delete el.dataset.chromePilotOrigOutline;
        });
        if (action.clear) return { success: true };
        const el = resolveElement(action);
        if (!el) return { success: false, error: "Element not found" };
        el.scrollIntoView({ block: "center" });
        el.dataset.chromePilotOrigOutline = el.style.outline;
        el.style.outline = "3px solid #ff4444";
        el.setAttribute("data-chrome-pilot-highlight", "true");
        return { success: true };
      }
      case "drag_drop": {
        const src = action.source_index !== undefined ? findByIndex(action.source_index) : findElement(action.source_selector);
        const tgt = action.target_index !== undefined ? findByIndex(action.target_index) : findElement(action.target_selector);
        if (!src) return { success: false, error: "Source element not found" };
        if (!tgt) return { success: false, error: "Target element not found" };
        const srcRect = src.getBoundingClientRect();
        const tgtRect = tgt.getBoundingClientRect();
        const dataTransfer = new DataTransfer();
        src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, clientX: srcRect.x + srcRect.width/2, clientY: srcRect.y + srcRect.height/2, dataTransfer }));
        tgt.dispatchEvent(new DragEvent("dragover", { bubbles: true, clientX: tgtRect.x + tgtRect.width/2, clientY: tgtRect.y + tgtRect.height/2, dataTransfer }));
        tgt.dispatchEvent(new DragEvent("drop", { bubbles: true, clientX: tgtRect.x + tgtRect.width/2, clientY: tgtRect.y + tgtRect.height/2, dataTransfer }));
        src.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
        return { success: true };
      }
      case "mouse_click_xy": {
        const el = document.elementFromPoint(action.x, action.y);
        if (el) {
          el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: action.x, clientY: action.y }));
          el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: action.x, clientY: action.y }));
          el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: action.x, clientY: action.y }));
        }
        return { success: true };
      }
      case "file_upload": {
        const el = resolveElement(action);
        if (!el) return { success: false, error: "Element not found" };
        if (el.type !== "file") return { success: false, error: "Element is not a file input" };
        // Decode base64 and create File object
        const binary = atob(action.content);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const file = new File([bytes], action.filename, { type: "application/octet-stream" });
        const dt = new DataTransfer();
        dt.items.add(file);
        el.files = dt.files;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true };
      }
      case "mouse_wheel": {
        const x = action.x || window.innerWidth / 2;
        const y = action.y || window.innerHeight / 2;
        const el = document.elementFromPoint(x, y) || document.body;
        el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, clientX: x, clientY: y, deltaY: action.deltaY }));
        return { success: true };
      }
      case "handle_dialog": {
        window.__chromePilotDialogAction = action.action;
        window.__chromePilotDialogText = action.prompt_text || "";
        return { success: true };
      }
      default:
        return { success: false, error: `Unknown action: ${action.action}` };
    }
  }

  // ---- Message handler ----

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "get_snapshot_raw") {
      // Return structured element data for service worker to assign global indices
      lastSnapshot = captureSnapshot(msg.depth);
      const elements = lastSnapshot.elements.map((el, i) => ({
        localIndex: i,
        type: getElementType(el.el),
        label: getLabel(el.el),
        value: el.el.type === "password" ? "" : (el.el.value || el.el.getAttribute("value") || ""),
        selector: el.selector,
        disabled: el.el.disabled || el.el.getAttribute("aria-disabled") === "true",
        required: el.el.required || el.el.getAttribute("aria-required") === "true",
        options: el.el.tagName === "SELECT" ? Array.from(el.el.options).slice(0, 10).map(o => o.text.trim()) : null
      }));
      sendResponse({ elements, frameLabel: `${window.location.href}` });
    } else if (msg.type === "get_snapshot") {
      lastSnapshot = captureSnapshot(msg.depth);
      sendResponse({ text: lastSnapshot.text, count: lastSnapshot.count });
    } else if (msg.type === "execute_action") {
      const result = executeAction(msg.action);
      sendResponse(result);
    } else if (msg.type === "check_element") {
      const el = findElement(msg.selector);
      sendResponse({ found: !!el });
    } else if (msg.type === "get_network") {
      const filter = msg.filter || "";
      const filtered = filter ? __chromePilotNetworkLogs.filter(r => r.url.includes(filter)) : __chromePilotNetworkLogs;
      const text = filtered.map(r => `${r.method} ${r.status || "..."} ${r.url}`).join("\n");
      sendResponse({ requests: text || "No requests captured." });
    } else if (msg.type === "verify_text") {
      const found = document.body.innerText.includes(msg.text);
      sendResponse({ visible: found, text: msg.text });
    } else if (msg.type === "get_console") {
      const level = msg.level || "all";
      const filtered = level === "all" ? __chromePilotConsoleLogs : __chromePilotConsoleLogs.filter(l => l.level === level);
      const text = filtered.map(l => `[${l.level}] ${l.message}`).join("\n");
      sendResponse({ messages: text || "No messages." });
    } else if (msg.type === "get_text") {
      try {
        const root = msg.selector ? document.querySelector(msg.selector) : document.body;
        const text = root ? root.innerText : "";
        sendResponse({ text });
      } catch (e) {
        sendResponse({ text: "" });
      }
    } else if (msg.type === "ping") {
      sendResponse({ ok: true });
    }
    return true; // async response
  });
})();
