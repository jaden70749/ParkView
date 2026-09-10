import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const files = [
  "index.html",
  "styles.css",
  "camera-analysis.html",
  "camera-analysis.css",
  "camera-analysis.js",
  "camera-analysis-core.js",
  "manifest.webmanifest",
  "sw.js"
];

await rm(output, { recursive: true, force: true });
await Promise.all([
  mkdir(resolve(output, "data"), { recursive: true }),
  mkdir(resolve(output, "models"), { recursive: true }),
  mkdir(resolve(output, "vendor", "onnxruntime"), { recursive: true })
]);

await Promise.all(files.map((file) => cp(resolve(root, file), resolve(output, file))));
await cp(resolve(root, "data", "parking-lots.json"), resolve(output, "data", "parking-lots.json"));
await cp(
  resolve(root, "models", "parkview-toycar-v4.onnx"),
  resolve(output, "models", "parkview-toycar-v4.onnx")
);
await Promise.all([
  "ort.min.js",
  "ort-wasm-simd-threaded.wasm"
].map((file) => cp(
  resolve(root, "vendor", "onnxruntime", file),
  resolve(output, "vendor", "onnxruntime", file)
)));

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
  cameraApiBaseUrl: envValue("PARKVIEW_CAMERA_API_BASE_URL"),
  kakaoJavaScriptKey: envValue("KAKAO_JAVASCRIPT_KEY")
};
await writeFile(
  resolve(output, "config.js"),
  `window.PARKVIEW_CONFIG = Object.freeze(${JSON.stringify(config)});\n`,
  "utf8"
);
