import { mkdir, copyFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const out = resolve(root, "dist");
await rm(out, { recursive: true, force: true });

for (const browser of ["chromium", "firefox"]) {
  const targetDir = resolve(out, browser);
  await mkdir(targetDir, { recursive: true });
  for (const entry of ["background", "content", "main-world", "popup"]) {
    await build({ absWorkingDir: root, entryPoints: [`src/${entry}.ts`], outfile: `dist/${browser}/${entry}.js`, bundle: true,
      format: browser === "firefox" && entry === "background" ? "iife" : entry === "main-world" ? "iife" : "esm",
      target: browser === "firefox" ? "firefox128" : "chrome119", platform: "browser", sourcemap: false, minify: false, logLevel: "warning" });
  }
  for (const file of ["managed_schema.json", "src/popup.html", "src/popup.css"]) {
    const name = file.startsWith("src/") ? file.slice(4) : file;
    await copyFile(resolve(root, file), resolve(targetDir, name));
  }
  const manifest = JSON.parse(await (await import("node:fs/promises")).readFile(resolve(root, browser === "firefox" ? "manifest.firefox.json" : "manifest.json"), "utf8"));
  await (await import("node:fs/promises")).writeFile(resolve(targetDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log("Built Chromium and Firefox extension bundles in dist/");
