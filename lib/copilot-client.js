/*
 * GitHub Copilot adapter for the extension service worker.
 *
 * GitHub's Copilot endpoints are used directly so a user's Copilot license and
 * enterprise policy remain the source of authorization. The Copilot access
 * token is short-lived, so it is kept only in this service worker and renewed
 * from the GitHub device-flow token when needed.
 */

const COPILOT_OAUTH_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
const COPILOT_DEFAULT_API_URL = "https://api.githubcopilot.com";
const COPILOT_EDITOR_VERSION = "vscode/1.98.0";
const COPILOT_PLUGIN_VERSION = "copilot-chat/0.26.7";

let cachedCopilotToken = null;

function copilotHeaders(token, initiator) {
  return {
    "Accept": "application/json",
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Editor-Version": COPILOT_EDITOR_VERSION,
    "Editor-Plugin-Version": COPILOT_PLUGIN_VERSION,
    "Copilot-Integration-Id": "vscode-chat",
    "OpenAI-Intent": "conversation-panel",
    "X-GitHub-Api-Version": "2025-04-01",
    "X-Initiator": initiator || "user",
    "User-Agent": `GitHubCopilotChat/${COPILOT_PLUGIN_VERSION.split("/")[1]}`,
    "X-VSCode-User-Agent-Library-Version": "electron-fetch",
    "X-Request-Id": crypto.randomUUID()
  };
}

async function responseError(response, context) {
  const text = await response.text();
  let detail = text;
  try {
    const body = JSON.parse(text);
    detail = body.message || body.error_description || body.error || text;
  } catch (error) {}
  if (typeof detail === "object") detail = JSON.stringify(detail);
  return new Error(`${context} (${response.status}): ${String(detail).slice(0, 500)}`);
}

async function copilotStartDeviceFlow() {
  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ client_id: COPILOT_OAUTH_CLIENT_ID, scope: "read:user" })
  });
  if (!response.ok) throw await responseError(response, "Could not start GitHub sign-in");

  const data = await response.json();
  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error("GitHub sign-in returned an incomplete device code response.");
  }
  return data;
}

async function copilotPollForToken(deviceCode, intervalSeconds) {
  const interval = Math.max(Number(intervalSeconds) || 5, 5);
  const deadline = Date.now() + 15 * 60 * 1000;
  let delay = interval * 1000;

  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, delay));
    const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_id: COPILOT_OAUTH_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      })
    });
    if (!response.ok) throw await responseError(response, "GitHub sign-in failed");

    const data = await response.json();
    if (data.access_token) return data.access_token;
    if (data.error === "authorization_pending") continue;
    if (data.error === "slow_down") {
      delay += 5000;
      continue;
    }
    if (data.error === "expired_token") throw new Error("The GitHub device code expired. Start sign-in again.");
    if (data.error === "access_denied") throw new Error("GitHub sign-in was denied.");
    throw new Error(`GitHub sign-in failed: ${data.error_description || data.error || "unknown error"}`);
  }

  throw new Error("GitHub sign-in timed out. Start sign-in again.");
}

function copilotTokenIsValid(token, githubToken) {
  return token && token.githubToken === githubToken && token.token && token.expiresAt > Date.now() + 30_000;
}

async function getCopilotToken(githubToken, forceRefresh) {
  if (!githubToken) throw new Error("Sign in with GitHub before using Copilot.");
  if (!forceRefresh && copilotTokenIsValid(cachedCopilotToken, githubToken)) return cachedCopilotToken;

  const response = await fetch(COPILOT_TOKEN_URL, {
    headers: {
      "Accept": "application/json",
      "Authorization": `token ${githubToken}`,
      "Editor-Version": COPILOT_EDITOR_VERSION,
      "Editor-Plugin-Version": COPILOT_PLUGIN_VERSION,
      "User-Agent": `GitHubCopilotChat/${COPILOT_PLUGIN_VERSION.split("/")[1]}`,
      "X-GitHub-Api-Version": "2025-04-01",
      "X-VSCode-User-Agent-Library-Version": "electron-fetch"
    }
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("GitHub sign-in expired. Sign in with GitHub again.");
    }
    if (response.status === 403) {
      throw new Error("This GitHub account is not entitled to GitHub Copilot, or its organization policy blocks this extension.");
    }
    throw await responseError(response, "Could not authorize GitHub Copilot");
  }

  const data = await response.json();
  if (!data.token) throw new Error("GitHub Copilot authorization returned no access token.");
  cachedCopilotToken = {
    githubToken,
    token: data.token,
    apiUrl: data.endpoints?.api || COPILOT_DEFAULT_API_URL,
    expiresAt: Number(data.expires_at || 0) * 1000 || Date.now() + 25 * 60 * 1000
  };
  return cachedCopilotToken;
}

function normalizeCopilotApiUrl(apiUrl) {
  return apiUrl.replace(/\/$/, "");
}

function collectToolCallDelta(buffers, toolCalls) {
  for (const toolCall of toolCalls) {
    const index = toolCall.index ?? 0;
    if (!buffers[index]) {
      buffers[index] = { id: "", type: "function", function: { name: "", arguments: "" } };
    }
    if (toolCall.id) buffers[index].id = toolCall.id;
    if (toolCall.type) buffers[index].type = toolCall.type;
    if (toolCall.function?.name) buffers[index].function.name += toolCall.function.name;
    if (toolCall.function?.arguments) buffers[index].function.arguments += toolCall.function.arguments;
  }
}

function copilotUsesResponsesApi(model) {
  return /^gpt-5\.6(?:[-.]|$)/i.test(model || "");
}

