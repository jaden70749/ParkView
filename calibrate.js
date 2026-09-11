const state = {
  image: null,
  points: [],
  slots: [],
  kind: "normal",
  revision: null,
  savedSlots: "",
  selected: -1,
  dragging: null,
  mode: "region",
  candidates: null,
  roi: null
};
const setupParams = new URLSearchParams(window.location.search);
const setupLotId = (setupParams.get("lot_id") || "").trim();
const cameraBase = String(window.PARKVIEW_CONFIG?.cameraApiBaseUrl || "").trim().replace(/\/+$/, "");

const els = {
  adminToken: document.querySelector("#adminToken"),
  frameFile: document.querySelector("#frameFile"),
  cameraFrameButton: document.querySelector("#cameraFrameButton"),
  sourceStatus: document.querySelector("#sourceStatus"),
  canvas: document.querySelector("#calibrationCanvas"),
  canvasPlaceholder: document.querySelector("#canvasPlaceholder"),
  slotProgress: document.querySelector("#slotProgress"),
  pointProgress: document.querySelector("#pointProgress"),
  floorId: document.querySelector("#floorId"),
  slotNumber: document.querySelector("#slotNumber"),
  kindButtons: document.querySelectorAll("[data-kind]"),
  undoButton: document.querySelector("#undoButton"),
  saveButton: document.querySelector("#saveButton"),
  saveStatus: document.querySelector("#saveStatus"),
  slotCount: document.querySelector("#slotCount"),
  slotList: document.querySelector("#slotList")
};
els.detectButton = document.querySelector("#detectButton");
els.applyDetectionButton = document.querySelector("#applyDetectionButton");
els.discardDetectionButton = document.querySelector("#discardDetectionButton");
els.modeButtons = document.querySelectorAll("[data-mode]");

const ctx = els.canvas.getContext("2d");

function currentFloorId() {
  return (els.floorId.value.trim() || "B1").toUpperCase();
}

document.addEventListener("DOMContentLoaded", () => {
  els.floorId.value = setupParams.get("floor_id") || "B1";
  els.floorId.readOnly = true;
  document.querySelector("#trainingGroup").value = defaultTrainingGroup();
  bindEvents();
  render();
});

function bindEvents() {
  document.querySelector("#referenceButton").addEventListener("click", saveEmptyReference);
  document.querySelector("#trainingSampleButton").addEventListener("click", saveTrainingSample);
  document.querySelector("#reloadRegionsButton").addEventListener("click", loadRegions);
  els.adminToken.addEventListener("change", loadRegions);
  els.frameFile.addEventListener("change", async () => {
    const file = els.frameFile.files?.[0];
    if (file) await loadImageBlob(file, file.name);
  });
  els.cameraFrameButton.addEventListener("click", loadCameraFrame);
  els.canvas.addEventListener("pointerdown", addCanvasPoint);
  els.canvas.addEventListener("pointermove", moveCanvasPoint);
  els.canvas.addEventListener("pointerup", () => { state.dragging = null; });
  els.canvas.addEventListener("pointercancel", () => { state.dragging = null; });
  els.detectButton.addEventListener("click", detectRegions);
  els.applyDetectionButton.addEventListener("click", () => {
    state.slots = state.candidates;
    state.candidates = null;
    state.points = [];
    state.selected = -1;
    els.slotNumber.value = String(state.slots.length + 1);
    els.saveStatus.textContent = "감지 결과를 적용했습니다. 확인 후 저장해 주세요.";
    render();
  });
  els.discardDetectionButton.addEventListener("click", () => { state.candidates = null; render(); });
  els.modeButtons.forEach(button => button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    state.points = [];
    els.modeButtons.forEach(b => b.setAttribute("aria-pressed", String(b === button)));
    render();
  }));
  els.kindButtons.forEach((button) => {
    button.addEventListener("click", () => setKind(button.dataset.kind));
  });
  els.undoButton.addEventListener("click", undoLast);
  els.saveButton.addEventListener("click", saveRegions);
  els.floorId.addEventListener("input", updateProgress);
  els.slotNumber.addEventListener("input", updateProgress);
  els.slotNumber.addEventListener("change", () => {
    const selected = state.slots[state.selected];
    if (state.mode !== "edit" || !selected) return;
    const next = Math.max(0, Math.floor(Number(els.slotNumber.value) || 1)-1);
    const other = state.slots.find(slot => slot !== selected && slot.slot_index === next);
    if (other) { other.slot_index = selected.slot_index; other.id = selected.id; }
    selected.slot_index = next;
    selected.id = `${currentFloorId()}-${String(next+1).padStart(3, "0")}`;
    render();
  });
}

