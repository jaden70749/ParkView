import assert from "node:assert/strict";
import * as ort from "onnxruntime-web";

ort.env.wasm.numThreads = 1;

const session = await ort.InferenceSession.create(
  "models/yolov5su.onnx",
  { executionProviders: ["wasm"], graphOptimizationLevel: "all" }
);
assert.deepEqual(session.inputNames, ["images"]);
assert.deepEqual(session.outputNames, ["output0"]);

const input = new ort.Tensor(
  "float32",
  new Float32Array(3 * 640 * 640),
  [1, 3, 640, 640]
);
const result = await session.run({ images: input });
assert.deepEqual(Array.from(result.output0.dims), [1, 84, 8400]);
assert.equal(result.output0.data.length, 705600);

console.log("Camera model contract OK: images[1,3,640,640] -> output0[1,84,8400]");
