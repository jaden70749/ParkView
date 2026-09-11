import {
  DEFAULT_CONFIDENCE,
  VEHICLE_CLASS_IDS,
  MODEL_INPUT_SIZE,
  createLetterboxTransform,
  decodeYoloOutput,
  imageDataToTensorData,
  matchCameraSlots,
  stabilizeCameraSlots
} from "./camera-analysis-core.js";

const MODEL_URL = "./models/yolov5su.onnx";
const RESULT_STORAGE_KEY = "parkview.deviceCamera.latest";
const ANALYSIS_CHANNEL = "parkview-camera-analysis";
const FRAME_INTERVAL_MS = 250;

const state = {
  session: null,
  modelPromise: null,
  stream: null,
  source: null,
  sourceType: "",
  objectUrl: "",
  facingMode: "environment",
  detections: [],
  running: false,
  runId: 0,
  previewFrame: 0,
  cctvFrameBusy: false,
  cctvTimer: 0,
  regions: null,
  slotResults: [],
  slotHistory: new Map(),
  confidence: DEFAULT_CONFIDENCE
};

const els = {
  toggle: document.querySelector("#deviceCameraToggle"),
  panel: document.querySelector("#deviceCameraPanel"),
  modelBadge: document.querySelector("#deviceModelBadge"),
  startCameraButton: document.querySelector("#deviceStartCameraButton"),
  switchCameraButton: document.querySelector("#deviceSwitchCameraButton"),
  sourceFile: document.querySelector("#deviceSourceFile"),
  stopButton: document.querySelector("#deviceStopButton"),
  sourceVideo: document.querySelector("#deviceSourceVideo"),
  sourceImage: document.querySelector("#deviceSourceImage"),
  resultCanvas: document.querySelector("#deviceResultCanvas"),
  viewportPlaceholder: document.querySelector("#deviceViewportPlaceholder"),
  sourceBadge: document.querySelector("#deviceSourceBadge"),
  analysisStatus: document.querySelector("#deviceAnalysisStatus"),
  vehicleCount: document.querySelector("#deviceVehicleCount"),
  inferenceTime: document.querySelector("#deviceInferenceTime"),
  confidenceRange: document.querySelector("#deviceConfidenceRange"),
  confidenceValue: document.querySelector("#deviceConfidenceValue"),
  occupancyStatus: document.querySelector("#deviceOccupancyStatus")
};

const resultContext = els.resultCanvas?.getContext("2d");
const inputCanvas = document.createElement("canvas");
const inputContext = inputCanvas.getContext("2d", { willReadFrequently: true });
inputCanvas.width = MODEL_INPUT_SIZE;
inputCanvas.height = MODEL_INPUT_SIZE;

if (els.panel && resultContext) {
  bindEvents();
}

window.addEventListener("pagehide", stopSource);
window.addEventListener("parkview:stop-device-camera", closeDeviceCameraPanel);
window.addEventListener("parkview:cctv-frame", handleCctvFrame);
window.addEventListener("parkview:cctv-state", handleCctvState);

function bindEvents() {
  els.toggle.addEventListener("click", toggleDeviceCameraPanel);
  els.startCameraButton.addEventListener("click", () => startDeviceCamera());
  els.switchCameraButton.addEventListener("click", switchDeviceCamera);
  els.stopButton.addEventListener("click", stopSource);
  els.sourceFile.addEventListener("change", handleSourceFile);
  els.confidenceRange.addEventListener("input", () => {
    state.confidence = Number(els.confidenceRange.value) / 100;
    els.confidenceValue.textContent = `${els.confidenceRange.value}%`;
    if (state.sourceType === "image" && state.source) analyzeCurrentFrame();
  });
}

function toggleDeviceCameraPanel() {
  const opening = els.panel.hidden;
  els.panel.hidden = !opening;
  els.toggle.setAttribute("aria-expanded", String(opening));
  els.toggle.classList.toggle("is-open", opening);
  if (!opening) {
    stopSource();
    return;
  }
  els.panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  setStatus("바로 분석하기를 누르면 CCTV 현재 화면을 분석합니다.");
}

