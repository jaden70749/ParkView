import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createLetterboxTransform,
  decodeYoloOutput,
  imageDataToTensorData,
  intersectionOverUnion
} from "../camera-analysis-core.js";

test("letterbox preserves a 16:9 image without stretching", () => {
  const transform = createLetterboxTransform(1280, 720, 640);
  assert.equal(transform.resizedWidth, 640);
  assert.equal(transform.resizedHeight, 360);
  assert.equal(transform.padLeft, 0);
  assert.equal(transform.padTop, 140);
  assert.equal(transform.scaleX, 0.5);
  assert.equal(transform.scaleY, 0.5);
});

test("RGBA image data is converted to normalized RGB channels", () => {
  const tensor = imageDataToTensorData({
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([255, 128, 0, 255])
  });
  assert.deepEqual(Array.from(tensor), [1, Math.fround(128 / 255), 0]);
});

test("YOLO channel-first output is mapped back to source coordinates and deduplicated", () => {
  const transform = createLetterboxTransform(640, 360, 640);
  const output = {
    dims: [1, 5, 2],
    data: new Float32Array([
      320, 322,
      320, 322,
      100, 100,
      100, 100,
      0.9, 0.8
    ])
  };
  const detections = decodeYoloOutput(output, transform, 0.25, 0.45);
  assert.equal(detections.length, 1);
  assert.ok(Math.abs(detections[0].bbox[0] - 270) < 0.001);
  assert.ok(Math.abs(detections[0].bbox[1] - 130) < 0.001);
});

test("intersection over union handles separate and identical boxes", () => {
  assert.equal(intersectionOverUnion([0, 0, 10, 10], [20, 20, 5, 5]), 0);
  assert.equal(intersectionOverUnion([3, 4, 10, 12], [3, 4, 10, 12]), 1);
});

test("device camera analysis is integrated into parking management", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="deviceCameraToggle"/);
  assert.match(html, /id="deviceCameraPanel"/);
  assert.match(html, /id="deviceStartCameraButton"/);
  assert.match(html, /camera-analysis\.js\?v=3/);
  assert.doesNotMatch(html, /href="\.\/camera-analysis\.html"/);
});

test("deployed camera analysis uses the self-hosted WASM runtime", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const buildScript = await readFile(new URL("../scripts/prepare-mobile-web.mjs", import.meta.url), "utf8");
  assert.match(html, /vendor\/onnxruntime\/ort\.wasm\.min\.js/);
  assert.match(buildScript, /ort-wasm-simd-threaded\.mjs/);
  assert.match(buildScript, /ort-wasm-simd-threaded\.wasm/);
  assert.doesNotMatch(html, /vendor\/onnxruntime\/ort\.min\.js/);
});

test("iPhone CCTV bridge converts RTSP input to snapshot analysis", async () => {
  const bridge = await readFile(new URL("../native-bridge-source.js", import.meta.url), "utf8");
  const camera = await readFile(new URL("../camera-analysis.js", import.meta.url), "utf8");
  const plugin = await readFile(new URL("../ios/App/App/ParkViewCctvPlugin.swift", import.meta.url), "utf8");
  assert.match(bridge, /registerPlugin\("ParkViewCctv"\)/);
  assert.match(bridge, /parkview:cctv-frame/);
  assert.match(camera, /sourceType = "cctv"/);
  assert.match(plugin, /ISAPI\/Streaming\/channels\/\\\(channel\)\/picture/);
  assert.match(plugin, /URLSessionConfiguration\.ephemeral/);
});
