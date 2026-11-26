import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const dist = resolve(root, "dist");
const release = resolve(root, "release");
await mkdir(release, { recursive: true });
const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8"));
const zip = resolve(release, `thatmyassets-extension-${manifest.version}.zip`);
const files = (await readdir(dist)).sort();
const payload = createHash("sha256");
for (const file of files) payload.update(file).update(await readFile(resolve(dist, file)));
const digest = payload.digest("hex");
execFileSync("tar", ["-a", "-cf", zip, "-C", dist, ...files], { stdio: "inherit" });
await writeFile(resolve(release, `thatmyassets-extension-${manifest.version}.sha256`), `${digest}  thatmyassets-extension-${manifest.version}.zip\n`);
console.log(`${zip}\nPayload SHA256 ${digest}`);