function closeDeviceCameraPanel() {
  if (!els.panel || els.panel.hidden) return;
  els.panel.hidden = true;
  els.toggle.setAttribute("aria-expanded", "false");
  els.toggle.classList.remove("is-open");
  stopSource();
}

function openPanelForCctv() {
  if (!els.panel) return;
  els.panel.hidden = false;
  els.toggle.setAttribute("aria-expanded", "true");
  els.toggle.classList.add("is-open");
}

function handleCctvState(event) {
  const detail = event.detail || {};
  if (detail.status === "connecting") {
    openPanelForCctv();
    setModelState("loading", "CCTV 연결 중");
    setStatus("CCTV의 첫 프레임을 기다리고 있습니다.");
  } else if (detail.status === "error") {
    setModelState("error", "CCTV 오류");
    setStatus(detail.message || "CCTV 프레임을 받지 못했습니다.", true);
  } else if (detail.status === "disconnected" && state.sourceType === "cctv") {
    state.sourceType = "";
    stopSource();
  }
}

async function handleCctvFrame(event) {
  const dataUrl = String(event.detail?.dataUrl || "");
  if (!dataUrl.startsWith("data:image/") || state.cctvFrameBusy) return;
  state.cctvFrameBusy = true;
  try {
    openPanelForCctv();
    if (state.sourceType !== "cctv") {
      prepareForNewSource();
      state.sourceType = "cctv";
    }
    els.sourceImage.src = dataUrl;
    await waitForImage(els.sourceImage);
    state.source = els.sourceImage;
    state.sourceType = "cctv";
    els.stopButton.disabled = false;
    showSource("고정 CCTV");
    await loadModel();
    drawPreview();
    await analyzeCurrentFrame();
  } catch (error) {
    setStatus(`CCTV 분석 오류: ${error.message}`, true);
  } finally {
    state.cctvFrameBusy = false;
  }
}

async function loadModel() {
  if (state.session) return state.session;
  if (state.modelPromise) return state.modelPromise;
  state.modelPromise = (async () => {
    if (!window.ort?.InferenceSession) {
      throw new Error("기기 내 AI 실행기를 불러오지 못했습니다.");
    }
    setModelState("loading", "모델 준비 중");
    setStatus("AI 모델을 불러오고 있습니다. 첫 실행은 잠시 걸릴 수 있습니다.");
    window.ort.env.wasm.wasmPaths = new URL(
      "./vendor/onnxruntime/",
      window.location.href
    ).href;
    window.ort.env.wasm.numThreads = 1;
    window.ort.env.wasm.proxy = false;
    const session = await window.ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all"
    });
    state.session = session;
    setModelState("ready", "AI 준비됨");
    setStatus(state.source ? "현장 화면을 분석하고 있습니다." : "바로 분석하기를 눌러 CCTV 분석을 시작하세요.");
    return session;
  })().catch((error) => {
    state.modelPromise = null;
    setModelState("error", "모델 오류");
    setStatus(`AI 모델 준비 실패: ${error.message}`, true);
    throw error;
  });
  return state.modelPromise;
}

async function startDeviceCamera({ keepFacingMode = false } = {}) {
  if (getCameraPreviewUrl()) {
    await startCctvCamera();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("이 환경에서는 기기 카메라를 사용할 수 없습니다.", true);
    return;
  }
  const facingMode = keepFacingMode ? state.facingMode : "environment";
  state.facingMode = facingMode;
  prepareForNewSource();
  setStatus("카메라 권한을 요청하고 있습니다.");
  els.startCameraButton.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });
    state.stream = stream;
    await loadModel();
    els.sourceVideo.srcObject = stream;
    await waitForVideo(els.sourceVideo);
    await els.sourceVideo.play();
    state.source = els.sourceVideo;
    state.sourceType = "camera";
    state.running = true;
    showSource(facingMode === "environment" ? "후면 카메라" : "전면 카메라");
    updateManagementConnection("분석 중");
    els.switchCameraButton.disabled = false;
    els.stopButton.disabled = false;
    startPreviewLoop();
    runContinuousAnalysis(++state.runId);
  } catch (error) {
    releaseMediaStream();
    setStatus(cameraErrorMessage(error), true);
  } finally {
    els.startCameraButton.disabled = false;
  }
}

