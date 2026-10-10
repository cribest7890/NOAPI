// Registers NOAPI? in OpenCode's GLOBAL config so it works from any project
// folder (not only from the NOAPI? folder).
//
//   node tools/install-global.js            # install / update
//   node tools/install-global.js --remove   # uninstall
//
// Writes to $XDG_CONFIG_HOME/opencode/opencode.json (default ~/.config/opencode/).
// Existing settings are kept; only the "noapi" provider and "noapi" mcp entry
// are added/replaced. A backup (opencode.json.bak) is made first.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bridge = path.join(root, "bridge", "index.js");
const repoCfg = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
const dir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode");
const file = path.join(dir, "opencode.json");
const remove = process.argv.includes("--remove");

let cfg = { $schema: "https://opencode.ai/config.json" };
if (fs.existsSync(file)) {
  const raw = fs.readFileSync(file, "utf8");
  try {
    cfg = raw.trim() ? JSON.parse(raw) : cfg;
  } catch {
    console.error(`Cannot parse ${file} (comments/trailing commas?). Not touching it.`);
    console.error("Add this by hand instead:\n");
    console.error(JSON.stringify({ provider: { noapi: repoCfg.provider.noapi }, mcp: { noapi: { type: "local", command: ["node", bridge, "--mcp"], enabled: true, timeout: 30000 } } }, null, 2));
    process.exit(1);
  }
  fs.copyFileSync(file, file + ".bak");
}

cfg.provider = cfg.provider || {};
cfg.mcp = cfg.mcp || {};
if (remove) {
  delete cfg.provider.noapi;
  delete cfg.mcp.noapi;
} else {
  cfg.provider.noapi = repoCfg.provider.noapi;
  cfg.mcp.noapi = { type: "local", command: ["node", bridge, "--mcp"], enabled: true, timeout: 30000 };
}
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
console.log(`${remove ? "Removed NOAPI? from" : "Installed NOAPI? in"} ${file}`);
if (!remove) console.log(`Bridge: ${bridge}\nRestart OpenCode in any folder, then /models -> NOAPI?.`);
