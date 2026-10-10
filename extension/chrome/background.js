// NOAPI? background (service worker / event page).
// Maintains WebSocket connection to ws://127.0.0.1:8787, keeps service worker
// alive via heartbeats and port connections, and routes requests to active AI tabs.
(() => {
  "use strict";
  const ext = globalThis.browser || globalThis.chrome;

  const state = {
    ws: null,
    url: "ws://127.0.0.1:8787",
    connected: false,
    reconnectDelay: 1000,
    tabs: new Map(), // tabId -> { site, url, port }
    pending: new Map(), // reqId -> tabId
    heartbeatTimer: null,
  };

  const log = (...a) => {
    try {
      console.log("[noapi-bg]", ...a);
    } catch {}
  };

  function sendWs(obj) {
    if (state.ws && state.ws.readyState === 1) {
      try {
        state.ws.send(JSON.stringify(obj));
        return true;
      } catch (e) {
        log("ws send failed", e);
      }
    }
    return false;
  }

  function broadcastToTabs(msg) {
    for (const [tabId, info] of state.tabs) {
      try {
        if (info.port) {
          info.port.postMessage(msg);
        } else {
          ext.tabs.sendMessage(tabId, msg).catch(() => {});
        }
      } catch {}
    }
  }

  function connect() {
    if (state.ws) {
      if (state.ws.readyState === 0 || state.ws.readyState === 1) return;
      try {
        state.ws.close();
      } catch {}
      state.ws = null;
    }

    log("connecting to", state.url);
    let ws;
    try {
      ws = new WebSocket(state.url);
    } catch (e) {
      log("ws construct error", e);
      scheduleReconnect();
      return;
    }

    state.ws = ws;

    ws.onopen = () => {
      state.connected = true;
      state.reconnectDelay = 1000;
      log("✓ connected to bridge at", state.url);

      // Identify this extension client
      sendWs({
        t: "hello",
        client: "noapi-extension",
        version: "0.1.0",
      });

      // Send all currently active tab sites to bridge
      for (const info of state.tabs.values()) {
        if (info.site) {
          sendWs({ t: "hello-update", site: info.site, url: info.url });
        }
      }

      updateAction();
      broadcastToTabs({ type: "noapi_bridge_status", connected: true });

      // Start periodic keepalive heartbeat (resets Chrome MV3 idle timer)
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = setInterval(() => {
        if (state.connected) {
          sendWs({ t: "heartbeat" });
        }
      }, 10_000);
    };

    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      handleBridgeMessage(m);
    };

    ws.onclose = () => onDrop();
    ws.onerror = (err) => {
      log("ws error:", err);
    };
  }

  function onDrop() {
    const wasConnected = state.connected;
    state.connected = false;
    clearInterval(state.heartbeatTimer);
    try {
      state.ws?.close();
    } catch {}
    state.ws = null;

    if (wasConnected) {
      log("bridge connection closed");
      updateAction();
      broadcastToTabs({ type: "noapi_bridge_status", connected: false });
    }
    scheduleReconnect();
  }

  function scheduleReconnect() {
    setTimeout(connect, state.reconnectDelay);
    state.reconnectDelay = Math.min(state.reconnectDelay * 1.5, 10_000);
  }

  function handleBridgeMessage(m) {
    if (m.t === "welcome") {
      log("bridge welcomed extension");
      return;
    }
    if (m.t === "pong") return;

    if (m.t === "cancel") {
      const tid = state.pending.get(m.id);
      state.pending.delete(m.id);
      updateAction();
      if (tid !== undefined) {
        const info = state.tabs.get(tid);
        const cmsg = { type: "noapi_cancel", id: m.id };
        try {
          if (info?.port) info.port.postMessage(cmsg);
          else ext.tabs.sendMessage(tid, cmsg).catch(() => {});
        } catch {}
      }
      return;
    }

    if (m.t === "request") {
      const { id, prompt, site } = m;
      log(`received bridge request ${id} for site: ${site || "any"}`);

      // Find matching tab
      let targetTabId = null;
      let targetInfo = null;

      if (site) {
        for (const [tid, info] of state.tabs) {
          if (info.site === site) {
            targetTabId = tid;
            targetInfo = info;
            break;
          }
        }
      }

      // Fallback: pick any active tab
      if (targetTabId === null) {
        for (const [tid, info] of state.tabs) {
          targetTabId = tid;
          targetInfo = info;
          break;
        }
      }

      if (targetTabId === null) {
        sendWs({
          t: "error",
          id,
          error: `No open tab found for "${site || "any supported AI site"}". Please open the website in your browser.`,
        });
        return;
      }

      state.pending.set(id, targetTabId);
      updateAction();

      const payload = {
        type: "noapi_autosend",
        id,
        prompt,
        system: m.system || null,
        site: targetInfo.site,
      };

      try {
        if (targetInfo.port) {
          targetInfo.port.postMessage(payload);
        } else {
          ext.tabs.sendMessage(targetTabId, payload).catch((err) => {
            state.pending.delete(id);
            updateAction();
            sendWs({
              t: "error",
              id,
              error: `Could not reach tab ${targetTabId} (${err.message}). Try refreshing the AI website page.`,
            });
          });
        }
      } catch (err) {
        state.pending.delete(id);
        updateAction();
        sendWs({ t: "error", id, error: String(err.message || err) });
      }
    }
  }

  // Handle port connections from content scripts (MV3 persistent channel)
  ext.runtime.onConnect.addListener((port) => {
    if (port.name === "noapi-tab") {
      const tabId = port.sender?.tab?.id;
      if (tabId !== undefined) {
        const existing = state.tabs.get(tabId) || {};
        existing.port = port;
        state.tabs.set(tabId, existing);

        port.onMessage.addListener((msg) => {
          handleContentMessage(msg, tabId);
        });

        port.onDisconnect.addListener(() => {
          const info = state.tabs.get(tabId);
          if (info) info.port = null;
        });

        port.postMessage({
          type: "noapi_bridge_status",
          connected: state.connected,
        });
      }
    }
  });

  // Handle one-off messages
  ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const tabId = sender?.tab?.id;
    handleContentMessage(msg, tabId, sendResponse);
    return true; // async
  });

  function handleContentMessage(msg, tabId, sendResponse) {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case "noapi_hello": {
        if (tabId !== undefined && msg.site) {
          const entry = state.tabs.get(tabId) || {};
          entry.site = msg.site;
          entry.url = msg.url;
          state.tabs.set(tabId, entry);

          if (state.connected) {
            sendWs({ t: "hello-update", site: msg.site, url: msg.url });
          }
          log(`tab ${tabId} registered on ${msg.site}`);
        }
        sendResponse?.({ connected: state.connected, url: state.url });
        break;
      }

      case "noapi_status_req": {
        sendResponse?.({ connected: state.connected, url: state.url });
        break;
      }

      case "noapi_progress": {
        if (msg.id) sendWs({ t: "progress", id: msg.id, status: msg.status });
        sendResponse?.({ ok: true });
        break;
      }

      case "noapi_reply": {
        if (msg.id) {
          state.pending.delete(msg.id);
          sendWs({ t: "response", id: msg.id, text: msg.text });
          log(`replied to bridge for request ${msg.id}`);
          updateAction();
        }
        sendResponse?.({ ok: true });
        break;
      }

      case "noapi_error": {
        if (msg.id) {
          state.pending.delete(msg.id);
          sendWs({ t: "error", id: msg.id, error: msg.error });
          log(`error for request ${msg.id}: ${msg.error}`);
          updateAction();
        }
        sendResponse?.({ ok: true });
        break;
      }

      case "noapi_test_bridge": {
        connect();
        setTimeout(() => {
          sendResponse?.({ connected: state.connected });
        }, 500);
        break;
      }
    }
  }

  ext.tabs.onRemoved.addListener((tabId) => {
    state.tabs.delete(tabId);
    for (const [id, tid] of state.pending) {
      if (tid === tabId) {
        state.pending.delete(id);
        sendWs({ t: "error", id, error: "The AI site tab was closed by the user." });
      }
    }
    updateAction();
  });

  try {
    ext.action?.onClicked?.addListener((tab) => {
      if (tab?.id !== undefined) {
        ext.tabs.sendMessage(tab.id, { type: "noapi_toggle_panel" }).catch(() => {});
      }
    });
  } catch {}

  function updateAction() {
    try {
      const n = state.pending.size;
      ext.action?.setBadgeText?.({ text: n ? String(n) : "" });
      ext.action?.setBadgeBackgroundColor?.({ color: "#f59e0b" });
      ext.action?.setTitle?.({
        title: state.connected
          ? "NOAPI? — Bridge Connected (127.0.0.1:8787)"
          : "NOAPI? — Bridge Offline (run: node bridge/index.js)",
      });
    } catch {}
  }

  (async function init() {
    try {
      const stored = await ext.storage.local.get(["noapi_url"]);
      if (stored.noapi_url) state.url = String(stored.noapi_url);
    } catch {}
    connect();
  })();
})();