function getCameraPreviewUrl() {
  const configuredBase = String(window.PARKVIEW_CONFIG?.cameraApiBaseUrl || "").trim().replace(/\/+$/, "");
  const isLocalApp = !window.location.hostname.endsWith(".github.io");
  if (!configuredBase && !isLocalApp) return "";
  return `${configuredBase}/api/camera/preview`;
}

function getCameraAdminToken() {
  const enteredToken = String(document.querySelector("#cameraAdminToken")?.value || "").trim();
  if (enteredToken) return enteredToken;
  try {
    return sessionStorage.getItem("parkview.cameraAdminToken.session") || "";
  } catch (_error) {
    return "";
  }
}

async function startCctvCamera() {
  const previewUrl = getCameraPreviewUrl();
  const token = getCameraAdminToken();
  prepareForNewSource();
  state.sourceType = "cctv";
  state.running = true;
  setModelState("loading", "CCTV 연결 중");
  setStatus("CCTV 영상을 받고 있습니다.");
  els.startCameraButton.disabled = true;
  els.stopButton.disabled = false;
  try {
    await loadCameraRegions(previewUrl, token);
    await loadCctvFrame(previewUrl, token);
    showSource("고정 CCTV");
    await loadModel();
    await analyzeCurrentFrame();
    scheduleCctvFrame(previewUrl, token, ++state.runId);
  } catch (error) {
    state.running = false;
    setStatus(`CCTV 연결 실패: ${error.message}`, true);
    els.stopButton.disabled = true;
  } finally {
    els.startCameraButton.disabled = false;
  }
}

