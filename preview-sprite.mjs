/**
 * preview-sprite.mjs — dev tool: prints the dragon sprite as ASCII art
 * (palette letters) so the pixel art can be reviewed and validated.
 *
 * Run:  node preview-sprite.mjs
 */
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("./dragon.js", import.meta.url), "utf8");
const sandbox = {
  window: {},
  module: { exports: {} },
  exports: {},
  console,
  setTimeout,
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
sandbox.module.exports.debugPrint();