function regionsUrl(path = "/api/regions") {
  return `${cameraBase}${path}?${new URLSearchParams({ lot_id: setupLotId, floor_id: currentFloorId(), method: "lines", roi: JSON.stringify(state.roi) })}`;
}

async function saveEmptyReference() {
  if (!state.image || !state.slots.length || state.candidates || state.points.length ||
      state.savedSlots !== JSON.stringify(state.slots)) {
    els.saveStatus.textContent = "주차면 좌표를 먼저 저장한 뒤, 차량을 치운 사진을 불러와 주세요.";
    return;
  }
  if (!window.confirm("현재 사진의 모든 주차칸이 비어 있나요? 물체가 남아 있으면 점유 판단이 잘못될 수 있습니다.")) return;
  const button = document.querySelector("#referenceButton");
  button.disabled = true;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = state.image.naturalWidth;
    canvas.height = state.image.naturalHeight;
    canvas.getContext("2d").drawImage(state.image, 0, 0);
    const response = await fetch(`${cameraBase}/api/regions/reference`, {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ lot_id: setupLotId, floor_id: currentFloorId(),
        expected_revision: state.revision, confirmed_empty: true,
        image_base64: canvas.toDataURL("image/jpeg", 0.96).split(",")[1] })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    state.revision = result.revision;
    els.saveStatus.textContent = "빈 주차장 기준 저장 완료. 물체 점유 분석이 적용됩니다.";
  } catch (error) { els.saveStatus.textContent = `기준 저장 실패: ${error.message}`; }
  finally { button.disabled = false; }
}

function defaultTrainingGroup() {
  return `${setupLotId}-${currentFloorId()}-${new Date().toISOString().slice(0, 10)}`;
}

function trainingStatus(message) {
  document.querySelector("#trainingStatus").textContent = message;
}

async function saveTrainingSample() {
  const button = document.querySelector("#trainingSampleButton");
  if (button.disabled) return;
  if (!state.image || !state.slots.length || state.candidates || state.points.length) {
    trainingStatus("사진과 확정한 주차면 좌표가 필요합니다.");
    return;
  }
  if (!setupLotId || !els.adminToken.value.trim()) {
    trainingStatus("주차장 정보와 관리자 토큰이 필요합니다.");
    return;
  }
  const groupInput = document.querySelector("#trainingGroup");
  if (!groupInput.value.trim()) groupInput.value = defaultTrainingGroup();
  button.disabled = true;
  trainingStatus("학습 자료 저장 중...");
  try {
    const canvas = document.createElement("canvas");
    canvas.width = state.image.naturalWidth;
    canvas.height = state.image.naturalHeight;
    canvas.getContext("2d").drawImage(state.image, 0, 0);
    const response = await fetch(`${cameraBase}/api/regions/training-sample`, {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ lot_id: setupLotId, floor_id: currentFloorId(), slots: state.slots,
        group: groupInput.value.trim(),
        split: document.querySelector("#trainingSplit").value,
        image_base64: canvas.toDataURL("image/jpeg", 0.94).split(",")[1] }),
      signal: AbortSignal.timeout(30000)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    trainingStatus(`사진 1장과 주차면 ${result.count}개를 학습 자료로 저장했습니다.`);
  } catch (error) { trainingStatus(`학습 자료 저장 실패: ${error.message}`); }
  finally { button.disabled = false; }
}

function authHeaders(extra = {}) {
  return {
    ...extra,
    ...(cameraBase.endsWith(".loca.lt") ? { "bypass-tunnel-reminder": "true" } : {}),
    Authorization: `Bearer ${els.adminToken.value.trim()}`
  };
}