async function loadCameraRegions(previewUrl, token) {
  state.regions = null;
  state.slotResults = [];
  state.slotHistory.clear();
  try {
    const regionsUrl = previewUrl.replace(/\/api\/camera\/preview$/, "/api/regions");
    const response = await fetch(regionsUrl, {
      cache: "no-store",
      headers: cameraRequestHeaders(regionsUrl, { Authorization: `Bearer ${token}` })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.regions = await response.json();
    if (els.occupancyStatus) els.occupancyStatus.textContent = state.regions.slots?.length
      ? "주차면 등록됨 · 분석 대기 중"
      : "주차 가능 여부 미확인 · 먼저 CCTV 주차면을 등록해 주세요.";
  } catch (_error) {
    if (els.occupancyStatus) els.occupancyStatus.textContent = "주차면 정보를 읽지 못했습니다. 관리자 토큰과 주차면 등록을 확인해 주세요.";
  }
}

async function loadCctvFrame(previewUrl, token) {
  const headers = cameraRequestHeaders(previewUrl);
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${previewUrl}?t=${Date.now()}`, {
    cache: "no-store",
    headers
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("고정 CCTV 설정에서 관리자 토큰을 입력한 뒤 카메라 연결을 다시 눌러 주세요.");
    }
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || `CCTV 서버 HTTP ${response.status}`);
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    els.sourceImage.src = objectUrl;
    await waitForImage(els.sourceImage);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  state.source = els.sourceImage;
  drawPreview();
}

function cameraRequestHeaders(url, extra = {}) {
  const absoluteMatch = String(url).match(/^https?:\/\/([^/?#]+)/i);
  const hostname = absoluteMatch
    ? absoluteMatch[1].split(":")[0].toLowerCase()
    : String(window.location.hostname || "").toLowerCase();
  return hostname.endsWith(".loca.lt")
    ? { ...extra, "bypass-tunnel-reminder": "true" }
    : { ...extra };
}

function scheduleCctvFrame(previewUrl, token, runId) {
  window.clearTimeout(state.cctvTimer);
  state.cctvTimer = window.setTimeout(async () => {
    if (!state.running || state.runId !== runId || state.sourceType !== "cctv") return;
    try {
      await loadCctvFrame(previewUrl, token);
      await analyzeCurrentFrame();
    } catch (error) {
      state.running = false;
      setStatus(`CCTV 수신 오류: ${error.message}`, true);
      els.stopButton.disabled = true;
      return;
    }
    scheduleCctvFrame(previewUrl, token, runId);
  }, 2000);
}

async function switchDeviceCamera() {
  if (state.sourceType !== "camera") return;
  state.facingMode = state.facingMode === "environment" ? "user" : "environment";
  await startDeviceCamera({ keepFacingMode: true });
}

async function handleSourceFile() {
  const file = els.sourceFile.files?.[0];
  if (!file) return;
  prepareForNewSource();
  state.objectUrl = URL.createObjectURL(file);
  try {
    await loadModel();
    if (file.type.startsWith("video/")) {
      els.sourceVideo.srcObject = null;
      els.sourceVideo.src = state.objectUrl;
      els.sourceVideo.loop = true;
      await waitForVideo(els.sourceVideo);
      await els.sourceVideo.play();
      state.source = els.sourceVideo;
      state.sourceType = "video";
      state.running = true;
      showSource("영상 파일");
      els.stopButton.disabled = false;
      startPreviewLoop();
      runContinuousAnalysis(++state.runId);
      return;
    }
    if (!file.type.startsWith("image/")) throw new Error("지원하지 않는 파일 형식입니다.");
    els.sourceImage.src = state.objectUrl;
    await waitForImage(els.sourceImage);
    state.source = els.sourceImage;
    state.sourceType = "image";
    showSource("사진 파일");
    els.stopButton.disabled = false;
    drawPreview();
    await analyzeCurrentFrame();
  } catch (error) {
    setStatus(`파일 분석 실패: ${error.message}`, true);
  } finally {
    els.sourceFile.value = "";
  }
}

async function runContinuousAnalysis(runId) {
  while (state.running && state.runId === runId) {
    const started = performance.now();
    await analyzeCurrentFrame();
    const delay = Math.max(0, FRAME_INTERVAL_MS - (performance.now() - started));
    await wait(delay);
  }
}

async function analyzeCurrentFrame() {
  if (!state.source) return;
  try {
    const session = await loadModel();
    const transform = prepareInput(state.source);
    const imageData = inputContext.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
    const tensor = new window.ort.Tensor(
      "float32",
      imageDataToTensorData(imageData),
      [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]
    );
    const started = performance.now();
    let outputs = null;
    try {
      outputs = await session.run({ [session.inputNames[0]]: tensor });
      const elapsed = performance.now() - started;
      const output = outputs[session.outputNames[0]];
      state.detections = decodeYoloOutput(
        output,
        transform,
        state.confidence,
        0.45,
        VEHICLE_CLASS_IDS
      );
      updateResult(elapsed);
      drawPreview();
    } finally {
      tensor.dispose?.();
      Object.values(outputs || {}).forEach((output) => output.dispose?.());
    }
  } catch (error) {
    setStatus(`분석 오류: ${error.message}`, true);
    state.running = false;
    els.stopButton.disabled = true;
  }
}

function prepareInput(source) {
  const { width, height } = sourceDimensions(source);
  const transform = createLetterboxTransform(width, height, MODEL_INPUT_SIZE);
  inputContext.fillStyle = "rgb(114, 114, 114)";
  inputContext.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  inputContext.drawImage(
    source,
    transform.padLeft,
    transform.padTop,
    transform.resizedWidth,
    transform.resizedHeight
  );
  return transform;
}

function startPreviewLoop() {
  cancelAnimationFrame(state.previewFrame);
  const render = () => {
    if (!state.source || !["camera", "video"].includes(state.sourceType)) return;
    drawPreview();
    state.previewFrame = requestAnimationFrame(render);
  };
  state.previewFrame = requestAnimationFrame(render);
}

function drawPreview() {
  if (!state.source) return;
  const { width, height } = sourceDimensions(state.source);
  if (!(width > 0) || !(height > 0)) return;
  const displayScale = Math.min(1, 1280 / width);
  const canvasWidth = Math.max(1, Math.round(width * displayScale));
  const canvasHeight = Math.max(1, Math.round(height * displayScale));
  if (els.resultCanvas.width !== canvasWidth || els.resultCanvas.height !== canvasHeight) {
    els.resultCanvas.width = canvasWidth;
    els.resultCanvas.height = canvasHeight;
  }
  resultContext.drawImage(state.source, 0, 0, canvasWidth, canvasHeight);
  for (const slot of state.slotResults) {
    resultContext.beginPath();
    slot.polygon.forEach(([x, y], index) => {
      if (index === 0) resultContext.moveTo(x * canvasWidth, y * canvasHeight);
      else resultContext.lineTo(x * canvasWidth, y * canvasHeight);
    });
    resultContext.closePath();
    resultContext.strokeStyle = slot.status === "occupied" ? "#ef4444" : slot.status === "empty" ? "#22c55e" : "#fbbf24";
    resultContext.lineWidth = 3;
    resultContext.stroke();
  }
  const scaleX = canvasWidth / width;
  const scaleY = canvasHeight / height;
  for (const detection of state.detections) {
    const [x, y, boxWidth, boxHeight] = detection.bbox;
    const left = x * scaleX;
    const top = y * scaleY;
    const renderedWidth = boxWidth * scaleX;
    const renderedHeight = boxHeight * scaleY;
    resultContext.strokeStyle = "#ffd028";
    resultContext.lineWidth = Math.max(3, canvasWidth / 360);
    resultContext.strokeRect(left, top, renderedWidth, renderedHeight);
    const label = `차량 ${Math.round(detection.score * 100)}%`;
    const fontSize = Math.max(14, Math.round(canvasWidth / 52));
    resultContext.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    const labelWidth = resultContext.measureText(label).width + 14;
    const labelHeight = fontSize + 10;
    const labelTop = Math.max(0, top - labelHeight);
    resultContext.fillStyle = "#ffd028";
    resultContext.fillRect(left, labelTop, labelWidth, labelHeight);
    resultContext.fillStyle = "#17181b";
    resultContext.fillText(label, left + 7, labelTop + fontSize + 2);
  }
}

function updateResult(elapsed) {
  const count = state.detections.length;
  els.vehicleCount.textContent = `${count}대`;
  els.inferenceTime.textContent = `${Math.round(elapsed)}ms`;
  setStatus(count > 0 ? `차량 ${count}대를 감지했습니다.` : "감지된 차량이 없습니다.");
  updateManagementResult(count);
  const { width, height } = sourceDimensions(state.source);
  state.slotResults = state.sourceType === "cctv"
    ? stabilizeCameraSlots(matchCameraSlots(state.detections, state.regions, width, height), state.slotHistory)
    : [];
  if (state.slotResults.length) {
    const occupied = state.slotResults.filter((slot) => slot.status === "occupied").length;
    const available = state.slotResults.filter((slot) => slot.status === "empty").length;
    const unknown = state.slotResults.length - occupied - available;
    if (els.occupancyStatus) els.occupancyStatus.textContent = `주차중 ${occupied}면 · 가능 ${available}면 · 확인 중 ${unknown}면`;
    window.dispatchEvent(new CustomEvent("parkview:camera-slots", { detail: {
      lotId: state.regions.lot_id,
      floorId: state.regions.floor_id,
      analyzedAt: new Date().toISOString(),
      slots: state.slotResults
    } }));
  }
  const payload = {
    version: 1,
    analyzedAt: new Date().toISOString(),
    model: "yolov5su",
    source: state.sourceType,
    lotId: state.regions?.lot_id,
    floorId: state.regions?.floor_id,
    slotResults: state.slotResults,
    image: { width, height },
    count,
    detections: state.detections.map((detection) => ({
      score: Number(detection.score.toFixed(6)),
      bboxNormalized: [
        detection.bbox[0] / width,
        detection.bbox[1] / height,
        detection.bbox[2] / width,
        detection.bbox[3] / height
      ]
    }))
  };
  try {
    localStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify(payload));
    const channel = new BroadcastChannel(ANALYSIS_CHANNEL);
    channel.postMessage(payload);
    channel.close();
  } catch {
    // The live result remains available even when browser storage is restricted.
  }
}

function prepareForNewSource() {
  const stoppingCctv = state.sourceType === "cctv";
  state.running = false;
  state.runId += 1;
  state.detections = [];
  state.slotResults = [];
  state.slotHistory.clear();
  cancelAnimationFrame(state.previewFrame);
  window.clearTimeout(state.cctvTimer);
  state.cctvTimer = 0;
  releaseMediaStream();
  els.sourceVideo.pause();
  els.sourceVideo.removeAttribute("src");
  els.sourceVideo.load();
  els.sourceImage.removeAttribute("src");
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = "";
  state.source = null;
  state.sourceType = "";
  els.vehicleCount.textContent = "0대";
  els.inferenceTime.textContent = "-";
  els.switchCameraButton.disabled = true;
  els.stopButton.disabled = true;
  if (stoppingCctv) {
    window.ParkViewNative?.disconnectCctv?.().catch(() => {});
  }
}

function stopSource() {
  if (!els.panel || !resultContext) return;
  prepareForNewSource();
  els.viewportPlaceholder.hidden = false;
  els.sourceBadge.hidden = true;
  resultContext.fillStyle = "#151619";
  resultContext.fillRect(0, 0, els.resultCanvas.width, els.resultCanvas.height);
  setStatus(state.session ? "카메라를 연결하거나 사진·영상을 선택하세요." : "카메라 연결을 눌러 시작하세요.");
}

function releaseMediaStream() {
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  els.sourceVideo.srcObject = null;
}

function showSource(label) {
  els.viewportPlaceholder.hidden = true;
  els.sourceBadge.hidden = false;
  els.sourceBadge.textContent = label;
  setStatus("현장 화면을 분석하고 있습니다.");
}

function sourceDimensions(source) {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  return { width: source.naturalWidth, height: source.naturalHeight };
}

function waitForVideo(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    video.addEventListener("loadedmetadata", resolve, { once: true });
    video.addEventListener("error", () => reject(new Error("영상을 읽지 못했습니다.")), { once: true });
  });
}

function waitForImage(image) {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", () => reject(new Error("사진을 읽지 못했습니다.")), { once: true });
  });
}

function setModelState(kind, label) {
  els.modelBadge.textContent = label;
  els.modelBadge.classList.toggle("is-ready", kind === "ready");
  els.modelBadge.classList.toggle("is-error", kind === "error");
}

function setStatus(message, isError = false) {
  els.analysisStatus.textContent = message;
  els.analysisStatus.classList.toggle("is-error", isError);
}

function updateManagementConnection(label, sourceType = state.sourceType) {
  const chip = document.querySelector("#cameraConnectionChip");
  const cameraStatus = document.querySelector("#cameraStatus");
  const intervalStatus = document.querySelector("#cameraIntervalStatus");
  const isCctv = sourceType === "cctv";
  if (chip) {
    chip.textContent = isCctv ? "CCTV 직접 연결" : "기기 내 AI";
    chip.classList.remove("is-linked", "is-error", "is-manual");
    chip.classList.add("is-live");
  }
  if (cameraStatus) cameraStatus.textContent = label;
  if (intervalStatus) intervalStatus.textContent = isCctv ? "2초" : "연속";
}

function updateManagementResult(count) {
  updateManagementConnection("분석 중");
  const analysisStatus = document.querySelector("#analysisStatus");
  const objectStatus = document.querySelector("#objectStatus");
  if (analysisStatus) analysisStatus.textContent = "방금";
  if (objectStatus) {
    const sourceLabel = state.sourceType === "cctv" ? "고정 CCTV" : "기기 카메라";
    objectStatus.textContent = `${sourceLabel}에서 차량 ${count}대를 감지했습니다.`;
  }
}

function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError") return "카메라 권한이 차단되었습니다. 사이트의 카메라 권한을 허용해 주세요.";
  if (error?.name === "NotFoundError") return "사용할 수 있는 카메라를 찾지 못했습니다.";
  if (error?.name === "NotReadableError") return "다른 앱이 카메라를 사용 중입니다.";
  return `카메라 시작 실패: ${error?.message || "알 수 없는 오류"}`;
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
