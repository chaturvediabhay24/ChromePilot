/*
 * Bedrock is optional. This definition keeps the service worker loadable when
 * Copilot is the active provider and fails clearly if Bedrock is selected.
 */

async function bedrockChatCompletion() {
  throw new Error("AWS Bedrock is not configured in this extension build. Select GitHub Copilot or Custom API.");
}
