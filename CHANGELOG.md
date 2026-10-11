# 📜 Changelog

All notable changes to this project are written here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

Nothing yet.

## [0.1.0] - 2026-10-11

First public release. 🎉

### ✨ Added

- Local bridge in plain Node.js with an OpenAI compatible endpoint (`/v1/chat/completions`, `/v1/models`), a health endpoint and a status dashboard
- MCP server over stdio with the `chat`, `status` and `sites` tools, plus a proxy mode that forwards to an already running bridge
- Browser extension for Chrome based browsers (Manifest V3) and Firefox
- Support for ChatGPT, Claude, Gemini, DeepSeek, Perplexity, Grok and Mistral
- **Tool use** for chat websites: the bridge teaches the model a small `TOOL_CALL` text format and turns its replies into real tool calls for OpenCode
- Live "Thinking" status in OpenCode while the website types, sends and answers
- Per site request queue, and cancel support: pressing Esc in OpenCode also stops generation on the website
- Local handling of OpenCode's session title requests, so they do not clutter your chats
- `npm run install-global` to register NOAPI? in the global OpenCode config, so it works from any project folder
- Test suite with a fake browser tab: plain replies, streaming, MCP in both modes, a full tool call round trip and security checks
- README, contributing guide, security policy, code of conduct, issue and pull request templates, and a CI workflow

### 🔧 Changed

- The extension is now fully automatic. The manual "click to send" mode was removed
- Only the assistant's reply is sent back to OpenCode, not the whole page
- Progress updates are no longer dropped, so the status shown in OpenCode matches what the page is doing

### 🐛 Fixed

- DeepSeek entering edit mode on the previous message instead of sending a new one
- DeepSeek prompts that were never sent because the page cleared the chat box. The extension now checks that the text stayed and types it again if needed
- The send button on DeepSeek is now only looked for next to the chat box, so message icons such as edit or copy are never clicked by mistake
- The first prompt of a new chat sometimes not being sent

### 🔐 Security

- The bridge now rejects HTTP requests and WebSocket connections from web pages and from non local hosts. Before this, any website open in your browser could have reached the bridge on `127.0.0.1`. Only the extension, local tools and the dashboard are accepted
- Removed the wildcard `Access-Control-Allow-Origin` header

[Unreleased]: https://github.com/YOUR_USERNAME/noapi/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/YOUR_USERNAME/noapi/releases/tag/v0.1.0
