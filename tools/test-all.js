// Automated test runner for NOAPI?
// Tests the complete stack:
//  1. HTTP chat completion (non-streaming)
//  2. HTTP chat completion (streaming)
//  3. MCP in proxy mode (standalone bridge running, opencode spawns MCP proxy)
//  4. MCP in local mode (no standalone bridge, opencode spawns bridge + MCP directly)
import { spawn } from "node:child_process";
import { WsClient } from "../bridge/wsclient.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  try {
    return { status: r.status, data: JSON.parse(text) };
  } catch {
    return { status: r.status, raw: text };
  }
}

async function run() {
  console.log("=== NOAPI? Test Suite ===\n");

  // Step 1: Start standalone bridge
  console.log("1. Starting standalone bridge on :8787...");
  const bridgeProc = spawn("node", ["bridge/index.js"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  bridgeProc.stderr.on("data", (d) => process.stderr.write("  [bridge] " + d));
  await sleep(1000);

  const health1 = await fetchJson("http://127.0.0.1:8787/health");
  if (!health1.data?.ok) throw new Error("bridge health check failed");
  console.log("   ✓ bridge is listening, health ok");

  // Step 2: Start fake browser extension
  console.log("2. Connecting fake browser extension...");
  const fakeProc = spawn("node", ["tools/fake-extension.js", "chatgpt"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  fakeProc.stdout.on("data", (d) => process.stderr.write("  [fake] " + d));
  await sleep(1500);

  const health2 = await fetchJson("http://127.0.0.1:8787/health");
  if (!health2.data?.clients?.length) throw new Error("fake browser did not register");
  console.log(`   ✓ fake browser connected (clients: ${health2.data.clients.length})`);

  // Step 3: Test HTTP chat completions (non-stream)
  console.log("3. Testing POST /v1/chat/completions (non-stream)...");
  const comp1 = await fetchJson("http://127.0.0.1:8787/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "chatgpt",
      messages: [{ role: "user", content: "What is 2+2?" }],
    }),
  });
  const text1 = comp1.data?.choices?.[0]?.message?.content || "";
  if (!text1.includes("fake chatgpt")) {
    throw new Error(`unexpected completion: ${JSON.stringify(comp1)}`);
  }
  console.log(`   ✓ got reply: "${text1.slice(0, 60)}..."`);

  // Step 4: Test HTTP chat completions (streaming)
  console.log("4. Testing POST /v1/chat/completions (streaming)...");
  const streamResp = await fetch("http://127.0.0.1:8787/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "chatgpt",
      messages: [{ role: "user", content: "stream please" }],
      stream: true,
    }),
  });
  const streamText = await streamResp.text();
  if (!streamText.includes("data:") || !streamText.includes("[DONE]")) {
    throw new Error(`invalid SSE stream:\n${streamText}`);
  }
  console.log("   ✓ streaming SSE received chunks + [DONE]");

  // Step 5: Test MCP in PROXY mode (bridge is running on :8787)
  console.log("5. Testing MCP stdio in proxy mode (forwarding to running bridge)...");
  const mcpProxy = spawn("node", ["bridge/index.js", "--mcp"], {
    cwd: process.cwd(),
  });
  const proxyOut = [];
  mcpProxy.stdout.on("data", (d) => {
    for (const line of d.toString("utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed) {
        try {
          proxyOut.push(JSON.parse(trimmed));
        } catch {}
      }
    }
  });

  mcpProxy.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    }) + "\n"
  );
  await sleep(400);

  mcpProxy.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "status", arguments: {} },
    }) + "\n"
  );
  await sleep(400);

  mcpProxy.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "chat", arguments: { prompt: "test MCP proxy" } },
    }) + "\n"
  );
  await sleep(2500);

  mcpProxy.kill();
  const proxyChat = proxyOut.find((m) => m.id === 3);
  const proxyChatText = proxyChat?.result?.content?.[0]?.text || "";
  if (!proxyChatText.includes("fake chatgpt")) {
    throw new Error(`MCP proxy chat failed: ${JSON.stringify(proxyChat)}`);
  }
  console.log(`   ✓ MCP proxy chat reply: "${proxyChatText.slice(0, 60)}..."`);

  // Clean up standalone bridge & fake
  bridgeProc.kill();
  fakeProc.kill();
  await sleep(1000);

  // Step 6: Test MCP in LOCAL mode (MCP process starts bridge directly)
  console.log("6. Testing MCP in LOCAL mode (no standalone bridge running)...");
  const mcpLocal = spawn("node", ["bridge/index.js", "--mcp"], {
    cwd: process.cwd(),
  });
  const localOut = [];
  mcpLocal.stdout.on("data", (d) => {
    for (const line of d.toString("utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed) {
        try {
          localOut.push(JSON.parse(trimmed));
        } catch {}
      }
    }
  });
  await sleep(1000);

  // Connect fake browser directly to the MCP process's bridge!
  const fakeProc2 = spawn("node", ["tools/fake-extension.js", "claude"], {
    cwd: process.cwd(),
  });
  await sleep(1500);

  mcpLocal.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    }) + "\n"
  );
  await sleep(400);

  mcpLocal.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "chat", arguments: { prompt: "test MCP local mode", site: "claude" } },
    }) + "\n"
  );
  await sleep(2500);

  mcpLocal.kill();
  fakeProc2.kill();

  const localChat = localOut.find((m) => m.id === 2);
  const localChatText = localChat?.result?.content?.[0]?.text || "";
  if (!localChatText.includes("fake claude")) {
    throw new Error(`MCP local chat failed: ${JSON.stringify(localChat)}`);
  }
  console.log(`   ✓ MCP local chat reply: "${localChatText.slice(0, 60)}..."`);

  console.log("\n=================================");
  console.log("  ALL TESTS PASSED SUCCESSFULLY!  ");
  console.log("=================================\n");
  process.exit(0);
}

run().catch((err) => {
  console.error("\nTEST FAILED:", err.message);
  process.exit(1);
});
