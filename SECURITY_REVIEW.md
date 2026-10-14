# Release preparation security review

Scope: static inspection of bundled source on October 14, 2026. No authenticated runtime/network audit has been completed. These findings describe behavior, not the original author's intent.

## Removed or corrected

- Silent conversation upload: saveConversationToBackend sent conversation history and an email-derived name to /conversations/save. It used a configured API base or a hard-coded plaintext HTTP IP endpoint and suppressed errors. Removed the function, its invocation and related conversation-ID helper.
- Remote JavaScript evaluation: the evaluate tool passed an AI-supplied expression to new Function in the main page world. Removed its schema and executor.
- Cookie and website local-storage tools could expose authentication/session data to the model. Removed the tools and cookies permission.
- Structured snapshots included password values. Password input values are now omitted in both snapshot formats; screenshots and other text are not fully redacted.
- A reasoning display path assigned model text to innerHTML before Markdown rendering. Changed it to textContent.
- Automatic content-script injection on every page load was removed. Scripts are injected for task tabs as needed; injected scripts remain until page reload/closure.
- Added explicit data-use consent, a worker-side task gate, per-tool stop/consent checks, an enabled-tool check, and a local-data deletion control.

## Still unresolved

1. Copilot integration provenance: lib/copilot-client.js contains a fixed OAuth client ID, copilot_internal endpoint, VS Code version headers and vscode-chat integration identity. No evidence here establishes ownership or authorization for public use. This is a release blocker, not proof of credential theft. Do not simply substitute a new client ID and assume compatibility.
2. Credentials and history reside in extension local storage, not a credential vault. Sessions can retain separate token copies. Signing out of one session does not sign out all sessions or revoke GitHub access. Delete all local data and revoke GitHub authorization when needed.
3. HTTP/HTTPS host access remains broad. Consider optional per-site permissions; current workflows include tab switching and navigation, so this requires functional redesign and testing.
4. The agent can click, type and submit forms without a dedicated per-action approval mechanism. Page prompt injection or model errors can cause unintended actions. Do not use on sensitive accounts until stronger action confirmation is implemented.
5. Console/network capture wrappers remain. Their output, if captured and requested, can contain secrets. They execute in an isolated content-script world, so actual page capture behavior needs runtime verification.
6. Screenshots and ordinary page text may contain private data. Password-field redaction alone does not provide general secret protection.
7. Old sessions can contain previously collected sensitive data. Source changes do not erase those sessions or retract data already sent to a server. Use the new deletion control.
8. Removed code remains in earlier Git commits; new commits intentionally preserve history. Previously installed copies need to be updated/reloaded.

No other hidden upload endpoint was identified in inspected source. This does not establish that all behavior is safe; authenticate and inspect network traffic before release.
