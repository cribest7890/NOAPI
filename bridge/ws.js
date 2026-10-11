// Minimal RFC 6455 WebSocket server. Zero dependencies, localhost-only use.
import crypto from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME = 10 * 1024 * 1024;

function unmask(payload, key) {
  const out = Buffer.from(payload);
  for (let i = 0; i < out.length; i++) out[i] ^= key[i & 3];
  return out;
}

class WsConn {
  constructor(socket, req, id) {
    this.socket = socket;
    this.id = id;
    this.url = req.url;
    this.closed = false;
    this._buf = Buffer.alloc(0);
    this._frag = Buffer.alloc(0);
    this._fragOpcode = 0;
    this._onMessage = null;
    this._onClose = null;
    socket.setNoDelay(true);
    socket.on("data", (chunk) => this._onData(chunk));
    socket.on("close", () => this._close());
    socket.on("error", () => this._close());
  }

  onMessage(fn) {
    this._onMessage = fn;
  }

  onClose(fn) {
    this._onClose = fn;
  }

  send(text) {
    if (this.closed) return;
    this._frame(0x1, Buffer.from(String(text), "utf8"));
  }

  close() {
    if (this.closed) return;
    try {
      this._frame(0x8, Buffer.alloc(2));
    } catch {}
    this._close();
  }

  _close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this._onClose?.();
    } catch {}
    try {
      this.socket.destroy();
    } catch {}
  }

  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    while (true) {
      const r = this._parseFrame();
      if (!r) return;
      if (!r.fin) {
        if (r.opcode !== 0) this._fragOpcode = r.opcode;
        this._frag = Buffer.concat([this._frag, r.payload]);
        if (this._frag.length > MAX_FRAME) {
          this._close();
          return;
        }
        continue;
      }
      if (r.opcode === 0) {
        const full = Buffer.concat([this._frag, r.payload]);
        this._frag = Buffer.alloc(0);
        this._handle({ opcode: this._fragOpcode, payload: full });
      } else {
        this._handle(r);
      }
    }
  }

  _handle({ opcode, payload }) {
    if (opcode === 0x8) {
      this._close();
      return;
    }
    if (opcode === 0x9) {
      this._frame(0x9, payload);
      return;
    }
    if (opcode === 0xa) {
      this._frame(0xa, Buffer.alloc(0));
      return;
    }
    if (opcode === 0x1) {
      try {
        this._onMessage?.(payload.toString("utf8"));
      } catch {}
    }
  }

  _frame(opcode, payload) {
    const len = payload.length;
    let head;
    if (len < 126) {
      head = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | opcode;
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | opcode;
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(len), 2);
    }
    this.socket.write(Buffer.concat([head, payload]));
  }

  _parseFrame() {
    const buf = this._buf;
    if (buf.length < 2) return null;
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (buf.length < off + 2) return null;
      len = buf.readUInt16BE(off);
      off += 2;
    } else if (len === 127) {
      if (buf.length < off + 8) return null;
      len = Number(buf.readBigUInt64BE(off));
      off += 8;
    }
    if (len > MAX_FRAME) {
      this._close();
      return null;
    }
    let key = null;
    if (masked) {
      if (buf.length < off + 4) return null;
      key = buf.subarray(off, off + 4);
      off += 4;
    }
    if (buf.length < off + len) return null;
    const raw = buf.subarray(off, off + len);
    const payload = key ? unmask(raw, key) : Buffer.from(raw);
    this._buf = buf.subarray(off + len);
    return { fin, opcode, payload };
  }
}

let nextId = 1;

export function attachWebSocketServer(httpServer, handlers) {
  httpServer.on("upgrade", (req, socket, head) => {
    const upgrade = (req.headers.upgrade || "").toLowerCase();
    const key = req.headers["sec-websocket-key"];
    if (upgrade !== "websocket" || !key) {
      socket.destroy();
      return;
    }
    if (handlers.verify && !handlers.verify(req)) {
      try {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      } catch {}
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash("sha1")
      .update(key + GUID)
      .digest("base64");
    try {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n` +
          "\r\n"
      );
    } catch {
      socket.destroy();
      return;
    }
    const conn = new WsConn(socket, req, String(nextId++));
    // attach forwarders BEFORE onOpen so user code in onOpen can't clobber them
    conn.onClose(() => {
      try {
        handlers.onClose?.(conn);
      } catch {}
    });
    conn.onMessage((text) => {
      try {
        handlers.onMessage?.(conn, text);
      } catch {}
    });
    try {
      handlers.onOpen?.(conn);
    } catch {}
    // Bytes that arrived together with the HTTP upgrade request.
    if (head && head.length) {
      try {
        conn._onData(head);
      } catch {}
    }
  });
}
