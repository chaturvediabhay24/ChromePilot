# Chrome Web Store submission checklist

Status: preparation build, not verified for public release.

## Blocking owner actions

- Verify authorization to distribute the Copilot integration. The adapter uses a hard-coded OAuth client ID, an internal token endpoint, and VS Code/Copilot identity headers. Ownership and permitted use have not been established. Do not submit until this is resolved with GitHub or replaced with a supported integration. Registering an OAuth app alone does not establish Copilot API access.
- Verify rights to distribute the original code and assets and choose an appropriate license. No license has been invented for this repository.
- Perform the fresh-profile checks below with your own compatible Copilot account. Static checks cannot establish working authentication or model access.
- Review privacy.html against the final product, publish it at a public HTTPS URL (GitHub Pages can host it), and enter that URL in the dashboard.
- Register the Chrome Web Store publisher account, pay its registration fee, and complete required identity/contact verification.
- Capture genuine screenshots of the final extension. Prepare listing artwork according to https://developer.chrome.com/docs/webstore/images.
- Complete data disclosures, distribution and reviewer test access, then submit for review yourself.

## Listing draft

Name: ChromePilot - Browser Agent

Summary: Automate browser tasks from a side panel with GitHub Copilot. Compatible Copilot access required.

Description:
ChromePilot helps you perform browser tasks using natural-language instructions in a Chrome side panel. It can inspect page content, capture screenshots, navigate, and perform predefined browser actions. Select your target tab, describe the task, and follow its progress. Use Stop to interrupt a run.

Compatible GitHub Copilot access is required. Organization policies may restrict access. Other AI subscriptions are not supported in this release. ChromePilot is an independent project and is not endorsed by Google or GitHub.

Prompts, page content, screenshots and task results are sent to the AI provider after consent. AI can make mistakes; review sensitive tasks and avoid confidential pages.

Created by Abhay Chaturvedi. Support: chaturvediabhay24@gmail.com
Project and issue tracker: https://github.com/chaturvediabhay24/ChromePilot

## Single purpose

Help users complete explicitly requested browser tasks through a side-panel assistant using predefined page observation and interaction tools.

## Permission explanations

| Permission | Reason |
| --- | --- |
| activeTab | User-invoked access and visible-tab capture for tasks. |
| scripting | Inject bundled page observation and predefined browser actions into task tabs. |
| sidePanel | Display the assistant interface alongside the webpage. |
| storage | Store consent, settings, credentials and conversation sessions locally. |
| tabs | Identify target tabs by title/URL and switch or navigate tabs during tasks. |
| webNavigation | Enumerate frames for page observation and actions. |
| HTTP/HTTPS hosts | Tasks operate across user-selected websites and call GitHub/Copilot endpoints. Broad host access remains; explain this clearly and evaluate optional per-site grants before wider release. |

## Privacy declarations

Do not declare "no user data collected": page content and screenshots leave the browser.
Review website content, web history/URLs, user activity, authentication information and any personal/sensitive information contained in pages or conversations against the dashboard categories. Describe provider processing even though there is no creator-operated backend.

No remote JavaScript is loaded or evaluated by the removed evaluate tool. The remaining AI-driven selection of packaged actions must still be fully explained to reviewers; approval is not guaranteed.

## Manual acceptance checks

1. Load the release ZIP contents in a fresh Chrome profile; inspect extension errors.
2. Confirm only Copilot and General are visible, creator/contact and privacy policy work, and no task starts without consent.
3. Sign in, fetch models, and run a harmless read-only task on a public page. Check screenshots, navigation, frames and Stop.
4. Revoke consent; verify the run stops and new tasks are blocked.
5. Test session switching/deletion, sign-out and Delete all local data.
6. Verify password values are absent in structured snapshots; do not assume screenshots are redacted.
7. Inspect network traffic: task data must go only to the expected provider and task websites. Confirm no /conversations/save request.
8. Test restricted pages, failed authentication, provider denial and network errors.
9. Verify the packaged version and screenshots match the listing and policy.

## Reviewer instructions draft

Requires compatible GitHub Copilot access, subject to organization restrictions. Open the side panel, review the data disclosure, select consent, then sign in through Settings → GitHub Copilot. Select a model, save, and run a harmless task on a public page. Provide a permitted reviewer test-access method in the dashboard; never commit credentials.

## Build

Run `sh scripts/package.sh`. Output is a local review ZIP under dist/. Do not upload until the blockers above are resolved. This repository now uses new commits for further changes.

Official guidance:
- https://developer.chrome.com/docs/webstore/publish
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements
