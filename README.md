# ChromePilot Browser Agent

ChromePilot is a Manifest V3 Chrome extension that observes and automates ordinary web pages using DOM snapshots, screenshots, browser actions, and an LLM.

## AI Provider Compatibility

This release targets **GitHub Copilot only** and requires compatible Copilot access. Other AI subscriptions are not supported. Public distribution of the current authentication integration still needs verification; see [release blockers](STORE_SUBMISSION.md). If you need support for another provider, please reach out at [chaturvediabhay24@gmail.com](mailto:chaturvediabhay24@gmail.com).

## Creator

Created by **Abhay Chaturvedi**  
Email: [chaturvediabhay24@gmail.com](mailto:chaturvediabhay24@gmail.com)

## Installation

There is no build step:

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this directory.
5. Pin **ChromePilot - Browser Agent** and open it from the toolbar.
6. Open Settings, review the data disclosure, and sign in with GitHub Copilot. Accept the disclosure before starting a task.

Reload the extension after changing files.

## Providers

- GitHub Copilot uses the device sign-in flow, subject to account and organization restrictions.
- Legacy AWS Bedrock and Custom API code is retained but unavailable for tasks in this release.

## Privacy and release preparation

Review the [privacy policy](privacy.html) before using private pages. Tasks send page content and screenshots to the provider; screenshots are not guaranteed to be redacted. Settings includes consent and a control to delete local sessions, credentials and settings.

The legacy conversation-upload backend, arbitrary JavaScript execution tool, cookie tools and website local-storage tools have been removed. This is not a completed security audit or an approved Chrome Web Store release.

See [security review findings](SECURITY_REVIEW.md) and [store submission materials](STORE_SUBMISSION.md). Run `sh scripts/package.sh` for static checks and a review ZIP. Resolve the documented blockers before submitting it.

## Structure

- `content-script.js` observes pages and executes browser actions.
- `service-worker.js` runs the observe-think-act loop.
- `sidepanel/` contains the chat and settings UI.
- `skills/` can contain optional generic Markdown workflows.
