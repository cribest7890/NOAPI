import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WsClient } from "./wsclient.js";

const SERVER_INFO = { name: "noapi-bridge", version: "0.1.0" };

const INTERNAL_TOOLS = [
  {
    name: "chat",
    description:
      "Send a prompt to an AI chat website (ChatGPT, Claude, Gemini, DeepSeek, Perplexity, Grok, Mistral) that is open and logged-in in the user's browser, and return the model's reply. No API key involved: the prompt is routed through the NOAPI? local bridge into the website's chat UI. The user must have the NOAPI? browser extension active on a supported site.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The prompt / question to send to the AI website.",
        },
        site: {
          type: "string",
          enum: ["chatgpt", "claude", "gemini", "deepseek", "perplexity", "grok", "mistral"],
          description: "Which site to use (defaults to the first connected site).",
        },
        timeout_seconds: {
          type: "number",
          description: "Max seconds to wait for the answer (default 180).",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "status",
    description:
      "NOAPI? bridge status: which browser tabs are connected, which sites are available, and which requests are pending.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "sites",
    description:
      "List the supported AI sites and which ones are currently available in the browser.",
    inputSchema: { type: "object", properties: {} },
  },
];

const globalToolsRegistry = new Map();
const spawnedProcesses = new Set();
const spawnedProcessesFor = new Map();

// Load OpenCode configuration to get available tool descriptions
function loadOpencodeToolDefinitions() {
  try {
    const home = os.homedir();
    const configPaths = [
      path.resolve(home, ".config", "opencode", "opencode.json"),
      path.resolve(home, ".opencode", "opencode.json"),
    ];
    
    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw);
        
        // Extract tool definitions from mcpServers section
        const tools = [];
        const mcpServers = parsed.mcp || {};
        
        for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
          // Skip ourselves to avoid confusion
          if (serverName === "noapi") continue;
          
          // Add each configured server as a tool description for the AI
          const toolDesc = {
            name: serverName,
            description: `MCP server: ${serverConfig.description || `Connect to ${serverName} MCP server`}`,
            // We don't expose the full inputSchema here since we're just describing what's available
            // for the AI to understand what tools it can "ask for" via text patterns
          };
          tools.push(toolDesc);
        }
        
        return tools;
      }
    }
    
    return [];
  } catch (err) {
    console.warn(`[mcp-hub] Could not load OpenCode tool definitions: ${err.message}`);
    return [];
  }
}

// Get formatted tool descriptions for AI context
function getToolDefinitionsForAI() {
  const tools = loadOpencodeToolDefinitions();
  if (tools.length === 0) return "";
  
  let text = "AVAILABLE TOOLS:\nYou have access to the following tools that you can request by name:\n\n";
  for (const tool of tools) {
    text += `- ${tool.name}: ${tool.description}\n`;
  }
  text += "\nWhen you want to use a tool, respond with the tool name followed by your request in a clear format.\n";
  text += "For example: 'files: read the file at /path/to/file.txt' or 'bash: run ls -la'\n\n";
  return text;
}

async function initializeAndCollectTools(proc, name) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      globalToolsRegistry.delete(name);
      resolve(false);
    }, 5000);

    const send = (obj) => {
      proc.stdin.write(JSON.stringify(obj) + "\n");
    };

    let initialized = false;
    let collectingTools = false;
    let allTools = [];

    proc.stdout.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        line = line.trim();
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === "init" && msg.result) {
          initialized = true;
          if (!collectingTools) {
            collectingTools = true;
            send({ jsonrpc: "2.0", id: "tools-" + Date.now(), method: "tools/list", params: {} });
          }
        } else if (msg.id?.toString().startsWith("tools-") && msg.result?.tools) {
          allTools = msg.result.tools;
          globalToolsRegistry.set(name, allTools);
          spawnedProcessesFor.set(name, proc);
          clearTimeout(timeout);
          resolve(true);
        }
      }
    });

    proc.stdin.on("error", () => {
      clearTimeout(timeout);
      globalToolsRegistry.delete(name);
      spawnedProcessesFor.delete(name);
      resolve(false);
    });
  });
}

// Store spawned processes by server name for tool call forwarding
export function registerSpawnedServer(serverName, proc) {
  spawnedProcessesFor.set(serverName, proc);
  spawnedProcesses.add(proc);
}

