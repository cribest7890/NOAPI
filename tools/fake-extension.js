// Fake "browser tab" for testing the NOAPI? bridge without a real browser.
// Connects to the bridge websocket, claims to be on ChatGPT, and when a
// prompt arrives it "types" nothing and just replies with a canned answer.
//
//   node tools/fake-extension.js [site]   (default site: chatgpt)
import net from "node:net";
import crypto from "node:crypto";

const site = process.argv[2] || "chatgpt";
const host = "127.0.0.1";
const port = Number(process.env.NOAPI_PORT || 8787);

const socket = net.createConnection({ host, port }, () => {
  const key = crypto.randomBytes(16).toString("base64");
  socket.write(
    `GET / HTTP/1.1\r\nHost: ${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
  );
});

let buf = Buffer.alloc(0);
let headersDone = false;

socket.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  if (!headersDone) {
    const idx = buf.indexOf("\r\n\r\n");
    if (idx === -1) return;
    headersDone = true;
    buf = buf.subarray(idx + 4);
    console.log(`[fake-ext] websocket connected, claiming site: ${site}`);
    send({ t: "hello", site, url: `https://fake.${site}.example/` });
  }
  while (buf.length >= 2) {
    const fin = buf[0] & 0x80;
    const opcode = buf[0] & 0x0f;
    let len = buf[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (buf.length < 4) return;
      len = buf.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (buf.length < 10) return;
      len = Number(buf.readBigUInt64BE(2));
      off = 10;
    }
    if (buf.length < off + len) return;
    const payload = buf.subarray(off, off + len);
    buf = buf.subarray(off + len);
    if (!fin) continue;
    if (opcode === 0x8) {
      console.log("[fake-ext] server closed");
      process.exit(0);
    }
    if (opcode === 0x9) continue; // ping: we ignore (server is lenient)
    if (opcode !== 0x1) continue;
    let msg;
    try {
      msg = JSON.parse(payload.toString("utf8"));
    } catch {
      continue;
    }
    if (msg.t === "request") {
      console.log(`[fake-ext] request ${msg.id}: ${String(msg.prompt).slice(0, 120).replace(/\n/g, " ")}`);
      send({ t: "progress", id: msg.id, status: "Typing prompt into fake site…" });
      setTimeout(() => {
        console.log(`[fake-ext] replying to ${msg.id}`);
        const p = String(msg.prompt);
        let text = `[fake ${site}] This is a fake reply from tools/fake-extension.js. Real use: open ${site} in your browser with the NOAPI? extension — the website's model will answer instead.`;
        if (p.includes("END_TOOL_RESULT")) text = `[fake ${site}] Done, the folder was created.`;
        else if (p.includes("AVAILABLE TOOLS")) {
          text = 'On it.\n```\nTOOL_CALL\n{"name":"bash","arguments":{"command":"mkdir chatgpt-test"}}\n```';
        }
        send({ t: "response", id: msg.id, text });
      }, 1200);
    } else if (msg.t === "welcome") {
      console.log("[fake-ext] bridge says welcome");
    }
  }
});

function send(obj) {
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
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
  socket.write(Buffer.concat([header, mask, masked]));
}

socket.on("error", (e) => {
  console.error(`[fake-ext] cannot reach bridge at ws://${host}:${port} — is it running? (${e.message})`);
  process.exit(1);
});