async function loadRegions() {
  if (!els.adminToken.value.trim()) {
    els.saveStatus.textContent = "관리자 토큰을 입력하세요.";
    return;
  }
  try {
    const response = await fetch(regionsUrl(), {
      cache: "no-store",
      headers: authHeaders()
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    const payload = await response.json();
    state.revision = payload.revision;
    state.candidates = null;
    state.points = [];
    state.selected = null;
    state.dragging = null;
    state.slots = Array.isArray(payload.slots) ? payload.slots : [];
    state.savedSlots = JSON.stringify(state.slots);
    const highest = state.slots.reduce(
      (value, slot) => Math.max(value, Number(slot.slot_index) + 1),
      0
    );
    els.slotNumber.value = String(highest + 1);
    els.saveStatus.textContent = `기존 주차면 ${state.slots.length}개를 불러왔습니다.`;
    render();
  } catch (error) {
    els.saveStatus.textContent = `주차면을 읽지 못했습니다: ${error.message}`;
  }
}

async function loadCameraFrame() {
  if (!els.adminToken.value.trim()) {
    els.sourceStatus.textContent = "관리자 토큰을 먼저 입력하세요.";
    return;
  }
  els.sourceStatus.textContent = "CCTV에서 프레임을 가져오는 중입니다...";
  try {
    const response = await fetch(`${cameraBase}/api/camera/preview?t=${Date.now()}`, {
      cache: "no-store",
      headers: authHeaders()
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    await loadImageBlob(await response.blob(), "CCTV 현재 프레임");
  } catch (error) {
    els.sourceStatus.textContent = `프레임을 불러오지 못했습니다: ${error.message}`;
  }
}

async function loadImageBlob(blob, label) {
  const image = new Image();
  const url = URL.createObjectURL(blob);
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("이미지를 읽지 못했습니다"));
      image.src = url;
    });
    state.image = image;
    state.candidates = null;
    state.dragging = null;
    state.points = [];
    els.canvas.width = image.naturalWidth;
    els.canvas.height = image.naturalHeight;
    els.canvasPlaceholder.hidden = true;
    els.sourceStatus.textContent = `${label} · ${image.naturalWidth}×${image.naturalHeight}`;
    render();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function addCanvasPoint(event) {
  if (!state.image || state.points.length >= 4) return;
  const rect = els.canvas.getBoundingClientRect();
  if (state.mode === "edit") {
    let nearest = null;
    let distance = 22;
    state.slots.forEach((slot, index) => slot.polygon.forEach(([x, y], vertex) => {
      const d = Math.hypot(x * rect.width + rect.left - event.clientX, y * rect.height + rect.top - event.clientY);
      if (d < distance) { distance = d; nearest = { index, vertex }; }
    }));
    if (nearest) {
      state.selected = nearest.index;
      els.slotNumber.value = String(state.slots[nearest.index].slot_index+1);
      state.dragging = nearest;
      els.canvas.setPointerCapture(event.pointerId);
      render();
    }
    return;
  }
  state.points.push([
    clamp((event.clientX - rect.left) / rect.width, 0, 1),
    clamp((event.clientY - rect.top) / rect.height, 0, 1)
  ]);
  if (state.points.length === 4) {
    if (state.mode === "region") {
      state.roi = state.points;
      state.points = [];
      els.saveStatus.textContent = "감지 구역 선택 완료. 구획선으로 주차면 찾기를 누르세요.";
    } else addCompletedSlot();
  }
  render();
}

function moveCanvasPoint(event) {
  if (!state.dragging) return;
  const rect = els.canvas.getBoundingClientRect();
  const { index, vertex } = state.dragging;
  state.slots[index].polygon[vertex] = [
    round(clamp((event.clientX - rect.left) / rect.width, 0, 1)),
    round(clamp((event.clientY - rect.top) / rect.height, 0, 1))
  ];
  drawCanvas();
}

async function detectRegions() {
  if (els.detectButton.disabled) return;
  if (!state.roi && state.slots.length === 1 && state.slots[0].polygon.length === 4) {
    const polygon = state.slots[0].polygon;
    const area = Math.abs(polygon.reduce((sum, p, i) => {
      const q = polygon[(i+1)%polygon.length];
      return sum+p[0]*q[1]-p[1]*q[0];
    }, 0))/2;
    if (area > 0.03 && window.confirm("큰 영역이 주차칸 1개로 추가되어 있습니다. 이 영역 안에서 주차칸을 찾을까요? 기존 좌표는 감지 결과를 적용할 때까지 유지됩니다.")) {
      state.roi = polygon.map(point => [...point]);
      state.points = [];
      render();
    }
  }
  if (!state.roi) {
    detectionStatus("감지 구역 선택을 누르고, 주차장 전체를 감싸는 모서리 4개를 순서대로 선택해 주세요.");
    return;
  }
  if (!state.image || !els.adminToken.value.trim() || !setupLotId) {
    detectionStatus("주차장 정보, 관리자 토큰과 CCTV 이미지가 필요합니다.");
    return;
  }
  els.detectButton.disabled = true;
  els.detectButton.textContent = "주차면 찾는 중...";
  const sourceImage = state.image;
  detectionStatus("주차면 감지 중...");
  try {
    const imageCanvas = document.createElement("canvas");
    imageCanvas.width = state.image.naturalWidth;
    imageCanvas.height = state.image.naturalHeight;
    imageCanvas.getContext("2d").drawImage(state.image, 0, 0);
    const blob = await new Promise(resolve => imageCanvas.toBlob(resolve, "image/jpeg", 0.94));
    if (!blob) throw new Error("사진을 변환하지 못했습니다. 프레임을 다시 불러와 주세요.");
    const response = await fetch(regionsUrl("/api/regions/detect"), {
      method: "POST", headers: authHeaders({ "Content-Type": "image/jpeg" }), body: blob,
      signal: AbortSignal.timeout(30000)
    });
    const result = await response.json();
    if (state.image !== sourceImage) throw new Error("이미지가 변경되었습니다. 새 이미지에서 다시 감지해 주세요.");
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    if (!result.slots?.length) throw new Error("감지된 주차면이 없습니다. 기존 좌표는 유지됩니다.");
    state.candidates = result.slots;
    detectionStatus(`${result.slots.length}면 감지됨. 아래 감지 결과 적용을 누른 뒤 좌표를 저장해 주세요.`);
    render();
  } catch (error) {
    detectionStatus(`자동 감지 실패: ${error.message}`);
  } finally {
    els.detectButton.disabled = false;
    els.detectButton.textContent = "구획선으로 주차면 찾기";
  }
}

function detectionStatus(message) {
  els.sourceStatus.textContent = message;
  els.saveStatus.textContent = message;
}

function addCompletedSlot() {
  const slotNumber = Math.max(1, Number(els.slotNumber.value) || 1);
  const floor = currentFloorId();
  if (state.slots.some(slot => slot.slot_index === slotNumber - 1)) {
    state.points = [];
    els.saveStatus.textContent = "이미 사용 중인 주차면 번호입니다.";
    return;
  }
  state.slots.push({
    id: `${floor}-${String(slotNumber).padStart(3, "0")}`,
    slot_index: slotNumber - 1,
    kind: state.kind,
    polygon: state.points.map(([x, y]) => [round(x), round(y)])
  });
  state.points = [];
  els.slotNumber.value = String(slotNumber + 1);
  els.saveStatus.textContent = `${floor}-${String(slotNumber).padStart(3, "0")} 주차면을 추가했습니다.`;
}

function setKind(kind) {
  state.kind = kind;
  if (state.mode === "edit" && state.slots[state.selected]) {
    state.slots[state.selected].kind = kind;
    render();
  }
  els.kindButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.kind === kind);
  });
}

