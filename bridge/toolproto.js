// Prompt-based tool calling for web chat UIs.
//
// Websites like ChatGPT/Claude have no OpenAI-style `tools` channel, so we
// teach the model a tiny text protocol instead:
//
//   ```
//   TOOL_CALL
//   {"name":"bash","arguments":{"command":"mkdir chatgpt-test"}}
//   ```
//
// The bridge (1) injects the tool list + protocol into the first prompt of a
// conversation, (2) renders tool results / new user messages as the next
// prompt, and (3) parses TOOL_CALL blocks out of the reply and converts them
// into real OpenAI `tool_calls` so OpenCode executes them.
import crypto from "node:crypto";

const MAX_TOOL_RESULT = 24_000;
const MAX_DESC = 380;

function msgText(m) {
  const c = m?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : p?.text || "")).join("");
  return "";
}

function clip(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function clipMiddle(s, n) {
  s = String(s || "");
  if (s.length <= n) return s;
  const half = Math.floor(n / 2);
  return `${s.slice(0, half)}\n[... ${s.length - n} chars truncated ...]\n${s.slice(-half)}`;
}

function describeType(schema, depth = 0) {
  if (!schema || typeof schema !== "object") return "any";
  if (Array.isArray(schema.enum)) return schema.enum.map((v) => JSON.stringify(v)).join("|");
  let t = schema.type;
  if (Array.isArray(t)) t = t.filter((x) => x !== "null").join("|") || "any";
  if (t === "array") return `array<${describeType(schema.items, depth + 1)}>`;
  if (t === "object" || schema.properties) {
    if (depth >= 2 || !schema.properties) return "object";
    const req = new Set(schema.required || []);
    const inner = Object.entries(schema.properties)
      .map(([k, v]) => `${k}${req.has(k) ? "" : "?"}: ${describeType(v, depth + 1)}`)
      .join(", ");
    return `{${inner}}`;
  }
  return t || "any";
}

export function toolList(tools) {
  return (tools || [])
    .map((t) => (t?.type === "function" || t?.function ? t.function : t))
    .filter((f) => f && typeof f.name === "string");
}

export function toolsHash(tools) {
  const fns = toolList(tools).map((f) => [f.name, f.parameters]);
  return crypto.createHash("sha1").update(JSON.stringify(fns)).digest("hex").slice(0, 12);
}

function renderTool(f) {
  const props = f.parameters?.properties || {};
  const req = new Set(f.parameters?.required || []);
  const params = Object.entries(props)
    .map(([k, v]) => {
      const d = v?.description ? ` - ${clip(v.description, 140)}` : "";
      return `    - ${k}${req.has(k) ? " (required)" : " (optional)"}: ${describeType(v)}${d}`;
    })
    .join("\n");
  return `* ${f.name}: ${clip(f.description, MAX_DESC)}\n${params || "    (no parameters)"}`;
}

function envHints(messages) {
  const sys = (messages || []).filter((m) => m.role === "system").map(msgText).join("\n");
  const out = [];
  const wd = sys.match(/Working directory:\s*(.+)/i);
  const plat = sys.match(/Platform:\s*(.+)/i);
  if (wd) out.push(`Working directory: ${wd[1].trim()}`);
  if (plat) out.push(`Platform: ${plat[1].trim()}`);
  return out;
}

export function renderPreamble(tools, messages) {
  const fns = toolList(tools);
  const hints = envHints(messages);
  return [
    "You are being used as the brain of OpenCode, a coding agent that runs on the user's computer.",
    "You cannot run anything yourself in this chat, BUT the agent can run tools for you: when you need to act (create files or folders, run commands, read or edit files, search...), request a tool call using the exact format below. Never say that you are unable to access the computer or the file system - request the tool instead.",
    "",
    "FORMAT - to call a tool, output a fenced code block whose first line is TOOL_CALL, followed by one JSON object:",
    "```",
    "TOOL_CALL",
    '{"name": "<tool name>", "arguments": {<arguments as JSON>}}',
    "```",
    "",
    "RULES:",
    "1. Use only the tools listed below and give every required argument.",
    "2. You may output several TOOL_CALL blocks in one reply if they are independent.",
    "3. After the TOOL_CALL block(s) STOP writing. Do not guess the result. The agent runs the tools and replies with TOOL_RESULT messages.",
    "4. When the task is finished, or no tool is needed, answer normally in plain text WITHOUT any TOOL_CALL block.",
    "5. Keep text outside TOOL_CALL blocks short. Do not repeat these instructions.",
    ...(hints.length ? ["", ...hints] : []),
    "",
    "AVAILABLE TOOLS:",
    ...fns.map(renderTool),
    "",
    "---",
  ].join("\n");
}

// Everything the website has not seen yet: messages after the last assistant
// turn (user text and tool results), rendered as plain text.
export function buildDelta(messages) {
  const msgs = (messages || []).filter((m) => m.role !== "system");
  let lastAssistant = -1;
  msgs.forEach((m, i) => {
    if (m.role === "assistant") lastAssistant = i;
  });
  const fresh = msgs.slice(lastAssistant + 1);

  const callNames = new Map();
  for (const m of msgs) {
    for (const tc of m.tool_calls || []) callNames.set(tc.id, tc.function?.name || "tool");
  }

  const parts = [];
  let sawUser = false;
  let sawTool = false;
  for (const m of fresh) {
    if (m.role === "user") {
      const t = msgText(m).trim();
      if (t) {
        parts.push(t);
        sawUser = true;
      }
    } else if (m.role === "tool") {
      sawTool = true;
      const name = callNames.get(m.tool_call_id) || m.name || "tool";
      parts.push(
        `TOOL_RESULT ${name} (id ${m.tool_call_id})\n${clipMiddle(msgText(m).trim() || "(empty output)", MAX_TOOL_RESULT)}\nEND_TOOL_RESULT`
      );
    }
  }
  return {
    text: parts.join("\n\n"),
    isNew: lastAssistant === -1,
    sawTool,
    sawUser,
  };
}

export function buildPrompt(messages, tools, { includePreamble }) {
  const d = buildDelta(messages);
  const hasTools = toolList(tools).length > 0;
  let text = d.text;
  if (hasTools && d.sawTool) {
    text +=
      "\n\nContinue the task. If you need more tools, output TOOL_CALL block(s) and stop; if the task is finished, give the final answer in plain text.";
  }
  if (hasTools && includePreamble) {
    text = `${renderPreamble(tools, messages)}\n\n${text}`;
  }
  return { prompt: text, isNew: d.isNew };
}

// ---------------------------------------------------------------- parsing

function extractJsonObject(text, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { raw: text.slice(start, i + 1), end: i + 1 };
    }
  }
  return null;
}

function tryParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {}
  try {
    // tolerate smart quotes and trailing commas
    const fixed = raw.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(fixed);
  } catch {}
  return null;
}

function normalizeCall(obj, names) {
  if (!obj || typeof obj !== "object") return null;
  const name = obj.name || obj.tool || obj.tool_name || obj.function?.name;
  let args = obj.arguments ?? obj.parameters ?? obj.args ?? obj.input ?? obj.function?.arguments ?? {};
  if (typeof name !== "string") return null;
  const match = names.find((n) => n === name) || names.find((n) => n.toLowerCase() === name.toLowerCase());
  if (!match) return null;
  if (typeof args === "string") {
    const p = tryParse(args);
    args = p && typeof p === "object" ? p : {};
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) args = {};
  return {
    id: `call_${crypto.randomBytes(8).toString("hex")}`,
    type: "function",
    function: { name: match, arguments: JSON.stringify(args) },
  };
}

// Returns { calls: [...openai tool_calls], text: reply without the call blocks }
export function parseToolCalls(reply, tools) {
  const names = toolList(tools).map((f) => f.name);
  const text = String(reply || "");
  if (!names.length) return { calls: [], text: text.trim() };

  const spans = [];
  const calls = [];

  const tryAt = (markerStart, searchFrom) => {
    const brace = text.indexOf("{", searchFrom);
    if (brace === -1 || brace - searchFrom > 80) return;
    const ext = extractJsonObject(text, brace);
    if (!ext) return;
    const call = normalizeCall(tryParse(ext.raw), names);
    if (!call) return;
    calls.push(call);
    spans.push([markerStart, ext.end]);
  };

  // 1) explicit sentinel
  const re = /TOOL_CALL\b/g;
  let m;
  while ((m = re.exec(text))) {
    if (spans.some(([a, b]) => m.index >= a && m.index < b)) continue;
    tryAt(m.index, m.index + m[0].length);
  }

  // 2) fallback: a bare JSON object with a known tool name
  if (!calls.length) {
    const reObj = /\{\s*"(?:name|tool)"\s*:\s*"/g;
    while ((m = reObj.exec(text))) {
      if (spans.some(([a, b]) => m.index >= a && m.index < b)) continue;
      const ext = extractJsonObject(text, m.index);
      if (!ext) continue;
      const call = normalizeCall(tryParse(ext.raw), names);
      if (!call) continue;
      calls.push(call);
      spans.push([m.index, ext.end]);
    }
  }

  if (!calls.length) return { calls: [], text: text.trim() };

  spans.sort((a, b) => a[0] - b[0]);
  let out = "";
  let cursor = 0;
  for (const [a, b] of spans) {
    out += text.slice(cursor, a).replace(/```[\w-]*[ \t]*\n?[ \t]*$/, "");
    cursor = b;
    const rest = text.slice(cursor);
    const fence = rest.match(/^[ \t]*\n?[ \t]*```/);
    if (fence) cursor += fence[0].length;
  }
  out += text.slice(cursor);
  out = out.replace(/```[\w-]*\s*```/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return { calls, text: out };
}

// OpenCode asks the model for a session title with a tiny tool-less request.
// Typing that into the user's real chat would pollute it, so answer locally.
export function isTitleRequest(messages, tools) {
  if (toolList(tools).length) return false;
  const sys = (messages || []).filter((m) => m.role === "system").map(msgText).join("\n");
  return /title generator|generate a (short |brief )?title|thread title|conversation title/i.test(sys);
}

export function localTitle(messages) {
  const users = (messages || []).filter((m) => m.role === "user");
  const t = msgText(users[0]).replace(/\s+/g, " ").trim();
  return clip(t, 50) || "New session";
}
