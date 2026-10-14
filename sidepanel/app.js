/**
 * Side panel app — chat UI + settings.
 */

function renderMarkdown(el) {
  const raw = el.textContent;
  if (!raw.trim()) return;
  el.innerHTML = marked.parse(raw);
}

// ---- Pop-out / target tab tracking ----
// When popped out, we track which tab ChromePilot should control
let targetTabId = null;

// Manually pinned tab chosen from the dropdown (overrides auto-detection)
let pinnedTabId = null;

// Track the last focused non-sidepanel window's active tab so that when the
// user switches focus to the side panel to type a message, we still know which
// tab (including browser popup-type windows) to operate on.
let lastFocusedTabId = null;

(async function initLastFocusedTab() {
  const mySidePanelWindowId = (await chrome.windows.getCurrent()).id;

  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    if (windowId === mySidePanelWindowId) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      if (tab) lastFocusedTabId = tab.id;
    } catch (e) {}
  });

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) lastFocusedTabId = tab.id;
})();

// Check if we're in a popup window (has ?targetTab= param)
(function detectPopout() {
  const params = new URLSearchParams(window.location.search);
  const tid = params.get("targetTab");
  if (tid) {
    targetTabId = parseInt(tid, 10);
    document.body.classList.add("popout-mode");
  }
})();

async function getTargetTab() {
  // Manual pin from dropdown takes highest priority
  if (pinnedTabId) {
    try {
      const tab = await chrome.tabs.get(pinnedTabId);
      return tab;
    } catch (e) {
      pinnedTabId = null;
    }
  }
  // If we have a pinned target tab (popup mode), use that
  if (targetTabId) {
    try {
      const tab = await chrome.tabs.get(targetTabId);
      return tab;
    } catch (e) {
      // Tab was closed — fall back
    }
  }
  // Use the last focused non-sidepanel tab (works for popup windows)
  if (lastFocusedTabId) {
    try {
      const tab = await chrome.tabs.get(lastFocusedTabId);
      return tab;
    } catch (e) {
      // Tab was closed — fall back
    }
  }
  // Final fallback: active tab in last focused window
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function refreshTabDropdown() {
  const select = document.getElementById("target-tab-select");
  if (!select) return;

  const allTabs = await chrome.tabs.query({});
  const currentTarget = await getTargetTab();
  const currentId = currentTarget?.id;
  const selectedValue = select.value ? parseInt(select.value) : null;

  const newEntries = [];
  for (const tab of allTabs) {
    if (tab.url?.startsWith("chrome-extension://") || tab.url?.startsWith("chrome://")) continue;
    const win = await chrome.windows.get(tab.windowId);
    const prefix = win.type === "popup" ? "[popup] " : "";
    newEntries.push({ id: tab.id, text: prefix + (tab.title || tab.url || `Tab ${tab.id}`) });
  }

  const existingIds = Array.from(select.options).map(o => parseInt(o.value));
  const newIds = newEntries.map(e => e.id);

  const toRemove = existingIds.filter(id => !newIds.includes(id));
  for (const id of toRemove) {
    const opt = select.querySelector(`option[value="${id}"]`);
    if (opt) opt.remove();
  }

  for (const entry of newEntries) {
    let opt = select.querySelector(`option[value="${entry.id}"]`);
    if (!opt) {
      opt = document.createElement("option");
      opt.value = entry.id;
      select.appendChild(opt);
    }
    if (opt.textContent !== entry.text) opt.textContent = entry.text;
  }

  const targetId = selectedValue || currentId;
  if (targetId && select.value !== String(targetId)) {
    select.value = String(targetId);
  }

  const activeEntry = newEntries.find(e => e.id === (targetId || currentId));
  const label = document.getElementById("tab-picker-label");
  if (label && activeEntry) {
    const short = activeEntry.text.replace(/^\[popup\] /, "").slice(0, 20);
    label.textContent = short || "Tab";
  }
}

function renderTabPanel() {
  const select = document.getElementById("target-tab-select");
  const list = document.getElementById("tab-list");
  if (!list || !select) return;
  list.innerHTML = "";
  const currentId = select.value ? parseInt(select.value) : null;
  Array.from(select.options).forEach(opt => {
    const id = parseInt(opt.value);
    const item = document.createElement("div");
    item.className = `picker-item${id === currentId ? " active" : ""}`;
    item.innerHTML = `<span class="picker-item-name">${escapeHtml(opt.textContent)}</span>`;
    item.addEventListener("click", () => {
      pinnedTabId = id;
      select.value = String(id);
      const label = document.getElementById("tab-picker-label");
      if (label) label.textContent = opt.textContent.replace(/^\[popup\] /, "").slice(0, 20) || "Tab";
      closeAllPickers();
    });
    list.appendChild(item);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  refreshTabDropdown();
  setInterval(refreshTabDropdown, 3000);

  document.getElementById("target-tab-select").addEventListener("change", (e) => {
    pinnedTabId = parseInt(e.target.value);
  });
});

// Pop-out button handler
document.getElementById("popout-btn")?.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return;
  // Open sidepanel HTML in a new popup window, passing target tab
  const popupUrl = chrome.runtime.getURL(`sidepanel/index.html?targetTab=${tab.id}`);
  chrome.windows.create({
    url: popupUrl,
    type: "popup",
    width: 420,
    height: 700
  });
  // Tell service worker to re-enable the side panel (so toolbar button works next time)
  chrome.runtime.sendMessage({ type: "sidepanel_close" });
  // Close the side panel by closing this document — frees full viewport on the page
  window.close();
});

