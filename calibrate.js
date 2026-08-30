const state = {
  image: null,
  points: [],
  slots: [],
  kind: "normal"
};

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

const ctx = els.canvas.getContext("2d");

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  render();
});

function bindEvents() {
  els.adminToken.addEventListener("change", loadRegions);
  els.frameFile.addEventListener("change", async () => {
    const file = els.frameFile.files?.[0];
    if (file) await loadImageBlob(file, file.name);
  });
  els.cameraFrameButton.addEventListener("click", loadCameraFrame);
  els.canvas.addEventListener("pointerdown", addCanvasPoint);
  els.kindButtons.forEach((button) => {
    button.addEventListener("click", () => setKind(button.dataset.kind));
  });
  els.undoButton.addEventListener("click", undoLast);
  els.saveButton.addEventListener("click", saveRegions);
  els.floorId.addEventListener("input", updateProgress);
  els.slotNumber.addEventListener("input", updateProgress);
}

function authHeaders(extra = {}) {
  return {
    ...extra,
    Authorization: `Bearer ${els.adminToken.value.trim()}`
  };
}

async function loadRegions() {
  if (!els.adminToken.value.trim()) {
    els.saveStatus.textContent = "관리자 토큰을 입력하세요.";
    return;
  }
  try {
    const response = await fetch("/api/regions", {
      cache: "no-store",
      headers: authHeaders()
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    const payload = await response.json();
    state.slots = Array.isArray(payload.slots) ? payload.slots : [];
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
    const response = await fetch(`/api/calibration-frame?t=${Date.now()}`, {
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
  state.points.push([
    clamp((event.clientX - rect.left) / rect.width, 0, 1),
    clamp((event.clientY - rect.top) / rect.height, 0, 1)
  ]);
  if (state.points.length === 4) addCompletedSlot();
  render();
}

function addCompletedSlot() {
  const slotNumber = Math.max(1, Number(els.slotNumber.value) || 1);
  const floor = (els.floorId.value.trim() || "B1").toUpperCase();
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
  els.kindButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.kind === kind);
  });
}

function undoLast() {
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
  if (!els.adminToken.value.trim()) {
    els.saveStatus.textContent = "관리자 토큰을 입력하세요.";
    return;
  }
  if (state.slots.length === 0) {
    els.saveStatus.textContent = "저장할 주차면이 없습니다.";
    return;
  }
  els.saveButton.disabled = true;
  els.saveStatus.textContent = "주차면 좌표를 저장하는 중입니다...";
  try {
    const response = await fetch("/api/regions", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        coordinate_system: "normalized_camera_image",
        floor_id: (els.floorId.value.trim() || "B1").toUpperCase(),
        slots: state.slots
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    els.saveStatus.textContent = `${payload.count}개 주차면을 저장했습니다.`;
  } catch (error) {
    els.saveStatus.textContent = `저장 실패: ${error.message}`;
  } finally {
    els.saveButton.disabled = false;
  }
}

function deleteSlot(index) {
  const [removed] = state.slots.splice(index, 1);
  els.saveStatus.textContent = `${removed.id} 주차면을 목록에서 지웠습니다. 저장해야 반영됩니다.`;
  render();
}

function render() {
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
  state.slots.forEach((slot) => {
    drawPolygon(slot.polygon, colorForKind(slot.kind), slot.slot_index + 1);
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
