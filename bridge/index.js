#!/usr/bin/env node
// NOAPI? bridge — bridges opencode <-> your browser <-> AI websites.
//
//   node index.js            # standalone: HTTP + WebSocket server
//   node index.js --mcp      # same, plus MCP server on stdio (for opencode)
//
// If the port is already in use (e.g. you run a standalone bridge) and this
// process is started by opencode with --mcp, it falls back to *proxy* mode:
// it connects to the running bridge and forwards MCP tool calls to it.
//
// Flags:
//   --port=8787     TCP port for HTTP/WS (default 8787)
//   --host=127.0.0.1  bind address (default 127.0.0.1 — keep it local!)
//   --mcp           also run the MCP server on stdin/stdout

import { Bridge } from "./state.js";
import { createHttpServer } from "./http.js";
import { attachWebSocketServer } from "./ws.js";
import { requestAllowed } from "./security.js";
import { runMcpStdio, ProxyGateway } from "./mcp.js";

function parseArgs(argv) {
  const args = { port: 8787, host: "127.0.0.1", mcp: false };
  for (const a of argv) {
    if (a === "--mcp") args.mcp = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a.startsWith("--port=")) args.port = Number(a.slice(7));
    else if (a.startsWith("--host=")) args.host = a.slice(7);
  }
  return args;
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "NOAPI? bridge\n" +
        "usage: node bridge/index.js [--mcp] [--port=8787] [--host=127.0.0.1]\n"
    );
    return;
  }
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
    process.stderr.write("invalid --port\n");
    process.exit(1);
  }

  const log = (...a) => process.stderr.write("[noapi] " + a.join(" ") + "\n");

  // ---- start the HTTP + WS server (the actual bridge) ----
  let bridge = null;
  let server = null;
  try {
    const b = new Bridge({ log });
    server = createHttpServer(b, log, { host: args.host });
    function handleProxyMessage(conn, msg) {
      if (msg.t === "proxy-status") {
        conn.send(JSON.stringify({ t: "proxy-status-response", id: msg.id, data: b.status() }));
      } else if (msg.t === "proxy-sites") {
        conn.send(JSON.stringify({ t: "proxy-sites-response", id: msg.id, data: b.sites() }));
      } else if (msg.t === "proxy-request") {
        const timeoutMs = Math.min(Math.max(Number(msg.timeout_ms) || 180_000, 10_000), 600_000);
        b
          .requestPrompt({
            prompt: String(msg.prompt || ""),
            system: msg.system || undefined,
            site: msg.site || undefined,
            timeoutMs,
          })
          .then((text) => {
            conn.send(JSON.stringify({ t: "proxy-response", id: msg.id, data: text }));
          })
          .catch((err) => {
            conn.send(JSON.stringify({ t: "proxy-error", id: msg.id, error: err.message }));
          });
      }
    }

    attachWebSocketServer(server, {
      verify: (req) => {
        const ok = requestAllowed(req, args.host);
        if (!ok) log(`blocked websocket from origin "${req.headers.origin || "?"}"`);
        return ok;
      },
      onOpen: (conn) => {
        conn.helloTimer = setTimeout(() => {
          if (!b.clients.has(conn) && !conn.isProxy) {
            log("closing websocket that never sent a hello");
            conn.close();
          }
        }, 10_000);
      },
      onMessage: (conn, text) => {
        let msg;
        try {
          msg = JSON.parse(text);
        } catch {
          return;
        }
        if (msg.t === "hello") {
          clearTimeout(conn.helloTimer);
          if (msg.client === "noapi-mcp-proxy") {
            conn.isProxy = true;
            log("mcp proxy client connected (this process will forward to this bridge)");
            conn.send(JSON.stringify({ t: "welcome", bridge: "noapi-bridge", version: "0.1.0" }));
            return;
          }
          b.register(conn, { site: msg.site || null, url: msg.url || null });
          conn.send(JSON.stringify({ t: "welcome", bridge: "noapi-bridge", version: "0.1.0" }));
        } else if (msg.t === "hello-update") {
          b.register(conn, { site: msg.site || null, url: msg.url || null });
        } else if (msg.t === "heartbeat") {
          b.touch(conn);
          if (msg.site) b.register(conn, { site: msg.site, url: msg.url });
        } else if (msg.t === "response") {
          b.respond(conn, msg.id, msg.text);
        } else if (msg.t === "progress") {
          b.progress(msg.id, msg.status);
        } else if (msg.t === "error") {
          b.fail(conn, msg.id, msg.error);
        } else if (msg.t === "ping") {
          conn.send(JSON.stringify({ t: "pong" }));
        } else if (conn.isProxy) {
          handleProxyMessage(conn, msg);
        }
      },
      onClose: (conn) => {
        clearTimeout(conn.helloTimer);
        b.unregister(conn);
      },
    });
    await listen(server, args.port, args.host);
    bridge = b; // only usable after the port is actually bound
    log(`listening on http://${args.host}:${args.port}`);
    log("dashboard: http://127.0.0.1:" + args.port + "/");
  } catch (err) {
    if (err.code === "EADDRINUSE" && args.mcp) {
      log(`port ${args.port} is in use — assuming a bridge is already running; running in proxy mode`);
    } else {
      log(`failed to start: ${err.message}`);
      log("if the port is taken, try: node bridge/index.js --port=8788 (and update opencode.json)");
      process.exit(1);
    }
  }

  // ---- MCP on stdio ----
  let gateway;
  if (bridge) {
    gateway = bridge;
  } else {
    const proxy = new ProxyGateway(`ws://${args.host}:${args.port}`, { log });
    proxy._connect();
    gateway = proxy;
    log("MCP active in proxy mode (forwarding to the running bridge)");
  }
  if (args.mcp) runMcpStdio(gateway, log);

  const shutdown = () => {
    log("shutting down");
    if (gateway?.stop) gateway.stop();
    if (server) server.close(() => process.exit(0));
    else process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
