# ChromePilot Browser Agent

ChromePilot is a Manifest V3 Chrome extension that observes and automates ordinary web pages using DOM snapshots, screenshots, browser actions, and an LLM.

## AI Provider Compatibility

As of now, ChromePilot is designed and tested to work with **GitHub Copilot**. Other AI subscriptions or providers may not work reliably with the current build. If you need support for another provider, please reach out at [chaturvediabhay24@gmail.com](mailto:chaturvediabhay24@gmail.com).

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
6. Configure GitHub Copilot, AWS Bedrock, or a custom OpenAI-compatible API in Settings.

Reload the extension after changing files.

## Providers

- GitHub Copilot uses the device sign-in flow.
- AWS Bedrock accepts AWS credentials and a model ID.
- Custom API accepts an OpenAI-compatible chat-completions URL, token, and model ID.

## Structure

- `content-script.js` observes pages and executes browser actions.
- `service-worker.js` runs the observe-think-act loop.
- `sidepanel/` contains the chat and settings UI.
- `skills/` can contain optional generic Markdown workflows.
