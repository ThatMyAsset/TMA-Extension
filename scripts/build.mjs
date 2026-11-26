import { mkdir, copyFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const out = resolve(root, "dist");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const entry of ["background", "content", "main-world", "popup"]) {
  await build({
    absWorkingDir: root,
    entryPoints: [`src/${entry}.ts`],
    outfile: `dist/${entry}.js`,
    bundle: true,
    format: entry === "main-world" ? "iife" : "esm",
    target: "chrome119",
    platform: "browser",
    sourcemap: false,
    minify: false,
    logLevel: "warning"
  });
}
for (const file of ["manifest.json", "managed_schema.json", "src/popup.html", "src/popup.css"]) {
  const name = file.startsWith("src/") ? file.slice(4) : file;
  await copyFile(resolve(root, file), resolve(out, name));
}
console.log("Built 4 bundled scripts in dist/");