function undoLast() {
  state.selected = null;
  state.dragging = null;
  if (state.points.length > 0) {
    state.points.pop();
  } else if (state.slots.length > 0) {
    const removed = state.slots.pop();
    els.slotNumber.value = String(Math.max(1, Number(removed.slot_index) + 1));
    els.saveStatus.textContent = `${removed.id} 등록을 되돌렸습니다.`;
  }
  render();
}

async function saveRegions() {
  if (!setupLotId) {
    els.saveStatus.textContent = "주차장 관리 화면의 CCTV 주차면 등록 버튼으로 열어 주세요.";
    return;
  }
  if (!els.adminToken.value.trim()) {
    els.saveStatus.textContent = "관리자 토큰을 입력하세요.";
    return;
  }
  if (state.points.length || state.candidates) {
    els.saveStatus.textContent = "편집 중인 주차면이나 감지 결과를 먼저 확정해 주세요.";
    return;
  }
  els.saveButton.disabled = true;
  els.saveStatus.textContent = "주차면 좌표를 저장하는 중입니다...";
  try {
    if (!state.revision) throw new Error("관리자 토큰을 입력해 기존 좌표를 먼저 불러와 주세요.");
    const response = await fetch(`${cameraBase}/api/regions`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        coordinate_system: "normalized_camera_image",
        occupancy_strategy: "empty_reference_difference",
        occupancy_threshold: 0.3,
        lot_id: setupLotId,
        floor_id: currentFloorId(),
        expected_revision: state.revision,
        slots: state.slots
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    state.revision = payload.revision;
    state.savedSlots = JSON.stringify(state.slots);
    els.saveStatus.textContent = `${payload.count}개 주차면을 저장했습니다. 원래 화면에서 카메라 연결을 다시 눌러 적용하세요.`;
  } catch (error) {
    els.saveStatus.textContent = `저장 실패: ${error.message}`;
  } finally {
    els.saveButton.disabled = false;
  }
}

function deleteSlot(index) {
  const [removed] = state.slots.splice(index, 1);
  state.selected = -1;
  els.saveStatus.textContent = `${removed.id} 주차면을 목록에서 지웠습니다. 저장해야 반영됩니다.`;
  render();
}

function render() {
  els.applyDetectionButton.hidden = !state.candidates;
  els.discardDetectionButton.hidden = !state.candidates;
  drawCanvas();
  updateProgress();
  renderSlotList();
}

function drawCanvas() {
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  if (!state.image) {
    ctx.fillStyle = "#17191d";
    ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
    return;
  }
  ctx.drawImage(state.image, 0, 0, els.canvas.width, els.canvas.height);
  if (state.roi) drawPolygon(state.roi, "#00a8dd", null);
  (state.candidates || state.slots).forEach((slot, index) => {
    drawPolygon(slot.polygon, state.candidates ? "#f8c400" : index === state.selected ? "#f8c400" : colorForKind(slot.kind), slot.slot_index + 1);
  });
  if (state.points.length > 0) drawPolygon(state.points, "#f8c400", null, false);
}

function drawPolygon(points, color, label, close = true) {
  if (!points.length) return;
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    const px = x * els.canvas.width;
    const py = y * els.canvas.height;
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  if (close && points.length >= 3) ctx.closePath();
  ctx.lineWidth = Math.max(3, els.canvas.width / 320);
  ctx.strokeStyle = color;
  ctx.stroke();
  points.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x * els.canvas.width, y * els.canvas.height, Math.max(5, els.canvas.width / 180), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });
  if (label !== null) {
    const [x, y] = points[0];
    ctx.fillStyle = color;
    ctx.font = `900 ${Math.max(16, els.canvas.width / 50)}px sans-serif`;
    ctx.fillText(String(label), x * els.canvas.width + 9, y * els.canvas.height + 24);
  }
}

