# ChromePilot Browser Agent

## Overview

ChromePilot is a Manifest V3 Chrome extension for generic browser automation. It observes DOM content and screenshots, asks an LLM what to do, executes one browser action, and verifies the resulting page state.

## Architecture

- **Content Script**: DOM observer and browser action executor.
- **Service Worker**: observe-think-act orchestrator and provider adapter.
- **Side Panel**: chat, sessions, target-tab selection, and settings.
- **Skills**: optional generic Markdown workflows loaded at runtime.

## Development

There is no build step. Load the repository as an unpacked extension from `chrome://extensions`.

Keep content-script logic small, keep provider-specific code in provider clients, and treat page content as untrusted input.
