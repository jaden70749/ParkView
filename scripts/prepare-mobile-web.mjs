import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const files = [
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "sw.js"
];

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "data"), { recursive: true });

await Promise.all(files.map((file) => cp(resolve(root, file), resolve(output, file))));
await cp(resolve(root, "data", "parking-lots.json"), resolve(output, "data", "parking-lots.json"));

await build({
  entryPoints: [resolve(root, "native-bridge-source.js"), resolve(root, "app.js")],
  bundle: true,
  minify: false,
  sourcemap: false,
  outdir: output,
  entryNames: "[name]",
  format: "iife",
  platform: "browser",
  target: ["ios16", "safari16", "chrome110"]
});

const envPath = resolve(root, ".env");
let envText = "";
try {
  envText = await readFile(envPath, "utf8");
} catch {
  // CI and fresh clones configure public values through environment variables.
}

function envValue(name) {
  if (process.env[name]) return process.env[name];
  const line = envText.split(/\r?\n/).find((item) => item.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^(['"])(.*)\1$/, "$2") : "";
}

const config = {
  edgeApiBaseUrl: envValue("PARKVIEW_EDGE_API_BASE_URL"),
  kakaoJavaScriptKey: envValue("KAKAO_JAVASCRIPT_KEY")
};
await writeFile(
  resolve(output, "config.js"),
  `window.PARKVIEW_CONFIG = Object.freeze(${JSON.stringify(config)});\n`,
  "utf8"
);