function toResponsesInput(messages) {
  const instructions = [];
  const input = [];

  for (const message of messages) {
    if (message.role === "system" || message.role === "developer") {
      if (message.content) instructions.push(message.content);
      continue;
    }
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: message.content || ""
      });
      continue;
    }
    if (message.role === "assistant") {
      if (message.content) {
        input.push({
          role: "assistant",
          content: [{ type: "output_text", text: message.content }]
        });
      }
      for (const toolCall of message.tool_calls || []) {
        input.push({
          type: "function_call",
          call_id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments
        });
      }
      continue;
    }
    input.push({
      role: message.role || "user",
      content: [{ type: "input_text", text: message.content || "" }]
    });
  }

  return { instructions: instructions.join("\n\n"), input };
}

function toResponsesTools(tools) {
  return (tools || []).map(tool => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: false
  }));
}

function addResponsesFunctionCall(toolCalls, item) {
  if (!item?.call_id || !item?.name) return;
  toolCalls[item.call_id] = {
    id: item.call_id,
    type: "function",
    function: { name: item.name, arguments: item.arguments || "" }
  };
}

async function copilotResponsesCompletion(messages, tools, config, broadcast, auth) {
  const converted = toResponsesInput(messages);
  const request = {
    model: config.modelId,
    instructions: converted.instructions || undefined,
    input: converted.input,
    stream: true
  };
  if (tools?.length) {
    request.tools = toResponsesTools(tools);
    request.tool_choice = "auto";
  }

  const response = await fetch(`${normalizeCopilotApiUrl(auth.apiUrl)}/responses`, {
    method: "POST",
    headers: copilotHeaders(auth.token, messages.some(message => message.role === "assistant" || message.role === "tool") ? "agent" : "user"),
    body: JSON.stringify(request)
  });
  if (!response.ok) throw await responseError(response, "GitHub Copilot Responses API request failed");
  if (!response.body) throw new Error("GitHub Copilot returned no Responses API stream.");

  broadcast({ type: "stream_start" });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const toolCalls = {};
  let content = "";
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop();

      for (const event of events) {
        const type = event.split("\n").find(line => line.startsWith("event:"))?.slice(6).trim();
        const data = event.split("\n")
          .filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).trim())
          .join("\n");
        if (!data || data === "[DONE]") continue;

        let chunk;
        try { chunk = JSON.parse(data); } catch (error) { continue; }
        const eventType = type || chunk.type;
        if (eventType === "response.output_text.delta" && chunk.delta) {
          content += chunk.delta;
          broadcast({ type: "stream_delta", content: chunk.delta });
        } else if (eventType === "response.output_item.done") {
          addResponsesFunctionCall(toolCalls, chunk.item);
        } else if (eventType === "response.completed") {
          for (const item of chunk.response?.output || []) addResponsesFunctionCall(toolCalls, item);
        }
      }
    }
  } finally {
    broadcast({ type: "stream_end" });
  }

  const responseToolCalls = Object.values(toolCalls);
  if (!content && responseToolCalls.length === 0) throw new Error("GitHub Copilot returned an empty Responses API response.");
  const result = { role: "assistant", content };
  if (responseToolCalls.length) result.tool_calls = responseToolCalls;
  return result;
}

async function copilotChatCompletion(messages, tools, config, broadcast) {
  const auth = await getCopilotToken(config.githubToken);
  if (copilotUsesResponsesApi(config.modelId)) {
    return copilotResponsesCompletion(messages, tools, config, broadcast, auth);
  }
  const request = {
    model: config.modelId || "gpt-4o",
    messages,
    stream: true,
    temperature: 0.2
  };
  if (tools?.length) {
    request.tools = tools;
    request.tool_choice = "auto";
  }

  const response = await fetch(`${normalizeCopilotApiUrl(auth.apiUrl)}/chat/completions`, {
    method: "POST",
    headers: copilotHeaders(auth.token, messages.some(message => message.role === "assistant" || message.role === "tool") ? "agent" : "user"),
    body: JSON.stringify(request)
  });
  if (!response.ok) {
    if (response.status === 401) cachedCopilotToken = null;
    throw await responseError(response, "GitHub Copilot chat request failed");
  }
  if (!response.body) throw new Error("GitHub Copilot returned no response stream.");

  broadcast({ type: "stream_start" });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const toolCallBuffers = {};
  let content = "";
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop();

      for (const event of events) {
        const data = event.split("\n")
          .filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).trim())
          .join("\n");
        if (!data || data === "[DONE]") continue;

        let chunk;
        try { chunk = JSON.parse(data); } catch (error) { continue; }
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          content += delta.content;
          broadcast({ type: "stream_delta", content: delta.content });
        }
        if (delta.tool_calls) collectToolCallDelta(toolCallBuffers, delta.tool_calls);
      }
    }
  } finally {
    broadcast({ type: "stream_end" });
  }

  const toolCalls = Object.keys(toolCallBuffers)
    .sort((a, b) => Number(a) - Number(b))
    .map(key => toolCallBuffers[key]);
  if (!content && toolCalls.length === 0) throw new Error("GitHub Copilot returned an empty response.");

  const result = { role: "assistant", content };
  if (toolCalls.length) result.tool_calls = toolCalls;
  return result;
}

async function copilotFetchModels(config) {
  const auth = await getCopilotToken(config.githubToken);
  const response = await fetch(`${normalizeCopilotApiUrl(auth.apiUrl)}/models`, {
    headers: copilotHeaders(auth.token)
  });
  if (!response.ok) throw await responseError(response, "Could not load GitHub Copilot models");

  const payload = await response.json();
  const models = Array.isArray(payload) ? payload : (payload.data || payload.models || []);
  return models
    .filter(model => model?.id || typeof model === "string")
    .map(model => typeof model === "string" ? { id: model } : model);
}
