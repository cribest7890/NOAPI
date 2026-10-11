// HTTP server:
//  - /v1/models            OpenAI-compatible model list (one entry per site)
//  - /v1/chat/completions  OpenAI-compatible chat endpoint (what opencode's
//                          "@ai-sdk/openai-compatible" provider calls)
//  - /health               JSON status
//  - /                     human status dashboard
import http from "node:http";
import { SITES, SITE_KEYS } from "./sites.js";
import { requestAllowed } from "./security.js";
import { buildPrompt, parseToolCalls, toolList, toolsHash, isTitleRequest, localTitle } from "./toolproto.js";

function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
  });
  res.end(body);
}

function errorJson(res, code, message, type = "invalid_request_error") {
  sendJson(res, code, { error: { message, type, code } });
}

function estimateTokens(s) {
  return Math.ceil(String(s || "").length / 4);
}

function completionResponse(model, text, calls = []) {
  const message = { role: "assistant", content: text || (calls.length ? null : "") };
  if (calls.length) message.tool_calls = calls;
  return {
    id: `chatcmpl-noapi-${Date.now().toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: calls.length ? "tool_calls" : "stop" }],
    usage: {
      prompt_tokens: 0,
      completion_tokens: estimateTokens(text),
      total_tokens: estimateTokens(text),
    },
  };
}

function dashboardHtml() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>NOAPI? bridge</title>
<style>
  :root { color-scheme: dark; }
  body { font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; background: #0b0d12; color: #e5e7eb; margin: 0; padding: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #9ca3af; margin-bottom: 24px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #9ca3af; margin: 24px 0 8px; }
  table { border-collapse: collapse; width: 100%; }
  td, th { text-align: left; padding: 6px 10px; border-bottom: 1px solid #1f2430; }
  th { color: #9ca3af; font-weight: 600; }
  .ok { color: #4ade80; } .warn { color: #fbbf24; } .bad { color: #f87171; }
  code { background: #1f2430; padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
  <h1>NOAPI? bridge</h1>
  <div class="sub">Use AI websites in your browser as models for opencode — no API keys.</div>
  <div id="content">loading…</div>
<script>
async function render() {
  const el = document.getElementById("content");
  try {
    const r = await fetch("/health");
    const s = await r.json();
    const clientRows = s.clients.map(c =>
      \`<tr><td>\${c.id}</td><td class="\${c.site ? "ok" : "warn"}">\${c.site || "no site"}</td><td>\${c.url || ""}</td></tr>\`
    ).join("") || '<tr><td colspan="3" class="bad">no browser connected — load the NOAPI? extension and open a supported AI site</td></tr>';
    const pendingRows = s.pending.map(p =>
      \`<tr><td>\${p.id}</td><td>\${p.site || "any"}</td><td>\${p.chars}</td><td>\${Math.round(p.waitingMs / 1000)}s</td></tr>\`
    ).join("") || '<tr><td colspan="4">none</td></tr>';
    const siteRows = s.sites.map(x =>
      \`<tr><td><code>\${x.key}</code></td><td>\${x.name}</td><td class="\${x.available ? "ok" : "bad"}">\${x.available ? "available" : "not connected"}</td></tr>\`
    ).join("");
    el.innerHTML = \`
      <h2>browser clients</h2>
      <table><tr><th>id</th><th>site</th><th>url</th></tr>\${clientRows}</table>
      <h2>pending requests</h2>
      <table><tr><th>id</th><th>site</th><th>chars</th><th>waiting</th></tr>\${pendingRows}</table>
      <h2>models</h2>
      <table><tr><th>id</th><th>name</th><th>status</th></tr>\${siteRows}</table>\`;
  } catch (e) {
    el.innerHTML = '<div class="bad">failed to load status</div>';
  }
}
render();
setInterval(render, 2000);
</script>
</body>
</html>`;
}

export function createHttpServer(bridge, log, { host: bindHost = "127.0.0.1" } = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const path = url.pathname;
    try {
      if (!requestAllowed(req, bindHost)) {
        log(`blocked request from origin "${req.headers.origin || "?"}" host "${req.headers.host || "?"}"`);
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Forbidden: this bridge only accepts local clients.", type: "forbidden" } }));
        return;
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": req.headers.origin || "null",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        });
        res.end();
        return;
      }
      if (path === "/" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(dashboardHtml());
        return;
      }
      if (path === "/health" && req.method === "GET") {
        sendJson(res, 200, bridge.status());
        return;
      }
      if (path === "/v1/models" && req.method === "GET") {
        sendJson(res, 200, {
          object: "list",
          data: SITES.map((s) => ({
            id: s.key,
            object: "model",
            created: 0,
            owned_by: "noapi-browser",
            site: s.name,
          })),
        });
        return;
      }
      if (path === "/v1/chat/completions" && req.method === "POST") {
        const raw = await readBody(req);
        let body;
        try {
          body = JSON.parse(raw || "{}");
        } catch {
          errorJson(res, 400, "Invalid JSON body.");
          return;
        }
        const model = String(body.model || "chatgpt").split("/").pop();
        if (!SITE_KEYS.includes(model)) {
          errorJson(res, 400, `Unknown model "${model}". Supported: ${SITE_KEYS.join(", ")}`);
          return;
        }
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const tools = body.tool_choice === "none" ? [] : toolList(body.tools);
        const stream = Boolean(body.stream);

        // Re-send the tool protocol for new conversations or when the tool set changed.
        const hash = toolsHash(tools);
        const fresh = !messages.some((m) => m.role === "assistant");
        const includePreamble = tools.length > 0 && (fresh || bridge.toolHashes.get(model) !== hash);
        const { prompt } = buildPrompt(messages, tools, { includePreamble });
        const titleOnly = isTitleRequest(messages, tools);
        if (!prompt && !titleOnly) {
          errorJson(res, 400, "No user message found in request.");
          return;
        }

        // Cancel the browser request if OpenCode aborts (Esc / closed).
        const abort = new AbortController();
        res.on("close", () => {
          if (!res.writableEnded) abort.abort();
        });

        const finish = (reply) => {
          const { calls, text } = parseToolCalls(reply, tools);
          if (tools.length) bridge.toolHashes.set(model, hash);
          return { calls, text };
        };
        const ask = (onProgress) =>
          titleOnly
            ? Promise.resolve(localTitle(messages))
            : bridge.requestPrompt({ prompt, site: model, onProgress, signal: abort.signal });

        if (!stream) {
          try {
            const { calls, text } = finish(await ask());
            sendJson(res, 200, completionResponse(model, text, calls));
          } catch (err) {
            log(`chat completion failed: ${err.message}`);
            errorJson(res, 503, err.message, "browser_bridge_error");
          }
          return;
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        const id = `chatcmpl-noapi-${Date.now().toString(36)}`;
        const created = Math.floor(Date.now() / 1000);
        const chunk = (delta, finish_reason = null, extra = {}) =>
          res.write(
            `data: ${JSON.stringify({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta, finish_reason }],
              ...extra,
            })}\n\n`
          );
        chunk({ role: "assistant", content: "" });

        // OpenCode shows reasoning deltas as "Thinking". Stream live status
        // lines while the website works so the UI shows it is busy.
        let lastStatus = "";
        const think = (line) => {
          if (res.writableEnded || line === lastStatus) return;
          lastStatus = line;
          chunk({ reasoning_content: line + "\n" });
        };
        think("Thinking…");
        const keepalive = setInterval(() => {
          if (!res.writableEnded) res.write(": keepalive\n\n");
        }, 10_000);

        try {
          const reply = await ask((status) => think(status));
          const { calls, text } = finish(reply);
          if (text) chunk({ content: text });
          if (calls.length) {
            chunk({
              tool_calls: calls.map((c, index) => ({
                index,
                id: c.id,
                type: "function",
                function: { name: c.function.name, arguments: c.function.arguments },
              })),
            });
          }
          const completion = estimateTokens(reply);
          chunk({}, calls.length ? "tool_calls" : "stop", {
            usage: {
              prompt_tokens: estimateTokens(prompt),
              completion_tokens: completion,
              total_tokens: estimateTokens(prompt) + completion,
            },
          });
          res.write("data: [DONE]\n\n");
        } catch (err) {
          log(`chat completion failed: ${err.message}`);
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ error: { message: err.message, type: "browser_bridge_error" } })}\n\n`);
            res.write("data: [DONE]\n\n");
          }
        } finally {
          clearInterval(keepalive);
          res.end();
        }
        return;
      }
      errorJson(res, 404, `Unknown route: ${req.method} ${path}`);
    } catch (err) {
      log(`http error: ${err.message}`);
      if (!res.headersSent) errorJson(res, 500, err.message);
      else res.end();
    }
  });
  return server;
}