function updateProgress() {
  const floor = (els.floorId.value.trim() || "B1").toUpperCase();
  const number = Math.max(1, Number(els.slotNumber.value) || 1);
  els.slotProgress.textContent = `${floor}-${String(number).padStart(3, "0")}`;
  els.pointProgress.textContent = `모서리 ${state.points.length} / 4`;
}

function renderSlotList() {
  els.slotCount.textContent = `${state.slots.length}면`;
  els.slotList.replaceChildren();
  if (state.slots.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "등록된 주차면이 없습니다.";
    els.slotList.appendChild(empty);
    return;
  }
  state.slots.forEach((slot, index) => {
    const row = document.createElement("div");
    row.className = "slot-row";
    const swatch = document.createElement("i");
    swatch.className = slot.kind;
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = slot.id;
    const detail = document.createElement("span");
    detail.textContent = `${kindLabel(slot.kind)} · 도면 ${slot.slot_index + 1}번`;
    copy.append(title, detail);
    copy.tabIndex = 0;
    copy.setAttribute("role", "button");
    copy.setAttribute("aria-label", `${slot.id} 수정`);
    const select = () => {
      state.selected = index;
      els.slotNumber.value = String(slot.slot_index+1);
      state.mode = "edit";
      state.points = [];
      els.modeButtons.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === "edit")));
      drawCanvas();
    };
    copy.addEventListener("click", select);
    copy.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); } });
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.setAttribute("aria-label", `${slot.id} 삭제`);
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", () => deleteSlot(index));
    row.append(swatch, copy, deleteButton);
    els.slotList.appendChild(row);
  });
}

function colorForKind(kind) {
  if (kind === "disabled") return "#377df2";
  if (kind === "pregnant") return "#e45acb";
  return "#2aaa16";
}

function kindLabel(kind) {
  if (kind === "disabled") return "장애인";
  if (kind === "pregnant") return "임산부";
  return "일반";
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value) {
  return Math.round(value * 1000000) / 1000000;
}
