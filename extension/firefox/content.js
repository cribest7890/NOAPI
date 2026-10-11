// NOAPI? content script.
// Injects a floating "NOAPI?" control panel on supported AI websites.
// Interacts with chat composers (ChatGPT, Claude, Gemini, Perplexity, Grok, Mistral)
// to send prompts and capture responses for OpenCode via the local bridge.
(() => {
  "use strict";
  if (window.__NOAPI_CONTENT_LOADED__) return;
  window.__NOAPI_CONTENT_LOADED__ = true;

  const ext = globalThis.browser || globalThis.chrome;
  if (!ext || !ext.runtime) return;

  const SITES = {
    chatgpt: {
      name: "ChatGPT",
      hosts: ["chatgpt.com", "chat.openai.com"],
      input: [
        "#prompt-textarea",
        'div#prompt-textarea[contenteditable="true"]',
        'div[contenteditable="true"][data-placeholder]',
        'div[contenteditable="true"][role="textbox"]',
        'div.rich-editor[contenteditable="true"]',
        'textarea[data-id="root"]',
        "textarea",
      ],
      send: [
        'button[data-testid="send-button"]',
        'button[data-testid="fruitjuice-send-button"]',
        'button[aria-label="Send prompt"]',
        'button[aria-label="Send message"]',
        'button[aria-label="Send"]',
        'button[aria-label*="send" i]',
        "#composer-submit-button",
      ],
      stop: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop" i]'],
      reply: [
        '[data-message-author-role="assistant"]',
        'div[data-testid="assistant-message"]',
        "div.agent-turn",
        "div[data-message-model-slug]",
      ],
      transcript: '[data-testid="conversation-turns"], main',
    },
    claude: {
      name: "Claude",
      hosts: ["claude.ai"],
      input: [
        'div[contenteditable="true"].ProseMirror',
        'div[contenteditable="true"][data-testid="cm-editor-content"]',
        'div[contenteditable="true"][role="textbox"]',
        'textarea[aria-label*="message" i]',
        "textarea",
      ],
      send: [
        'button[aria-label="Send Message"]',
        'button[aria-label="Send message"]',
        'button[data-testid="send"]',
        'button[aria-label*="Send" i]',
        'fieldset button[type="button"]',
      ],
      stop: ['button[aria-label*="Stop" i]'],
      reply: [
        '[data-testid="assistant-message"]',
        '[data-message-author-role="assistant"]',
        "div.font-claude-message",
        "div.grid-cols-1",
      ],
      transcript: "main",
    },
    gemini: {
      name: "Gemini",
      hosts: ["gemini.google.com", "gemini.google"],
      input: [
        'div.ql-editor[contenteditable="true"]',
        'rich-textarea div[contenteditable="true"]',
        "textarea#prompt",
        "textarea.textarea",
        'div[contenteditable="true"][data-placeholder]',
        'div[contenteditable="true"][role="textbox"]',
        "textarea",
      ],
      send: [
        "button.send-button",
        'button[aria-label*="Send" i]',
        'button[mattooltip="Send message"]',
        "button.mat-mdc-icon-button",
      ],
      stop: ['button[aria-label*="Stop" i]'],
      reply: [
        "model-response-text",
        'message-content[role="presentation"]',
        '[data-message-author-role="assistant"]',
        "div.response-container",
      ],
      transcript: "main",
    },
    perplexity: {
      name: "Perplexity",
      hosts: ["perplexity.ai"],
      input: [
        'textarea[placeholder*="Ask" i]',
        'textarea[placeholder*="Search" i]',
        'textarea[aria-label*="ask" i]',
        "textarea",
      ],
      send: [
        'button[aria-label*="Submit" i]',
        'button[aria-label*="Send" i]',
        'button[type="submit"]',
      ],
      stop: ['button[aria-label*="Stop" i]'],
      reply: ['div[class*="Answer"]', "article", "div.prose"],
      transcript: "main",
    },
    grok: {
      name: "Grok",
      hosts: ["grok.com"],
      input: [
        'div[contenteditable="true"][role="textbox"]',
        'textarea[placeholder*="Grok" i]',
        "textarea",
      ],
      send: [
        'button[aria-label*="Grok" i]',
        'button[aria-label*="Send" i]',
        'button[type="submit"]',
      ],
      stop: ['button[aria-label*="Stop" i]'],
      reply: ["div.md", "div.message-bubble-assistant", '[class*="markdown"]'],
      transcript: "main",
    },
     mistral: {
       name: "Mistral Chat",
       hosts: ["chat.mistral.ai"],
       input: [
         'textarea[placeholder*="message" i]',
         'div[contenteditable="true"][role="textbox"]',
         "textarea",
       ],
       send: [
         'button[aria-label*="Send" i]',
         'button[type="submit"]',
       ],
       stop: ['button[aria-label*="Stop" i]'],
       reply: ['[data-role="assistant"]', "div.prose", 'div[class*="assistant"]'],
       transcript: "main",
     },
     deepseek: {
       name: "DeepSeek",
       hosts: ["chat.deepseek.com", "deepseek.com"],
       iconSend: true,
       input: [
         "textarea#chat-input",
         'textarea[placeholder*="Message" i]',
         'textarea[placeholder*="DeepSeek" i]',
         'div[contenteditable="true"][role="textbox"]',
         "textarea",
       ],
       send: [
         'div[role="button"][aria-disabled="false"]',
         'button[type="submit"]',
         'button[aria-label*="Send" i]',
       ],
       stop: ['div[role="button"][aria-label*="Stop" i]', 'button[aria-label*="Stop" i]'],
       reply: [
         "div.ds-markdown",
         "div[class*='ds-markdown']",
         '[data-message-author-role="assistant"]',
       ],
       transcript: "main",
     },
   };

  function detectSite() {
    const host = location.hostname.toLowerCase();
    for (const [key, cfg] of Object.entries(SITES)) {
      if (cfg.hosts.some((h) => host === h || host.endsWith("." + h))) {
        return { key, ...cfg };
      }
    }
    return null;
  }

  const SITE = detectSite();
  if (!SITE) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const normalize = (s) => String(s || "").replace(/\n{3,}/g, "\n\n").trim();

  // ---------------- TEXT EXTRACTION ----------------
  // Turn a rendered chat message into clean markdown-ish text, skipping UI
  // chrome (copy buttons, "ChatGPT said:" headings) that innerText would include.
  const SKIP_TAGS = new Set(["BUTTON", "SVG", "STYLE", "SCRIPT", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "IFRAME"]);
  const BLOCK_TAGS = new Set([
    "P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "TR", "BLOCKQUOTE",
    "SECTION", "ARTICLE", "TABLE", "HR", "MESSAGE-CONTENT", "MODEL-RESPONSE-TEXT",
  ]);

  function extractText(root) {
    let out = "";
    const nl = () => {
      if (out && !out.endsWith("\n")) out += "\n";
    };
    const walk = (n) => {
      if (n.nodeType === 3) {
        out += n.nodeValue;
        return;
      }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toUpperCase();
      if (SKIP_TAGS.has(tag)) return;
      if (n.classList && (n.classList.contains("sr-only") || n.classList.contains("visually-hidden"))) return;
      if (tag === "PRE") {
        const code = n.querySelector("code") || n;
        const lang = (code.className || "").match(/language-([\w+-]+)/)?.[1] || "";
        nl();
        out += "```" + lang + "\n" + String(code.textContent || "").replace(/\n+$/, "") + "\n```\n";
        return;
      }
      if (tag === "BR") {
        out += "\n";
        return;
      }
      if (tag === "CODE") {
        out += "`" + n.textContent + "`";
        return;
      }
      const block = BLOCK_TAGS.has(tag);
      if (block) nl();
      if (tag === "LI") out += "- ";
      for (const c of n.childNodes) walk(c);
      if (block) nl();
    };
    walk(root);
    return stripHeader(normalize(out));
  }

  function stripHeader(t) {
    return t
      .replace(/^\s*(?:ChatGPT|Claude|Gemini|DeepSeek|Perplexity|Grok|Mistral)(?: Chat)?\s+said:?\s*\n?/i, "")
      .trim();
  }

  // If a fallback capture included our own prompt echoed back, keep only what follows it.
  function dropEcho(text, prompt) {
    const tail = String(prompt || "").trim().slice(-60);
    if (tail.length < 8) return text;
    const i = text.lastIndexOf(tail);
    return i >= 0 ? text.slice(i + tail.length).trim() : text;
  }

  const state = { bridge: false, busy: false, port: null, cancel: false, reqId: null };

  // ---------------- UI CREATION ----------------
  const host = document.createElement("div");
  host.id = "noapi-host";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
<style>
  :host {
    all: initial;
    display: block;
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  * { box-sizing: border-box; }
  .fab {
    width: 50px;
    height: 50px;
    border-radius: 25px;
    background: #0f172a;
    border: 2px solid #334155;
    color: #38bdf8;
    cursor: pointer;
    position: relative;
    font-size: 20px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    transition: transform 0.15s ease, border-color 0.15s ease;
    user-select: none;
  }
  .fab:hover {
    transform: scale(1.06);
    border-color: #38bdf8;
  }
  .dot {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 12px;
    height: 12px;
    border-radius: 6px;
    background: #ef4444;
    border: 2px solid #0f172a;
    box-shadow: 0 0 6px #ef4444;
  }
  .dot.on {
    background: #22c55e;
    box-shadow: 0 0 8px #22c55e;
  }
  .dot.wait {
    background: #f59e0b;
    box-shadow: 0 0 8px #f59e0b;
    animation: pulse 1s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.85); }
  }
  .badge {
    position: absolute;
    bottom: -2px;
    left: -2px;
    min-width: 18px;
    height: 18px;
    border-radius: 9px;
    background: #f59e0b;
    color: #000;
    font-size: 11px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
    border: 2px solid #0f172a;
  }
  .panel {
    position: absolute;
    right: 0;
    bottom: 60px;
    width: 340px;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 12px;
    padding: 14px;
    box-shadow: 0 12px 36px rgba(0,0,0,0.65);
    color: #f1f5f9;
    font-size: 13px;
    line-height: 1.4;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .title {
    font-weight: 800;
    font-size: 15px;
    color: #38bdf8;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .site-pill {
    background: #1e293b;
    color: #94a3b8;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 6px;
    border: 1px solid #334155;
  }
  .status-bar {
    background: #1e293b;
    border-radius: 8px;
    padding: 6px 10px;
    margin-bottom: 10px;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .status-text {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #cbd5e1;
  }
  .status-text .mini-dot {
    width: 8px;
    height: 8px;
    border-radius: 4px;
    background: #ef4444;
  }
  .status-text .mini-dot.on { background: #22c55e; }
  .mode-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
    font-size: 12px;
    color: #94a3b8;
  }
  .mode-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  textarea {
    width: 100%;
    min-height: 70px;
    max-height: 180px;
    resize: vertical;
    background: #1e293b;
    color: #f1f5f9;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 12.5px;
    font-family: inherit;
    margin-bottom: 8px;
    outline: none;
  }
  textarea:focus { border-color: #38bdf8; }
  .actions {
    display: flex;
    gap: 6px;
  }
  button {
    border: 1px solid #334155;
    background: #1e293b;
    color: #f1f5f9;
    border-radius: 8px;
    padding: 7px 11px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
  }
  button:hover { background: #334155; }
  button.primary {
    background: #0284c7;
    border-color: #0284c7;
    color: #fff;
    flex: 1;
  }
  button.primary:hover { background: #0369a1; }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .log-box {
    margin-top: 10px;
    font-size: 11.5px;
    color: #94a3b8;
    background: #090d16;
    padding: 6px 8px;
    border-radius: 6px;
    min-height: 18px;
    word-break: break-word;
  }
</style>
<div class="panel" hidden>
  <div class="header">
    <div class="title">NOAPI? <span class="site-pill">${SITE.name}</span></div>
    <button class="reconnect-btn" style="padding:2px 8px;font-size:11px">Reconnect</button>
  </div>
  <div class="status-bar">
    <div class="status-text">
      <span class="mini-dot"></span>
      <span class="status-label">Bridge: checking…</span>
    </div>
    <button class="stop-btn" style="padding:2px 8px;font-size:11px" title="Abort the current request" hidden>Stop</button>
  </div>
  <div class="mode-row"><span>Automatic: OpenCode prompts are typed, sent and answered by this tab.</span></div>
  <div class="log-box">Ready. Waiting for OpenCode…</div>
</div>
<div class="fab" title="NOAPI? — Bridge AI chat to OpenCode">
  <span>?</span>
  <div class="dot"></div>
</div>
`;

  const panel = shadow.querySelector(".panel");
  const fab = shadow.querySelector(".fab");
  const dot = shadow.querySelector(".dot");
  const miniDot = shadow.querySelector(".mini-dot");
  const statusLabel = shadow.querySelector(".status-label");
  const stopBtn = shadow.querySelector(".stop-btn");
  const reconnectBtn = shadow.querySelector(".reconnect-btn");
  const logBox = shadow.querySelector(".log-box");

  function attachHost() {
    if (document.body && !document.getElementById("noapi-host")) document.body.appendChild(host);
  }
  attachHost();
  if (document.readyState !== "complete") window.addEventListener("load", attachHost);
  setInterval(attachHost, 3000); // SPAs sometimes wipe the body

  let lastProgress = "";
  let lastProgressAt = 0;
  // report: false = local log only; true = stage change (always forwarded to
  // OpenCode); "tick" = frequent counter updates (throttled, may be skipped).
  function setLog(msg, report = false) {
    logBox.textContent = msg;
    if (report && state.reqId) reportProgress(msg, report === "tick");
  }

  function reportProgress(msg, tick) {
    const now = Date.now();
    if (msg === lastProgress) return;
    if (tick && now - lastProgressAt < 2500) return;
    lastProgress = msg;
    lastProgressAt = now;
    ext.runtime.sendMessage({ type: "noapi_progress", id: state.reqId, status: msg }).catch(() => {});
  }

  function updateStatusUI() {
    dot.className = "dot" + (state.busy ? " wait" : state.bridge ? " on" : "");
    miniDot.className = "mini-dot" + (state.bridge ? " on" : "");
    if (state.busy) {
      statusLabel.textContent = SITE.name + " is working…";
      statusLabel.style.color = "#fbbf24";
    } else if (state.bridge) {
      statusLabel.textContent = "Bridge: Connected (:8787)";
      statusLabel.style.color = "#4ade80";
    } else {
      statusLabel.textContent = "Bridge: Offline (node bridge/index.js)";
      statusLabel.style.color = "#f87171";
    }
    stopBtn.hidden = !state.busy;
  }

  function initPort() {
    try {
      state.port = ext.runtime.connect({ name: "noapi-tab" });
      state.port.onMessage.addListener((msg) => handleIncomingMessage(msg));
      state.port.onDisconnect.addListener(() => {
        state.port = null;
        setTimeout(initPort, 3000);
      });
      state.port.postMessage({ type: "noapi_hello", site: SITE.key, url: location.href });
    } catch (e) {}
  }
  initPort();

  ext.runtime
    .sendMessage({ type: "noapi_hello", site: SITE.key, url: location.href })
    .then((r) => {
      if (r) {
        state.bridge = Boolean(r.connected);
        updateStatusUI();
      }
    })
    .catch(() => {});

  function handleIncomingMessage(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === "noapi_bridge_status") {
      state.bridge = Boolean(msg.connected);
      updateStatusUI();
    } else if (msg.type === "noapi_autosend") {
      setLog("Prompt received from OpenCode…");
      runPipeline(msg.prompt, msg.id).catch(() => {});
    } else if (msg.type === "noapi_cancel") {
      if (state.busy && (!msg.id || msg.id === state.reqId)) cancelCurrent();
    } else if (msg.type === "noapi_toggle_panel") {
      panel.hidden = !panel.hidden;
    }
  }

  ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    handleIncomingMessage(msg);
    sendResponse({ ok: true });
    return true;
  });

  fab.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      ext.runtime
        .sendMessage({ type: "noapi_status_req" })
        .then((r) => {
          if (r) {
            state.bridge = Boolean(r.connected);
            updateStatusUI();
          }
        })
        .catch(() => {});
    }
  });

  reconnectBtn.addEventListener("click", () => {
    setLog("Attempting bridge reconnect…");
    ext.runtime
      .sendMessage({ type: "noapi_test_bridge" })
      .then((r) => {
        state.bridge = Boolean(r?.connected);
        updateStatusUI();
        setLog(state.bridge ? "✓ Reconnected to bridge!" : "Bridge still offline. Start it with 'npm start'.");
      })
      .catch(() => setLog("Could not reach extension background."));
  });

  stopBtn.addEventListener("click", () => cancelCurrent());

  // ---------------- SITE AUTOMATION ENGINE ----------------
  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none";
  }

  async function findComposer() {
    for (const sel of SITE.input) {
      try {
        const el = document.querySelector(sel);
        if (el && visible(el)) return el;
      } catch {}
    }
    const all = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')).filter(
      (e) => visible(e) && !e.closest("#noapi-host")
    );
    return all[all.length - 1] || null;
  }

  // The site may re-render the composer (typically right after the first
  // message of a new chat), so always re-query instead of keeping a stale node.
  async function waitForComposer(ms = 15_000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const c = await findComposer();
      if (c) return c;
      await sleep(300);
    }
    return null;
  }

  const composerText = (el) => String(el?.value ?? el?.innerText ?? el?.textContent ?? "").replace(/\s+/g, " ").trim();

  function isStopVisible() {
    for (const sel of SITE.stop || []) {
      try {
        const b = document.querySelector(sel);
        if (b && visible(b)) return true;
      } catch {}
    }
    return false;
  }

  async function typePromptIntoComposer(el, text) {
    const activeSel = window.getSelection();
    if (activeSel) activeSel.removeAllRanges();

    el.focus();
    await sleep(80);
    
    if (!el.isContentEditable) {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, "");
      else el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      el.innerHTML = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await sleep(50);
    const want = text.replace(/\s+/g, " ").trim();
    const filled = () => {
      const got = composerText(el);
      return got.length >= want.length * 0.95 && got.length <= want.length * 1.2 + 10;
    };

    if (el.isContentEditable) {
      const selectAll = () => {
        el.focus();
        const sel = window.getSelection();
        sel.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.addRange(range);
      };
      selectAll();
      let ok = false;
      try {
        ok = document.execCommand("insertText", false, text);
      } catch {}
      await sleep(120);
      if (!ok || !filled()) {
        selectAll();
        try {
          const dt = new DataTransfer();
          dt.setData("text/plain", text);
          el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
        } catch {}
        await sleep(150);
      }
      if (!filled()) {
        el.textContent = text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      }
    } else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await sleep(250);
  }

  const wantedFilled = (el, text) => {
    const want = text.replace(/\s+/g, " ").trim();
    const got = composerText(el);
    return got.length >= want.length * 0.95;
  };

  // Type the prompt and CHECK it stayed there: frameworks like React may
  // re-render the composer right after our programmatic input and reset it to
  // empty, which leaves the send button disabled and nothing gets sent.
  async function ensureTyped(composer, text) {
    let el = composer;
    for (let attempt = 1; attempt <= 4; attempt++) {
      await typePromptIntoComposer(el, text);
      await sleep(450);
      el = (await findComposer()) || el;
      if (wantedFilled(el, text)) return el;
      setLog(`Text did not stick in the chat box, typing again (${attempt}/4)…`, true);
      await sleep(300);
    }
    return el;
  }

  const isEnabled = (b) => !b.disabled && b.getAttribute("aria-disabled") !== "true";

  // DeepSeek's send button is an icon-only <div role="button"> with no label,
  // and message actions (edit / copy / regenerate) look exactly the same. So
  // never search the whole page: look only at icon-only buttons that sit AFTER
  // the composer in the same container, and take the last one (the send
  // arrow). If it is still disabled, return null so the caller waits or falls
  // back to Enter - never click another icon (attach, edit...).
  function findIconSendButton(composer) {
    if (!composer) return null;
    // While the site is generating, the send arrow turns into a STOP square in
    // the same place. With nothing typed we must never click it.
    if (!composerText(composer)) return null;
    let root = composer;
    for (let i = 0; i < 8 && root.parentElement; i++) {
      root = root.parentElement;
      const cands = Array.from(root.querySelectorAll('div[role="button"], button')).filter(
        (b) =>
          visible(b) &&
          !b.closest("#noapi-host") &&
          !(b.textContent || "").trim() &&
          !b.querySelector('input[type="file"]') &&
          !!(composer.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
      if (cands.length) {
        const last = cands[cands.length - 1];
        return isEnabled(last) ? last : null;
      }
    }
    return null;
  }

  function findSendButton(composer) {
    if (SITE.iconSend) return findIconSendButton(composer);
    for (const sel of SITE.send) {
      try {
        for (const b of document.querySelectorAll(sel)) {
          if (visible(b) && isEnabled(b) && !b.closest("#noapi-host")) {
            return b;
          }
        }
      } catch {}
    }
    return null;
  }

  async function submitComposer(composer) {
    let btn = null;
    for (let i = 0; i < 8 && !btn; i++) {
      btn = findSendButton(composer);
      if (!btn) await sleep(150);
    }
    if (btn) {
      btn.click();
      return true;
    }
    if (composer) {
      composer.focus();
      for (const ev of ["keydown", "keypress", "keyup"]) {
        composer.dispatchEvent(
          new KeyboardEvent(ev, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })
        );
      }
      return true;
    }
    return false;
  }

  // Assistant message nodes currently on the page, innermost only.
  function replyNodes() {
    let nodes = [];
    try {
      nodes = Array.from(document.querySelectorAll(SITE.reply.join(", "))).filter((n) => !n.closest("#noapi-host"));
    } catch {}
    return nodes.filter((n) => !nodes.some((o) => o !== n && n.contains(o)));
  }

  function snapshotLengths(scope) {
    const m = new Map();
    const t0 = Date.now();
    for (const el of scope.querySelectorAll("*")) {
      m.set(el, (el.textContent || "").length);
      if (m.size % 200 === 0 && Date.now() - t0 > 200) break; // long chats: partial snapshot is enough
    }
    return m;
  }

  // Fallback when selectors match nothing: the element that grew the most.
  function findDeepestGrown(pre, exclude) {
    let best = null;
    let bestGrow = 7;
    for (const [el, prev] of pre) {
      if (!el.isConnected) continue;
      if (el === exclude || el.contains?.(exclude) || exclude?.contains?.(el)) continue;
      if (host.contains(el) || el.contains(host)) continue;
      const g = (el.textContent || "").length - prev;
      if (g > bestGrow) {
        best = el;
        bestGrow = g;
      }
    }
    return best;
  }

  function cancelCurrent() {
    state.cancel = true;
    for (const sel of SITE.stop || []) {
      try {
        const b = document.querySelector(sel);
        if (b && visible(b)) {
          b.click();
          break;
        }
      } catch {}
    }
    setLog("Stopped.");
  }

  // Before typing the next prompt (e.g. the bash result) make sure the site is
  // not still streaming the previous answer: typing/sending then would hit the
  // STOP button or get swallowed. Idle = no stop button and the last reply did
  // not change between two samples. Bounded, so it can never hang.
  async function waitForIdle(maxMs = 60_000) {
    const t0 = Date.now();
    const snap = () => {
      const n = replyNodes();
      return n.length ? extractText(n[n.length - 1]) : "";
    };
    let prev = snap();
    while (Date.now() - t0 < maxMs) {
      await sleep(700);
      if (state.cancel) throw new Error("Cancelled.");
      const cur = snap();
      if (!isStopVisible() && cur === prev) return;
      prev = cur;
      setLog(SITE.name + " is still answering the previous message, waiting…", true);
    }
  }

  async function waitForResponse({ timeoutMs, composer, prompt, before, beforeLast, pre, scope, typedLen }) {
    const t0 = Date.now();
    let lastText = "";
    let stableSince = 0;
    let sawActivity = false;
    let resubmits = 0;

    while (Date.now() - t0 < timeoutMs) {
      await sleep(500);
      if (state.cancel) throw new Error("Cancelled.");

      const generating = isStopVisible();
      if (generating) sawActivity = true;

      // If the site swallowed the send (nothing started), recover. Two cases:
      //  - the composer still holds our text  -> click send again
      //  - the composer is EMPTY (re-render wiped it) and the page did not
      //    change -> type the prompt again and send
      if (!sawActivity && Date.now() - t0 > 4000 * (resubmits + 1) && resubmits < 3) {
        const c = (await findComposer()) || composer;
        const tail = prompt.replace(/\s+/g, " ").trim().slice(-40);
        const pageHasPrompt = tail.length >= 8 && (scope?.textContent || "").replace(/\s+/g, " ").includes(tail);
        const pageGrew = scope && typedLen != null ? scope.textContent.length - typedLen > 15 : false;
        if (c && replyNodes().length <= before && !isStopVisible()) {
          if (composerText(c).length >= 4) {
            resubmits++;
            setLog(`Prompt not accepted yet, sending again (${resubmits}/3)…`, true);
            await submitComposer(c);
            continue;
          }
          // Box empty and the page shows no trace of our prompt: it was never sent.
          if (!c.isContentEditable && !pageHasPrompt && !pageGrew) {
            resubmits++;
            setLog(`Chat box is empty and nothing was sent, typing the prompt again (${resubmits}/3)…`, true);
            const c2 = await ensureTyped(c, prompt);
            await submitComposer(c2);
            continue;
          }
        }
      }

      const nodes = replyNodes();
      let text = "";
      let fromSelector = false;
      if (nodes.length > before) {
        text = extractText(nodes[nodes.length - 1]);
        fromSelector = true;
      } else if (nodes.length && nodes.length === before) {
        const t = extractText(nodes[nodes.length - 1]);
        if (t && t !== beforeLast && (generating || sawActivity || SITE.iconSend)) {
          text = t;
          fromSelector = true;
        }
      }

      if (!fromSelector && Date.now() - t0 > 8000) {
        const grown = findDeepestGrown(pre, composer);
        if (grown) text = dropEcho(extractText(grown), prompt);
      }

      if (!text) {
        lastText = "";
        stableSince = 0;
        // Make a silent stall visible in OpenCode instead of "Finding input…" forever.
        const waited = Math.round((Date.now() - t0) / 1000);
        if (waited >= 20 && waited % 20 < 1) {
          const c = (await findComposer()) || composer;
          const dbg = `nodes=${replyNodes().length}/${before} box=${composerText(c).length}ch stop=${isStopVisible()}`;
          setLog(`Prompt sent, but no answer detected on ${SITE.name} yet (${waited}s) [${dbg}]. Still waiting…`, true);
        }
        continue;
      }
      sawActivity = true;

      if (text === lastText && !generating) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 2200) return text;
      } else {
        lastText = text;
        stableSince = 0;
        setLog(`${SITE.name} is answering… (${text.length} chars)`, "tick");
      }
    }

    if (lastText.length >= 5) return lastText;
    throw new Error("Timed out waiting for " + SITE.name + " to complete response.");
  }

  async function runPipeline(prompt, reqId) {
    if (state.busy) {
      if (reqId) {
        ext.runtime.sendMessage({ type: "noapi_error", id: reqId, error: "This tab is already handling a prompt." }).catch(() => {});
      }
      return;
    }
    state.busy = true;
    state.cancel = false;
    state.reqId = reqId || null;
    lastProgress = "";
    lastProgressAt = 0;
    updateStatusUI();

    try {
      setLog("Finding " + SITE.name + " chat input…", true);
      const composer = await waitForComposer();
      if (!composer) throw new Error("Could not find chat input on " + SITE.name + ". Is the chat page fully loaded?");

      if (SITE.iconSend) await waitForIdle(40_000);
      const scope =
        SITE.transcript
          .split(",")
          .map((s) => {
            try {
              return document.querySelector(s.trim());
            } catch {
              return null;
            }
          })
          .find(Boolean) || document.body;
      const pre = snapshotLengths(scope);
      const beforeNodes = replyNodes();
      const before = beforeNodes.length;
      const beforeLast = before ? extractText(beforeNodes[before - 1]) : "";

      let composerNow = (await findComposer()) || composer;
      setLog("Typing prompt into " + SITE.name + "…", true);
      composerNow = await ensureTyped(composerNow, prompt);
      if (state.cancel) throw new Error("Cancelled.");

      const typedLen = scope.textContent.length;
      setLog("Sending prompt to " + SITE.name + "…", true);
      if (!(await submitComposer(composerNow))) throw new Error("Could not click Send or trigger Enter on " + SITE.name);

      setLog("Waiting for " + SITE.name + " to answer…", true);
      const text = await waitForResponse({ timeoutMs: 590_000, composer: composerNow, prompt, before, beforeLast, pre, scope, typedLen });

      setLog(`✓ Response captured (${text.length} chars). Sent to OpenCode.`);
      if (reqId) ext.runtime.sendMessage({ type: "noapi_reply", id: reqId, text }).catch(() => {});
      return text;
    } catch (err) {
      setLog("Error: " + err.message);
      if (reqId) ext.runtime.sendMessage({ type: "noapi_error", id: reqId, error: err.message }).catch(() => {});
      throw err;
    } finally {
      state.busy = false;
      state.reqId = null;
      updateStatusUI();
    }
  }

  updateStatusUI();
})();