function spawnExternalServer(entry, log) {
  try {
    const proc = spawn(entry.command, entry.args, {
      cwd: entry.cwd,
      env: entry.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    spawnedProcesses.add(proc);

    proc.stdout?.on("data", () => {});
    proc.stderr?.on("data", (d) => log(`[mcp-hub][${entry.name}] stderr: ${d.toString()}`));

    proc.on("error", (err) => log(`[mcp-hub][${entry.name}] spawn error: ${err.message}`));
    proc.on("exit", (code) => {
      log(`[mcp-hub][${entry.name}] exited with code ${code}`);
      spawnedProcesses.delete(proc);
      globalToolsRegistry.delete(entry.name);
    });

    // Send initialize handshake
    proc.stdin.write(JSON.stringify({ id: "init", method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {} } }) + "\n");
    
    return proc;
  } catch (err) {
    log(`[mcp-hub] failed to spawn ${entry.name}: ${err.message}`);
    return null;
  }
}

async function loadExternalServers(log) {
  const configPath = findOpencodeConfig();
  if (!configPath) {
    log("[mcp-hub] no opencode config found");
    return;
  }

  log(`[mcp-hub] found config at ${configPath}`);
  const entries = loadMcpConfig(configPath);
  if (!entries.length) {
    log("[mcp-hub] no external MCP servers to spawn");
    return;
  }

  for (const entry of entries) {
    log(`[mcp-hub] spawning ${entry.name}...`);
    const proc = spawnExternalServer(entry, log);
    if (proc) {
      await initializeAndCollectTools(proc, entry.name);
    }
  }
}

function cleanupSpawnedProcesses() {
  for (const proc of spawnedProcesses) {
    try {
      proc.kill("SIGTERM");
    } catch {}
  }
  spawnedProcesses.clear();
  globalToolsRegistry.clear();
  spawnedProcessesFor.clear();
}

function findOpencodeConfig() {
  const home = os.homedir();
  const candidates = [
    path.resolve(home, ".config", "opencode", "opencode.json"),
    path.resolve(home, ".config", "opencode", "mcp.json"),
    path.resolve(home, ".opencode", "opencode.json"),
    path.resolve(home, ".opencode", "mcp.json"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function loadMcpConfig(configPath) {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const servers = parsed.mcp || {};
    const result = [];
    for (const [name, entry] of Object.entries(servers)) {
      if (!entry || !entry.command) continue;
      if (name === "noapi" || (entry.command && entry.command.includes("bridge/index.js"))) continue;
      result.push({
        name,
        command: Array.isArray(entry.command) ? entry.command[0] : entry.command,
        args: Array.isArray(entry.command) ? entry.command.slice(1) : (entry.args || []),
        env: { ...process.env, ...(entry.env || {}) },
        cwd: entry.cwd || undefined,
      });
    }
    return result;
  } catch {
    return [];
  }
}

function toolDefs() {
  const externalTools = [];
  for (const [serverName, tools] of globalToolsRegistry) {
    for (const tool of tools) {
      externalTools.push(tool);
    }
  }
  return [...INTERNAL_TOOLS, ...externalTools];
}

function resolveToolOwner(name) {
  if (INTERNAL_TOOLS.some((t) => t.name === name)) return { internal: true };
  for (const [serverName, tools] of globalToolsRegistry) {
    if (tools.some((t) => t.name === name)) return { server: serverName };
  }
  return null;
}

function callTool(gateway, name, args, log) {
  const owner = resolveToolOwner(name);
  if (!owner) throw new Error(`Unknown tool: ${name}`);

  if (owner.internal) {
    switch (name) {
      case "chat": {
        const prompt = String(args.prompt ?? "").trim();
        if (!prompt) throw new Error("The 'prompt' argument is required.");
        const timeoutMs = Math.min(Math.max(Number(args.timeout_seconds) || 180, 10), 600) * 1000;
        log(`mcp chat tool called (site: ${args.site || "any"})`);
        
        // Enrich prompt with OpenCode tool definitions so the AI knows what tools are available
        const toolContext = getToolDefinitionsForAI();
        const enrichedPrompt = toolContext ? `${toolContext}\n\nUser request: ${prompt}` : prompt;
        
        return gateway.requestPrompt({
          prompt: enrichedPrompt,
          system: args.system ? String(args.system) : undefined,
          site: args.site ? String(args.site) : undefined,
          timeoutMs,
        });
      }
      case "status":
        return gateway.status();
      case "sites":
        return gateway.sites();
    }
  }

  return null;
}

function callExternalTool(name, args, log) {
  for (const [serverName, tools] of globalToolsRegistry) {
    if (tools.some((t) => t.name === name)) {
      const proc = spawnedProcessesFor.get(serverName);
      if (!proc) {
        throw new Error(`Server ${serverName} is not running`);
      }
      const tool = tools.find((t) => t.name === name);
      const reqId = "call-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      return new Promise((resolve, reject) => {
        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            reject(new Error(`Timeout waiting for ${serverName} tool ${name}`));
          }
        }, 30000);
        const cleanup = () => {
          if (!resolved) {
            clearTimeout(timeout);
          }
        };
        proc.stdout.once("data", (data) => {
          if (resolved) return;
          try {
            const line = data.toString().trim();
            const msg = JSON.parse(line);
            if (msg.id === reqId) {
              resolved = true;
              clearTimeout(timeout);
              if (msg.error) {
                reject(new Error(msg.error.message || String(msg.error)));
              } else {
                resolve(msg.result);
              }
            }
          } catch {}
        });
        const payload = { jsonrpc: "2.0", id: reqId, method: "tools/call", params: { name, arguments: args } };
        proc.stdin.write(JSON.stringify(payload) + "\n");
      });
    }
  }
  throw new Error(`Unknown tool: ${name}`);
}

