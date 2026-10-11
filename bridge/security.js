// Who may talk to the bridge?
//
// The bridge listens on 127.0.0.1, but a normal web page you have open in the
// same browser can still reach 127.0.0.1 (fetch, WebSocket). Without a check,
// any site could pose as the extension and answer OpenCode with fake tool
// calls, or send prompts through your logged in chats. So we only accept:
//   - requests with NO Origin header (OpenCode, MCP proxy, curl, our tests),
//   - requests from the browser extension (chrome-extension:// / moz-extension://),
//   - requests from the bridge's own dashboard page (same origin).
// The Host header must also be a local name, which blocks DNS rebinding.

const EXT_ORIGIN = /^(chrome-extension|moz-extension|safari-web-extension):\/\//i;

export function hostAllowed(hostHeader, bindHost = "127.0.0.1") {
  const raw = String(hostHeader || "").toLowerCase();
  if (!raw) return true; // HTTP/1.0 style clients without a Host header
  const name = raw.startsWith("[") ? raw.slice(0, raw.indexOf("]") + 1) : raw.split(":")[0];
  return ["127.0.0.1", "localhost", "[::1]", String(bindHost).toLowerCase()].includes(name);
}

export function originAllowed(origin, hostHeader) {
  if (!origin) return true;
  if (EXT_ORIGIN.test(origin)) return true;
  return origin.toLowerCase() === `http://${String(hostHeader || "").toLowerCase()}`;
}

export function requestAllowed(req, bindHost) {
  return hostAllowed(req.headers.host, bindHost) && originAllowed(req.headers.origin, req.headers.host);
}
