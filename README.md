# NOAPI? — Use AI Models in OpenCode Without APIs

**NOAPI?** lets you use major AI models (**ChatGPT**, **Claude**, **Gemini**, **DeepSeek**, **Perplexity**, **Grok**, and **Mistral**) inside [OpenCode](https://opencode.ai) **without paying for API keys** by bridging your logged-in browser session to a local bridge.

Works on **Windows**, **macOS**, and **Linux** with **Google Chrome** (plus Edge, Brave, Opera, Arc) and **Mozilla Firefox**.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Your Browser                          │
│                                                             │
│   ChatGPT / Claude / Gemini / DeepSeek / Perplexity / Grok / Mistral   │
│         ▲                                                   │
│         │  (types prompt into UI, captures reply)           │
│         ▼                                                   │
│   ┌──────────────────────────────────────────────────┐      │
│   │   NOAPI? Browser Extension                       │      │
│   │   • Injects floating "NOAPI?" button on AI sites │      │
│   │   • Manual mode (click to send) or Auto mode     │      │
│   └──────────────────────────────────────────────────┘      │
└───────────────────────────▲─────────────────────────────────┘
                            │
              WebSocket (ws://127.0.0.1:8787)
                            │
┌───────────────────────────▼─────────────────────────────────┐
│              NOAPI? Local Bridge (:8787)                    │
│   • Zero dependencies (runs on pure Node.js >= 18)          │
│   • OpenAI-compatible API endpoint (POST /v1/chat/completions)│
│   • MCP Server over stdio (tools: chat, status, sites)      │
│   • Status dashboard (http://127.0.0.1:8787/)               │
└───────────────────────────▲─────────────────────────────────┘
                            │
              Local Loopback / Stdio IPC
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                        OpenCode                             │
│   • Select model via /models (e.g. noapi/chatgpt)           │
│   • OR let your agent call the MCP tool (noapi_chat)        │
└─────────────────────────────────────────────────────────────┘
```

---

## ⚡ Quick Start

### 1. Requirements
- **Node.js 18+** installed (`node -v`)
- **Chrome** or **Firefox**
- **OpenCode** installed

---

### 2. Load the Extension in Your Browser

#### In Google Chrome / Brave / Edge / Arc / Opera:
1. Open `chrome://extensions` in your browser.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the `extension/chrome` folder inside this repository.

#### In Mozilla Firefox:
1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on...**
3. Select `extension/firefox/manifest.json`.

---

### 3. Start the Bridge

You can run the bridge standalone or let OpenCode start it automatically:

```bash
# Start standalone bridge
node bridge/index.js
# Or with npm:
npm start
```

Visit the dashboard in your browser: **http://127.0.0.1:8787/**

---

### 4. Open Any Supported AI Website
Open one (or more) of the supported sites in your browser and make sure you are logged in:
- **ChatGPT**: https://chatgpt.com
- **Claude**: https://claude.ai
- **Gemini**: https://gemini.google.com
- **DeepSeek**: https://chat.deepseek.com
- **Perplexity**: https://www.perplexity.ai
- **Grok**: https://grok.com
- **Mistral**: https://chat.mistral.ai


You will see a floating **`?`** button in the bottom-right corner with a **green status dot** indicating the bridge is connected.

---

### 5. Use in OpenCode

An `opencode.json` configuration is already included in this repository.

#### Way A: Use the Browser Model Directly (via OpenAI Provider)
Run OpenCode in this directory:
```bash
opencode
```
In OpenCode:
1. Type `/models` and search for **NOAPI?**
2. Pick any connected browser model:
   - `noapi/chatgpt`
   - `noapi/claude`
   - `noapi/gemini`
   - `noapi/deepseek`
   - `noapi/perplexity`
   - `noapi/grok`
   - `noapi/mistral`
3. Prompt normally! Every prompt goes straight to your open browser tab.

#### Way B: Use via MCP Tool with Any Model
Keep your favourite primary model in OpenCode (e.g. Zen, Claude, or a local model) and ask it to query the browser:
```
Ask ChatGPT via the noapi tool how to implement quicksort in Rust
```

---

## 🔍 How Tool Prompts Work in OpenCode (Answer to Your Question)

> **"I think opencode automatically sends his prompt for the tools but I'm not sure, so check that."**

**Yes, confirmed!**
According to the [OpenCode MCP Documentation](https://opencode.ai/docs/mcp-servers/):
> *"Once added, MCP tools are automatically available to the LLM alongside built-in tools."*

When you register an MCP server in `opencode.json` under `"mcp"`:
1. OpenCode registers all tools exposed by the MCP server (`chat`, `status`, `sites`).
2. When the LLM decides to call a tool, OpenCode **automatically packages the LLM's arguments (including the prompt)** into the `tools/call` JSON-RPC message and sends it to the bridge over stdio.
3. The bridge routes the prompt to your active browser tab, captures the website's response, and returns it to OpenCode.
4. OpenCode feeds the result back to the LLM. **Zero manual prompt passing needed!**

---

## 🎛️ The On-Website Button (always automatic)

The floating **`?`** button only shows status (green = bridge connected, amber = working) and a **Stop** button. There is no manual mode: every OpenCode prompt is typed, sent and captured automatically, and only the assistant's reply goes back to OpenCode (not the whole page).

## 🛠️ Tools & "Thinking" in OpenCode

- **Tools**: the bridge teaches the website model a small `TOOL_CALL` text protocol (sent with the first prompt of a chat). The model's `TOOL_CALL` blocks are converted into real OpenAI `tool_calls`, so OpenCode runs `bash`, `write`, `edit`... and sends back the results.
- **Thinking**: while the site works, live status lines are streamed as reasoning, so OpenCode shows *Thinking*.
- Prompts to the same site are queued one at a time; pressing Esc in OpenCode stops generation on the site.

## 📁 Using NOAPI? from any project folder

The `opencode.json` in this repo only applies when you run `opencode` *inside* this folder. To use NOAPI? from any project, register it globally once:

```bash
cd /path/to/NOAPI
npm run install-global      # or: node tools/install-global.js   (--remove to undo)
```

Then, in your project folder, just run `opencode` and pick **NOAPI?** from `/models`. Keep the bridge running with `npm start` in a terminal (recommended: it then stays up regardless of how many OpenCode sessions you open). If the repo folder is moved, run the command again.

## ⚙️ `opencode.json` Configuration

If you want to use NOAPI? globally across all your projects, add this to `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "noapi": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "NOAPI? (browser bridge)",
      "options": {
        "baseURL": "http://127.0.0.1:8787/v1",
        "apiKey": "noapi-local"
      },
      "models": {
        "chatgpt": { "name": "ChatGPT (browser)", "limit": { "context": 128000, "output": 8192 } },
        "claude": { "name": "Claude (browser)", "limit": { "context": 200000, "output": 8192 } },
        "gemini": { "name": "Gemini (browser)", "limit": { "context": 1000000, "output": 8192 } },
        "deepseek": { "name": "DeepSeek (browser)", "limit": { "context": 128000, "output": 8192 } },
        "perplexity": { "name": "Perplexity (browser)", "limit": { "context": 100000, "output": 8192 } },
        "grok": { "name": "Grok (browser)", "limit": { "context": 128000, "output": 8192 } },
        "mistral": { "name": "Mistral (browser)", "limit": { "context": 128000, "output": 8192 } }
      }
    }
  },
  "mcp": {
    "noapi": {
      "type": "local",
      "command": ["node", "/path/to/NOAPI?/bridge/index.js", "--mcp"],
      "enabled": true,
      "timeout": 30000
    }
  }
}
```

*(Replace `/path/to/NOAPI?` with the absolute path to this folder).*

---

## 🧪 Testing Without a Real Browser

You can test the entire stack in automated or manual test mode without opening a real browser:

```bash
# Automated end-to-end test (runs in ~5 seconds)
npm test

# Or manual fake browser:
node bridge/index.js
node tools/fake-extension.js chatgpt   # In another terminal
curl -X POST http://127.0.0.1:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"chatgpt","messages":[{"role":"user","content":"Hello!"}]}'
```

---

## 🔧 Troubleshooting

| Issue | Solution |
|---|---|
| **"No browser tab on [site] is connected"** | Open that AI site in your browser, verify the NOAPI? button shows a green dot, and ensure you are logged in. |
| **Port 8787 in use** | Run `node bridge/index.js --port=8788` and update `baseURL` in `opencode.json` to `:8788/v1`. |
| **Red dot on website button** | The bridge isn't running. Run `node bridge/index.js` or start OpenCode (which auto-spawns it via MCP). |
| **Site changed their DOM layout** | NOAPI? includes smart heuristic fallbacks (`main` transcript diff + generic `contenteditable`/`textarea` detectors) so it stays working even when sites tweak class names. If a site fundamentally redesigns, update `extension/chrome/content.js`. |

---

## 🔒 Security & Privacy

- **100% Local**: All communication stays strictly on `127.0.0.1` (loopback).
- **Zero Third-Party APIs**: No API keys, no proxy servers, no telemetry.
- **Your Session**: Runs under your own logged-in browser context.