// ---- Helpers ----

async function updateProviderBadge() {
  const config = await getActiveSessionConfig();
  const badge = document.getElementById("provider-badge");
  const provider = config.activeProvider || "copilot";
  const labels = { custom: "Custom", bedrock: "Bedrock", copilot: "Copilot" };
  badge.textContent = labels[provider] || provider;
  badge.className = `provider-badge ${provider}`;
}

// ---- Session helpers ----

async function getActiveSessionConfig() {
  const data = await chrome.storage.local.get(["sessions", "activeSessionId"]);
  return data.sessions?.[data.activeSessionId] || {};
}

async function saveActiveSessionConfig(updates) {
  const data = await chrome.storage.local.get(["sessions", "activeSessionId"]);
  const { sessions, activeSessionId } = data;
  if (!activeSessionId || !sessions) return;
  sessions[activeSessionId] = { ...(sessions[activeSessionId] || {}), ...updates };
  await chrome.storage.local.set({ sessions });
}

function renderToolChecklist(containerId, allTools, selectedTools) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  for (const tool of allTools) {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = tool;
    cb.checked = selectedTools.includes(tool);
    label.appendChild(cb);
    label.appendChild(document.createTextNode(tool));
    container.appendChild(label);
  }
}

function getCheckedTools(containerId) {
  const checks = document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`);
  return Array.from(checks).map(cb => cb.value);
}

// ---- Settings toggle ----

const settingsPanel = document.getElementById("settings-panel");
document.getElementById("settings-toggle").addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
});
document.getElementById("settings-close").addEventListener("click", () => {
  settingsPanel.classList.add("hidden");
});

// ---- Settings tabs ----

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

// ---- Settings save/load ----

async function loadSettings() {
  const config = await getActiveSessionConfig();
  document.getElementById("api-url").value = config.apiUrl || "";
  document.getElementById("api-token").value = config.apiToken || "";
  document.getElementById("model-id").value = config.modelId || "";
  document.getElementById("bedrock-access-key").value = config.bedrockAccessKey || "";
  document.getElementById("bedrock-secret-key").value = config.bedrockSecretKey || "";
  document.getElementById("bedrock-session-token").value = config.bedrockSessionToken || "";
  document.getElementById("bedrock-model-id").value = config.bedrockModelId || "us.anthropic.claude-sonnet-4-20250514-v1:0";
  document.getElementById("copilot-model-id").value = config.copilotModelId || "gpt-4o";
  document.getElementById("action-delay").value = config.actionDelayMs ?? 5000;
  document.getElementById("snapshot-offset").value = config.snapshotOffset ?? 0;
  document.getElementById("snapshot-limit").value = config.snapshotLimit ?? 200;
  document.getElementById("snapshot-depth").value = config.snapshotDepth ?? 5;
  document.getElementById("auto-snapshot").checked = config.autoSnapshot !== false;

  // Render tool checklists
  const ALL_TOOLS = ["click", "type", "select", "scroll", "press_key", "hover", "drag_drop", "mouse_click_xy", "navigate", "navigate_back", "file_upload", "get_dom_snapshot", "get_screenshot", "console_messages", "wait", "resize", "handle_dialog", "network_requests", "pdf_save", "tabs"];
  const ALL_AGENT_TOOLS = [...ALL_TOOLS, "get_page_text", "verify_text_visible", "verify_element_visible", "mouse_wheel", "highlight", "list_skills", "load_skill", "context_management"];
  const DEFAULT_SNAPSHOT_TOOLS = ["click", "type", "select", "scroll", "press_key", "hover", "drag_drop", "mouse_click_xy", "navigate", "navigate_back", "file_upload"];
  const DEFAULT_PURGE_TOOLS = ["get_dom_snapshot", "get_screenshot"];
  const DEFAULT_NO_DELAY_TOOLS = [
    "get_dom_snapshot", "get_page_text", "get_screenshot",
    "verify_text_visible", "verify_element_visible",
    "console_messages", "network_requests",
    "get_localstorage",
    "list_skills", "load_skill",
    "context_management", "wait"
  ];

  const snapshotTools = config.autoSnapshotTools || DEFAULT_SNAPSHOT_TOOLS;
  const purgeTools = config.autoPurgeTools || DEFAULT_PURGE_TOOLS;
  const noDelayTools = config.noDelayTools || DEFAULT_NO_DELAY_TOOLS;

  renderToolChecklist("auto-snapshot-tools", ALL_TOOLS, snapshotTools);
  renderToolChecklist("auto-purge-tools", ALL_TOOLS, purgeTools);
  renderToolChecklist("no-delay-tools", ALL_AGENT_TOOLS, noDelayTools);

  // Activate correct tab based on provider (default to copilot when unset)
  const activeTab = "copilot-tab";
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  const activeBtn = document.querySelector(`[data-tab="${activeTab}"]`);
  if (activeBtn) activeBtn.classList.add("active");
  document.getElementById(activeTab).classList.add("active");
}

document.getElementById("settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await saveActiveSessionConfig({
    apiUrl: document.getElementById("api-url").value.replace(/\/$/, ""),
    apiToken: document.getElementById("api-token").value,
    modelId: document.getElementById("model-id").value || "gpt-4",
    activeProvider: "custom"
  });
  addMessage("system", "Custom API settings saved (active).");
  updateProviderBadge();
  settingsPanel.classList.add("hidden");
});

document.getElementById("bedrock-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await saveActiveSessionConfig({
    bedrockAccessKey:    document.getElementById("bedrock-access-key").value,
    bedrockSecretKey:    document.getElementById("bedrock-secret-key").value,
    bedrockSessionToken: document.getElementById("bedrock-session-token").value,
    bedrockModelId:      document.getElementById("bedrock-model-id").value || "us.anthropic.claude-sonnet-4-20250514-v1:0",
    activeProvider: "bedrock"
  });
  addMessage("system", "AWS Bedrock settings saved (active).");
  updateProviderBadge();
  settingsPanel.classList.add("hidden");
});

document.getElementById("bedrock-close").addEventListener("click", () => {
  settingsPanel.classList.add("hidden");
});

document.getElementById("copilot-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const select = document.getElementById("copilot-model-id");
  await saveActiveSessionConfig({
    copilotModelId: select.value || "gpt-4o",
    activeProvider: "copilot"
  });
  addMessage("system", "GitHub Copilot settings saved (active).");
  updateProviderBadge();
  settingsPanel.classList.add("hidden");
});

document.getElementById("copilot-signin-btn").addEventListener("click", async () => {
  const btn = document.getElementById("copilot-signin-btn");
  const codeDiv = document.getElementById("copilot-device-code");
  btn.disabled = true;
  btn.textContent = "Starting...";

  try {
    const resp = await chrome.runtime.sendMessage({ type: "copilot_start_device_flow" });
    if (!resp.success) throw new Error(resp.error);

    const { verification_uri, user_code, device_code, interval } = resp.data;

    // Show the code to the user
    document.getElementById("copilot-user-code").textContent = user_code;
    document.getElementById("copilot-verify-link").href = verification_uri;
    document.getElementById("copilot-verify-link").textContent = verification_uri.replace("https://", "");
    codeDiv.classList.remove("hidden");
    btn.textContent = "Waiting...";

    // Open the verification URL
    chrome.tabs.create({ url: verification_uri });

    // Poll for the token (runs in service worker)
    const tokenResp = await chrome.runtime.sendMessage({
      type: "copilot_poll_token",
      deviceCode: device_code,
      interval
    });

    if (!tokenResp.success) throw new Error(tokenResp.error);

    // Success
    codeDiv.classList.add("hidden");
    btn.textContent = "Sign in with GitHub";
    btn.disabled = false;
    updateCopilotStatus();
    addMessage("system", "GitHub Copilot signed in successfully!");
  } catch (e) {
    codeDiv.classList.add("hidden");
    btn.textContent = "Sign in with GitHub";
    btn.disabled = false;
    addMessage("error", `Copilot sign-in failed: ${e.message}`);
  }
});

document.getElementById("copilot-signout-btn").addEventListener("click", async () => {
  await saveActiveSessionConfig({ copilotGithubToken: "" });
  updateCopilotStatus();
  addMessage("system", "Signed out of GitHub Copilot.");
});

async function updateCopilotStatus() {
  const config = await getActiveSessionConfig();
  const copilotGithubToken = config.copilotGithubToken || "";
  const statusEl = document.getElementById("copilot-status");
  const statusText = document.getElementById("copilot-status-text");
  const signinBtn = document.getElementById("copilot-signin-btn");
  const signoutBtn = document.getElementById("copilot-signout-btn");

  if (copilotGithubToken) {
    statusText.textContent = "Signed in";
    statusEl.className = "copilot-status signed-in";
    signinBtn.classList.add("hidden");
    signoutBtn.classList.remove("hidden");
    // Auto-fetch models on status update
    refreshCopilotModels();
  } else {
    statusText.textContent = "Not signed in";
    statusEl.className = "copilot-status not-signed-in";
    signinBtn.classList.remove("hidden");
    signoutBtn.classList.add("hidden");
  }
}

document.getElementById("copilot-refresh-models").addEventListener("click", refreshCopilotModels);

async function refreshCopilotModels() {
  const btn = document.getElementById("copilot-refresh-models");
  const select = document.getElementById("copilot-model-id");
  btn.disabled = true;
  btn.textContent = "Loading...";

  try {
    const resp = await chrome.runtime.sendMessage({ type: "copilot_fetch_models" });
    if (!resp.success) throw new Error(resp.error);

    const config = await getActiveSessionConfig();
    const currentModel = config.copilotModelId || "gpt-4o";

    select.innerHTML = "";
    const models = resp.models;
    if (models.length === 0) {
      select.innerHTML = '<option value="gpt-4o">gpt-4o (default)</option>';
    } else {
      for (const m of models) {
        const id = m.id || m.name || m;
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = id;
        if (id === currentModel) opt.selected = true;
        select.appendChild(opt);
      }
    }
    if (!Array.from(select.options).some(option => option.value === currentModel)) {
      await saveActiveSessionConfig({ copilotModelId: select.value });
    }
  } catch (e) {
    console.warn("Failed to fetch Copilot models:", e.message);
    // Keep existing options
  } finally {
    btn.disabled = false;
    btn.textContent = "Refresh models";
  }
}

document.getElementById("copilot-close").addEventListener("click", () => {
  settingsPanel.classList.add("hidden");
});

document.getElementById("general-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const settings = {
    actionDelayMs: parseInt(document.getElementById("action-delay").value) || 5000,    snapshotOffset: parseInt(document.getElementById("snapshot-offset").value) || 0,
    snapshotLimit: parseInt(document.getElementById("snapshot-limit").value) || 200,
    snapshotDepth: parseInt(document.getElementById("snapshot-depth").value) || 5,
    autoSnapshot: document.getElementById("auto-snapshot").checked,
    autoSnapshotTools: getCheckedTools("auto-snapshot-tools"),
    autoPurgeTools: getCheckedTools("auto-purge-tools"),
    noDelayTools: getCheckedTools("no-delay-tools")
  };
  await saveActiveSessionConfig(settings);
  addMessage("system", "General settings saved.");
  settingsPanel.classList.add("hidden");
});

document.getElementById("general-close").addEventListener("click", () => {
  settingsPanel.classList.add("hidden");
});


// ---- Chat messages ----

function addMessage(type, text, opts = {}) {
  const container = document.getElementById("messages");
  const div = document.createElement("div");
  div.className = `msg ${type}`;
  div.textContent = text;
  container.appendChild(div);
  scrollChat();
  if (opts.autoRemove) {
    setTimeout(() => {
      div.classList.add("fade-out");
      setTimeout(() => div.remove(), 400);
    }, opts.autoRemove);
  }
}

function scrollChat() {
  document.getElementById("chat").scrollTop = document.getElementById("chat").scrollHeight;
}

// ---- Dev mode ----

function applyDevMode(enabled) {
  document.getElementById("history-toggle").classList.toggle("hidden", !enabled);
  document.getElementById("custom-tab-btn").style.display = "none";
}

(function initDevMode() {
  const enabled = localStorage.getItem("chromePilotDevMode") === "1";
  applyDevMode(enabled);
})();

// ---- Send ----

document.getElementById("send-btn").addEventListener("click", handleSend);
document.getElementById("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSend();
});

async function handleSend() {
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) return;

  if (text === "/enable-dev-mode") {
    input.value = "";
    localStorage.setItem("chromePilotDevMode", "1");
    applyDevMode(true);
    addMessage("system", "Dev mode enabled.");
    return;
  }

  if (text === "/disable-dev-mode") {
    input.value = "";
    localStorage.removeItem("chromePilotDevMode");
    applyDevMode(false);
    addMessage("system", "Dev mode disabled.");
    return;
  }

  if (!document.getElementById("ai-data-consent").checked) {
    settingsPanel.classList.remove("hidden");
    addMessage("system", "Please review and accept the data disclosure in Settings first.");
    return;
  }
  await chrome.storage.local.set({ aiDataConsent: true });
  addMessage("user", text);
  input.value = "";

  streamingDiv = null;
  currentTurnCard = null;
  currentToolsList = null;
  stepsContainer = null;
  liveReasoningDiv = null;

  const tab = await getTargetTab();
  if (!tab) { addMessage("system", "No target tab found."); return; }

  const win = await chrome.windows.get(tab.windowId);
  const tabMeta = `[Context: tab="${tab.title || tab.url}" url="${tab.url}" windowType="${win.type}"]`;
  chrome.runtime.sendMessage({ type: "run_agent", tabId: tab.id, message: `${text}\n\n${tabMeta}` });

  document.getElementById("send-btn").classList.add("hidden");
  document.getElementById("stop-btn").classList.remove("hidden");
}

document.getElementById("stop-btn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "stop_run" });
  document.getElementById("send-btn").classList.remove("hidden");
  document.getElementById("stop-btn").classList.add("hidden");
  addMessage("system", "Stopped.");
});

// ---- Listen for agent events ----

let streamingDiv = null;
let currentTurnCard = null;
let currentToolsList = null;
let stepsContainer = null;
let liveReasoningDiv = null;

function ensureStepsContainer() {
  if (!stepsContainer) {
    const container = document.getElementById("messages");
    stepsContainer = document.createElement("details");
    stepsContainer.className = "steps-wrapper";
    stepsContainer.open = true;
    const summary = document.createElement("summary");
    summary.className = "steps-header";
    summary.innerHTML = `<span class="steps-label">Working...</span>`;
    stepsContainer.appendChild(summary);
    container.appendChild(stepsContainer);
  }
  return stepsContainer;
}

function createInlineReasoning() {
  if (!currentToolsList) return null;
  const div = document.createElement("div");
  div.className = "turn-thought-inline";
  currentToolsList.appendChild(div);
  liveReasoningDiv = div;
  return div;
}

function createTurnCard(iteration) {
  const wrapper = ensureStepsContainer();
  const card = document.createElement("div");
  card.className = "turn-card";
  const header = document.createElement("div");
  header.className = "turn-header";
  header.innerHTML = `<span class="turn-label">Step ${iteration}</span><span class="turn-status thinking">thinking...</span>`;
  card.appendChild(header);
  const toolsList = document.createElement("div");
  toolsList.className = "turn-tools";
  card.appendChild(toolsList);
  wrapper.appendChild(card);
  scrollChat();
  return { card, header, toolsList };
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "turn_start") {
    liveReasoningDiv = null;
    const turn = createTurnCard(msg.iteration);
    currentTurnCard = turn.card;
    currentToolsList = turn.toolsList;

  } else if (msg.type === "stream_start") {
    if (currentTurnCard) {
      const status = currentTurnCard.querySelector(".turn-status");
      if (status) { status.textContent = "responding..."; status.className = "turn-status streaming"; }
    }
    streamingDiv = createInlineReasoning();
    if (!streamingDiv) {
      const container = document.getElementById("messages");
      liveReasoningDiv = document.createElement("div");
      liveReasoningDiv.className = "msg live-reasoning";
      container.appendChild(liveReasoningDiv);
      streamingDiv = liveReasoningDiv;
    }

  } else if (msg.type === "stream_delta") {
    if (streamingDiv) {
      streamingDiv.textContent += msg.content;
      scrollChat();
    }

  } else if (msg.type === "stream_end") {
    streamingDiv = null;

  } else if (msg.type === "tool_start") {
    if (currentTurnCard) {
      const status = currentTurnCard.querySelector(".turn-status");
      if (status) { status.textContent = "executing..."; status.className = "turn-status thinking"; }
    }
    if (currentToolsList) {
      const toolDiv = document.createElement("div");
      toolDiv.className = "tool-item";
      toolDiv.dataset.name = msg.name;
      const icon = msg.description === "auto" ? "⚡" : "▸";
      const label = msg.description && msg.description !== "auto" ? msg.description : msg.name;
      toolDiv.innerHTML = `<span class="tool-icon">${icon}</span><span class="tool-name">${label}</span><span class="tool-status running">...</span>`;
      currentToolsList.appendChild(toolDiv);
      scrollChat();
    }

  } else if (msg.type === "tool_end") {
    if (currentToolsList) {
      const items = currentToolsList.querySelectorAll(".tool-item");
      const lastItem = items[items.length - 1];
      if (lastItem) {
        const status = lastItem.querySelector(".tool-status");
        if (msg.error) {
          status.textContent = "error";
          status.className = "tool-status error";
        } else {
          status.textContent = "done";
          status.className = "tool-status done";
        }
        if (msg.result && msg.result.length > 0) {
          const details = document.createElement("details");
          details.className = "tool-result";
          const sum = document.createElement("summary");
          sum.textContent = "output";
          details.appendChild(sum);
          const pre = document.createElement("pre");
          pre.textContent = msg.result;
          details.appendChild(pre);
          lastItem.appendChild(details);
        }
      }
      scrollChat();
    }

  } else if (msg.type === "turn_end") {
    if (currentTurnCard) {
      const status = currentTurnCard.querySelector(".turn-status");
      if (status) { status.textContent = "done"; status.className = "turn-status done"; }
    }
    currentTurnCard = null;
    currentToolsList = null;

  } else if (msg.type === "log_entry") {
    if (msg.entry.type === "error") {
      addMessage("error", msg.entry.content, { autoRemove: 5000 });
    }

  } else if (msg.type === "usage_update") {
    const u = msg.usage;
    document.getElementById("usage-text").textContent = `${msg.model} | in: ${u.prompt_tokens} out: ${u.completion_tokens} total: ${u.total_tokens}`;
    document.getElementById("usage-bar").classList.remove("hidden");

  } else if (msg.type === "run_done") {
    if (msg.message && msg.status !== "success") addMessage("error", msg.message, { autoRemove: 8000 });

    if (liveReasoningDiv) {
      if (liveReasoningDiv.textContent.trim()) {
        const finalDiv = document.createElement("div");
        finalDiv.className = "msg agent";
        finalDiv.textContent = liveReasoningDiv.textContent;
        renderMarkdown(finalDiv);
        liveReasoningDiv.remove();
        document.getElementById("messages").appendChild(finalDiv);
      } else {
        liveReasoningDiv.remove();
      }
      liveReasoningDiv = null;
    }

    // Collapse steps wrapper
    if (stepsContainer) {
      stepsContainer.open = false;
      const label = stepsContainer.querySelector(".steps-label");
      const stepCount = stepsContainer.querySelectorAll(".turn-card").length;
      if (label) label.textContent = `${stepCount} step${stepCount !== 1 ? "s" : ""} completed`;
    }
    stepsContainer = null;
    currentTurnCard = null;
    currentToolsList = null;
    document.getElementById("send-btn").classList.remove("hidden");
    document.getElementById("stop-btn").classList.add("hidden");
  } else if (msg.type === "tab_changed") {
    pinnedTabId = msg.tabId;
    const select = document.getElementById("target-tab-select");
    if (select) select.value = String(msg.tabId);
    refreshTabDropdown();
  }
});

// ---- Session bar ----

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function initSessions() {
  const data = await chrome.storage.local.get(["sessions", "activeSessionId"]);
  const sessions = Object.values(data.sessions || {}).sort((a, b) => a.createdAt - b.createdAt);
  renderSessionBar(sessions, data.activeSessionId);
}

function renderSessionBar(sessions, activeId) {
  const active = sessions.find(s => s.id === activeId);
  const name = active?.name || "Session";
  document.getElementById("session-picker-label").textContent = name.slice(0, 16) || "Session";
}

function renderSessionDropdown(sessions, activeId) {
  const list = document.getElementById("session-list");
  list.innerHTML = "";
  sessions.forEach(s => {
    const item = document.createElement("div");
    item.className = `picker-item${s.id === activeId ? " active" : ""}`;
    item.innerHTML = `
      <span class="picker-item-name" data-id="${s.id}">${escapeHtml(s.name)}</span>
      <div class="picker-item-actions">
        <button class="session-rename-btn icon-btn" data-id="${s.id}" title="Rename">✎</button>
        <button class="session-delete-btn icon-btn" data-id="${s.id}" title="Delete">✕</button>
      </div>`;
    list.appendChild(item);
  });
  list.querySelectorAll(".picker-item-name").forEach(el => {
    el.addEventListener("click", () => doSwitchSession(el.dataset.id));
  });
  list.querySelectorAll(".session-rename-btn").forEach(btn => {
    btn.addEventListener("click", e => { e.stopPropagation(); doRenameSession(btn.dataset.id); });
  });
  list.querySelectorAll(".session-delete-btn").forEach(btn => {
    btn.addEventListener("click", e => { e.stopPropagation(); doDeleteSession(btn.dataset.id); });
  });
}

function closeAllPickers() {
  document.getElementById("session-picker-panel").classList.add("hidden");
  document.getElementById("tab-picker-panel").classList.add("hidden");
  document.getElementById("agent-picker-panel").classList.add("hidden");
  document.getElementById("session-picker-btn").classList.remove("active");
  document.getElementById("tab-picker-btn").classList.remove("active");
  document.getElementById("agent-picker-btn").classList.remove("active");
}

async function openSessionDropdown() {
  const panel = document.getElementById("session-picker-panel");
  const btn = document.getElementById("session-picker-btn");
  if (!panel.classList.contains("hidden")) {
    closeAllPickers();
    return;
  }
  closeAllPickers();
  const data = await chrome.storage.local.get(["sessions", "activeSessionId"]);
  const sessions = Object.values(data.sessions || {}).sort((a, b) => a.createdAt - b.createdAt);
  renderSessionDropdown(sessions, data.activeSessionId);
  panel.classList.remove("hidden");
  btn.classList.add("active");
}

async function doSwitchSession(id) {
  closeAllPickers();
  const result = await chrome.runtime.sendMessage({ type: "switch_session", sessionId: id });
  if (result.ok) {
    await loadSettings();
    updateProviderBadge();
    updateCopilotStatus();
    clearChatMessages();
    restoreHistory(result.history);
    const data = await chrome.storage.local.get(["sessions", "activeSessionId"]);
    const sessions = Object.values(data.sessions || {}).sort((a, b) => a.createdAt - b.createdAt);
    renderSessionBar(sessions, id);
  }
}

async function doCreateSession() {
  const name = prompt("Session name:", `Session ${Date.now().toString().slice(-4)}`);
  if (name === null) return;
  const result = await chrome.runtime.sendMessage({ type: "create_session", name: name.trim() || "New Session" });
  if (result.session) {
    const data = await chrome.storage.local.get(["sessions", "activeSessionId"]);
    const sessions = Object.values(data.sessions || {}).sort((a, b) => a.createdAt - b.createdAt);
    renderSessionBar(sessions, result.session.id);
    clearChatMessages();
    addMessage("system", `Session "${result.session.name}" created.`);
    await loadSettings();
    updateProviderBadge();
    updateCopilotStatus();
  }
}

async function doRenameSession(id) {
  const data = await chrome.storage.local.get("sessions");
  const current = data.sessions?.[id];
  if (!current) return;
  const name = prompt("Rename session:", current.name);
  if (!name || name === current.name) return;
  await chrome.runtime.sendMessage({ type: "rename_session", sessionId: id, name: name.trim() });
  const d2 = await chrome.storage.local.get(["sessions", "activeSessionId"]);
  const sessions = Object.values(d2.sessions || {}).sort((a, b) => a.createdAt - b.createdAt);
  renderSessionBar(sessions, d2.activeSessionId);
  renderSessionDropdown(sessions, d2.activeSessionId);
}

async function doDeleteSession(id) {
  const data = await chrome.storage.local.get("sessions");
  const current = data.sessions?.[id];
  if (!current) return;
  if (!confirm(`Delete session "${current.name}"?`)) return;
  const result = await chrome.runtime.sendMessage({ type: "delete_session", sessionId: id });
  if (result.ok) {
    const d2 = await chrome.storage.local.get(["sessions", "activeSessionId"]);
    const sessions = Object.values(d2.sessions || {}).sort((a, b) => a.createdAt - b.createdAt);
    renderSessionBar(sessions, result.activeSessionId);
    closeAllPickers();
    if (result.activeSessionId !== id) return;
    clearChatMessages();
    restoreHistory(result.history || []);
    await loadSettings();
    updateProviderBadge();
    updateCopilotStatus();
  }
}

// Close pickers when clicking outside
document.addEventListener("click", (e) => {
  const pickerWraps = document.querySelectorAll(".picker-wrap");
  const clickedInsidePicker = Array.from(pickerWraps).some(w => w.contains(e.target));
  if (!clickedInsidePicker) closeAllPickers();
});

document.getElementById("session-picker-btn").addEventListener("click", openSessionDropdown);
document.getElementById("new-session-btn").addEventListener("click", doCreateSession);

// ---- Tab picker ----

document.getElementById("tab-picker-btn").addEventListener("click", async () => {
  const panel = document.getElementById("tab-picker-panel");
  const btn = document.getElementById("tab-picker-btn");
  if (!panel.classList.contains("hidden")) { closeAllPickers(); return; }
  closeAllPickers();
  await refreshTabDropdown();
  renderTabPanel();
  panel.classList.remove("hidden");
  btn.classList.add("active");
});

// ---- Agent picker ----

let activeAgentId = "default";

function renderAgentPanel(agents) {
  const list = document.getElementById("agent-list");
  list.innerHTML = "";
  if (!agents || agents.length === 0) {
    list.innerHTML = `<div class="picker-item" style="opacity:0.5;cursor:default">No agents found</div>`;
    return;
  }
  agents.forEach(agent => {
    const item = document.createElement("div");
    item.className = `picker-item${agent.id === activeAgentId ? " active" : ""}`;
    const icon = agent.icon ? `<span style="margin-right:5px">${escapeHtml(agent.icon)}</span>` : "";
    item.innerHTML = `<span class="picker-item-name">${icon}${escapeHtml(agent.name)}</span>`;
    if (agent.description) {
      item.title = agent.description;
    }
    item.addEventListener("click", async () => {
      const result = await chrome.runtime.sendMessage({ type: "switch_agent", agentId: agent.id });
      if (result.ok) {
        activeAgentId = agent.id;
        document.getElementById("agent-picker-label").textContent = agent.name.slice(0, 16);
        addMessage("system", `Agent switched to "${agent.name}".`, { autoRemove: 3000 });
      }
      closeAllPickers();
    });
    list.appendChild(item);
  });
}

document.getElementById("agent-picker-btn").addEventListener("click", async () => {
  const panel = document.getElementById("agent-picker-panel");
  const btn = document.getElementById("agent-picker-btn");
  if (!panel.classList.contains("hidden")) { closeAllPickers(); return; }
  closeAllPickers();
  const list = document.getElementById("agent-list");
  list.innerHTML = `<div class="picker-item" style="opacity:0.5;cursor:default">Loading...</div>`;
  panel.classList.remove("hidden");
  btn.classList.add("active");
  const result = await chrome.runtime.sendMessage({ type: "list_agents" });
  if (result) {
    activeAgentId = result.activeAgentId || activeAgentId;
    renderAgentPanel(result.agents || []);
  }
});

async function initAgentPicker() {
  const result = await chrome.runtime.sendMessage({ type: "list_agents" });
  if (result && result.agents && result.agents.length > 0) {
    activeAgentId = result.activeAgentId || "default";
    const active = result.agents.find(a => a.id === activeAgentId);
    if (active) {
      document.getElementById("agent-picker-label").textContent = active.name.slice(0, 16);
    }
  }
}

// ---- Chat helpers ----

function clearChatMessages() {
  document.getElementById("messages").innerHTML = "";
  liveReasoningDiv = null;
  streamingDiv     = null;
  currentTurnCard  = null;
  currentToolsList = null;
  stepsContainer   = null;
}

function restoreHistory(history) {
  if (!history || history.length === 0) {
    addMessage("system", "Ready. Configure API in settings (⚙), then type a message.");
    return;
  }
  for (const msg of history) {
    if (msg.role === "user") {
      const content = Array.isArray(msg.content)
        ? (msg.content.find(c => c.type === "text")?.text || "")
        : (msg.content || "");
      // Strip the tab context annotation appended for the LLM before displaying
      const display = content.replace(/\n\n\[Context:[^\]]*\]$/s, "").trim();
      if (display) addMessage("user", display);
    } else if (msg.role === "assistant" && msg.content) {
      const div = document.createElement("div");
      div.className = "msg agent";
      div.innerHTML = marked.parse(msg.content);
      document.getElementById("messages").appendChild(div);
      scrollChat();
    }
  }
}

// ---- History panel ----

const historyPanel = document.getElementById("history-panel");
document.getElementById("history-toggle").addEventListener("click", async () => {
  const history = await chrome.runtime.sendMessage({ type: "get_history" });
  document.getElementById("history-json").value = JSON.stringify(history, null, 2);
  historyPanel.classList.remove("hidden");
});
document.getElementById("history-close").addEventListener("click", () => {
  historyPanel.classList.add("hidden");
});

// ---- Init ----
loadSettings();
updateProviderBadge();
updateCopilotStatus();
initSessions();
initAgentPicker();


// Explicit disclosure before any task sends page content to the AI provider.
chrome.storage.local.get("aiDataConsent").then(data => {
  document.getElementById("ai-data-consent").checked = data.aiDataConsent === true;
});
document.getElementById("ai-data-consent").addEventListener("change", async event => {
  await chrome.storage.local.set({ aiDataConsent: event.target.checked });
  if (!event.target.checked) chrome.runtime.sendMessage({ type: "stop_run" });
});
document.getElementById("clear-local-data").addEventListener("click", async () => {
  if (!confirm("Delete all ChromePilot sessions, saved credentials and settings on this device?")) return;
  await chrome.runtime.sendMessage({ type: "stop_run" });
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  localStorage.clear();
  chrome.runtime.reload();
});
