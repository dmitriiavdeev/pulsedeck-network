import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { prepare, root } from "./prepare.mjs";
const require = createRequire(import.meta.url);
await prepare();
const child = spawn(require("electron"), [join(root, "app")], {
  stdio: "inherit",
  windowsHide: false,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
});
child.on("exit", (code) => process.exit(code || 0));