function toToolResult(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }], isError: false };
}

export class ProxyGateway {
  constructor(url, { log = () => {} } = {}) {
    this.url = url;
    this.log = log;
    this.ws = null;
    this.connected = false;
    this.pending = new Map();
    this.seq = 0;
    this._reconnectDelay = 500;
    this._stop = false;
  }

  _connect() {
    this.ws = new WsClient(this.url, {
      onOpen: () => {
        this.connected = true;
        this._reconnectDelay = 500;
        this.log(`proxy: connected to running bridge at ${this.url}`);
        try {
          this.ws.send({ t: "hello", client: "noapi-mcp-proxy" });
        } catch {}
      },
      onMessage: (text) => {
        let m;
        try {
          m = JSON.parse(text);
        } catch {
          return;
        }
        if (
          m.t === "proxy-response" ||
          m.t === "proxy-error" ||
          m.t === "proxy-status-response" ||
          m.t === "proxy-sites-response"
        ) {
          const p = this.pending.get(m.id);
          if (!p) return;
          this.pending.delete(m.id);
          clearTimeout(p.timer);
          if (m.t === "proxy-error") p.reject(new Error(m.error || "bridge error"));
          else p.resolve(m.data);
        }
      },
      onClose: () => {
        this.connected = false;
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error("Lost connection to the running bridge."));
        }
        this.pending.clear();
        if (!this._stop) {
          this.log("proxy: bridge connection dropped, will retry");
          setTimeout(() => this._connect(), this._reconnectDelay);
          this._reconnectDelay = Math.min(this._reconnectDelay * 2, 15_000);
        }
      },
      onConnectError: (err) => {
        if (!this._stop) {
          this.log(`proxy: cannot reach bridge at ${this.url} (${err.message}); retrying`);
          setTimeout(() => this._connect(), this._reconnectDelay);
        }
      },
    });
  }

  stop() {
    this._stop = true;
    try {
      this.ws?.close();
    } catch {}
  }

  _call(payload, timeoutMs) {
    const id = `mcp_${Date.now().toString(36)}_${(this.seq += 1)}`;
    payload.id = id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the bridge.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(payload);
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error("Not connected to the bridge. Is 'node bridge/index.js' running?"));
      }
    });
  }

  requestPrompt({ prompt, system, site, timeoutMs = 180_000 }) {
    return this._call(
      { t: "proxy-request", prompt, system: system || null, site: site || null, timeout_ms: timeoutMs },
      timeoutMs + 15_000
    );
  }

  status() {
    return this._call({ t: "proxy-status" }, 10_000);
  }

  sites() {
    return this._call({ t: "proxy-sites" }, 10_000);
  }
}

export function runMcpStdio(gateway, log) {
  process.stdin.setEncoding("utf8");
  let line = "";

  const write = (obj) => {
    process.stdout.write(JSON.stringify(obj) + "\n");
  };

  // Load external MCP servers on startup (after notifications/initialized)
  const initializeExternalServers = async () => {
    try {
      await loadExternalServers(log);
    } catch (err) {
      log(`[mcp-hub] Failed to load external servers: ${err.message}`);
    }
  };

  const handle = async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const { id, method, params } = msg;
    try {
      if (method === "initialize") {
        write({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: params?.protocolVersion || "2024-11-05",
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
          },
        });
      } else if (method === "notifications/initialized") {
        await initializeExternalServers();
      } else if (method === "ping") {
        write({ jsonrpc: "2.0", id, result: {} });
      } else if (method === "tools/list") {
        write({ jsonrpc: "2.0", id, result: { tools: toolDefs() } });
      } else if (method === "tools/call") {
        const name = params?.name;
        const args = params?.arguments ?? {};
        try {
          let value;
          const internalResult = callTool(gateway, name, args, log);
          if (internalResult !== null) {
            value = await internalResult;
          } else {
            value = await callExternalTool(name, args, log);
          }
          write({ jsonrpc: "2.0", id, result: toToolResult(value) });
        } catch (err) {
          write({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: `Error: ${err.message}` }],
              isError: true,
            },
          });
        }
      } else if (id !== undefined) {
        write({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
      }
    } catch (err) {
      if (id !== undefined) {
        write({
          jsonrpc: "2.0",
          id,
          error: { code: -32603, message: String(err?.message || err) },
        });
      }
    }
  };

  process.stdin.on("data", (chunk) => {
    line += chunk;
    let idx;
    while ((idx = line.indexOf("\n")) !== -1) {
      const l = line.slice(0, idx).trim();
      line = line.slice(idx + 1);
      if (l) handle(l);
    }
  });

  process.stdin.on("end", () => {
    cleanupSpawnedProcesses();
    if (gateway?.stop) gateway.stop();
    process.exit(0);
  });
  process.stdout.on("error", () => process.exit(0));
}