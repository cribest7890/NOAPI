// Minimal RFC 6455 WebSocket *client* (for the MCP proxy fallback).
// Zero dependencies, localhost only.
import net from "node:net";
import crypto from "node:crypto";

class WsClient {
  constructor(url, { onOpen, onMessage, onClose, onConnectError } = {}) {
    const u = new URL(url);
    this.host = u.hostname;
    this.port = Number(u.port || (u.protocol === "wss:" ? 443 : 80));
    this.path = u.pathname + u.search;
    this.onOpen = onOpen;
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.onConnectError = onConnectError;
    this.socket = null;
    this.closed = false;
    this._buf = Buffer.alloc(0);
    this._opened = false;
    this._connect();
  }

  _connect() {
    const key = crypto.randomBytes(16).toString("base64");
    const socket = net.createConnection({ host: this.host, port: this.port });
    this.socket = socket;
    socket.once("connect", () => {
      socket.write(
        `GET ${this.path} HTTP/1.1\r\n` +
          `Host: ${this.host}:${this.port}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Key: ${key}\r\n` +
          "Sec-WebSocket-Version: 13\r\n" +
          "\r\n"
      );
    });
    socket.on("data", (chunk) => this._onData(chunk));
    socket.on("error", (err) => {
      if (!this._opened) this.onConnectError?.(err);
      this._shutdown();
    });
    socket.on("close", () => this._shutdown());
  }

  _shutdown() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket?.destroy();
    } catch {}
    try {
      this.onClose?.();
    } catch {}
  }

  send(obj) {
    if (!this.socket || this.closed) throw new Error("websocket not open");
    const payload = Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj), "utf8");
    const mask = crypto.randomBytes(4);
    let header;
    const len = payload.length;
    if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
    else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  close() {
    if (this.closed) return;
    try {
      this.send({ t: "bye" });
    } catch {}
    this._shutdown();
  }

  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    if (!this._opened) {
      const idx = this._buf.indexOf("\r\n\r\n");
      if (idx === -1) return;
      const head = this._buf.subarray(0, idx).toString("utf8");
      if (!/101/.test(head.split("\r\n")[0])) {
        this.onConnectError?.(new Error("websocket handshake failed: " + head.split("\r\n")[0]));
        this._shutdown();
        return;
      }
      this._buf = this._buf.subarray(idx + 4);
      this._opened = true;
      this.onOpen?.();
    }
    while (this._opened && this._buf.length >= 2) {
      const fin = this._buf[0] & 0x80;
      const opcode = this._buf[0] & 0x0f;
      let len = this._buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this._buf.length < off + 2) return;
        len = this._buf.readUInt16BE(off);
        off += 2;
      } else if (len === 127) {
        if (this._buf.length < off + 8) return;
        len = Number(this._buf.readBigUInt64BE(off));
        off += 8;
      }
      let key = null;
      if (this._buf[1] & 0x80) {
        if (this._buf.length < off + 4) return;
        key = this._buf.subarray(off, off + 4);
        off += 4;
      }
      if (this._buf.length < off + len) return;
      const raw = this._buf.subarray(off, off + len);
      this._buf = this._buf.subarray(off + len);
      if (key) for (let i = 0; i < raw.length; i++) raw[i] ^= key[i & 3];
      if (!fin) continue; // we only send small frames
      if (opcode === 0x8) return this._shutdown();
      if (opcode === 0x9) {
        // pong
        const mask = crypto.randomBytes(4);
        const h = Buffer.from([0x8a, 0x80 | raw.length]);
        const p = Buffer.from(raw);
        for (let i = 0; i < p.length; i++) p[i] ^= mask[i & 3];
        this.socket.write(Buffer.concat([h, mask, p]));
        continue;
      }
      if (opcode === 0x1) {
        try {
          this.onMessage?.(raw.toString("utf8"));
        } catch {}
      }
    }
  }
}

export { WsClient };
