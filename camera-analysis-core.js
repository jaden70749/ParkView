export const MODEL_INPUT_SIZE = 640;
export const DEFAULT_CONFIDENCE = 0.25;
export const DEFAULT_IOU_THRESHOLD = 0.45;

export function createLetterboxTransform(sourceWidth, sourceHeight, size = MODEL_INPUT_SIZE) {
  if (!(sourceWidth > 0) || !(sourceHeight > 0) || !(size > 0)) {
    throw new Error("Invalid image dimensions");
  }
  const scale = Math.min(size / sourceWidth, size / sourceHeight);
  const resizedWidth = Math.max(1, Math.round(sourceWidth * scale));
  const resizedHeight = Math.max(1, Math.round(sourceHeight * scale));
  const padLeft = Math.floor((size - resizedWidth) / 2);
  const padTop = Math.floor((size - resizedHeight) / 2);
  return {
    sourceWidth,
    sourceHeight,
    size,
    resizedWidth,
    resizedHeight,
    padLeft,
    padTop,
    scaleX: resizedWidth / sourceWidth,
    scaleY: resizedHeight / sourceHeight
  };
}

export function imageDataToTensorData(imageData) {
  const pixelCount = imageData.width * imageData.height;
  const tensorData = new Float32Array(pixelCount * 3);
  for (let pixel = 0, rgba = 0; pixel < pixelCount; pixel += 1, rgba += 4) {
    tensorData[pixel] = imageData.data[rgba] / 255;
    tensorData[pixelCount + pixel] = imageData.data[rgba + 1] / 255;
    tensorData[(pixelCount * 2) + pixel] = imageData.data[rgba + 2] / 255;
  }
  return tensorData;
}

export function decodeYoloOutput(
  output,
  transform,
  confidenceThreshold = DEFAULT_CONFIDENCE,
  iouThreshold = DEFAULT_IOU_THRESHOLD,
  allowedClassIds = null
) {
  const dims = Array.from(output?.dims || []);
  const data = output?.data;
  if (!data || dims.length !== 3 || dims[0] !== 1) {
    throw new Error(`Unexpected YOLO output shape: ${dims.join("x") || "unknown"}`);
  }

  const firstCouldBeChannels = dims[1] >= 5 && dims[1] <= 256;
  const lastCouldBeChannels = dims[2] >= 5 && dims[2] <= 256;
  const channelsFirst = firstCouldBeChannels !== lastCouldBeChannels
    ? firstCouldBeChannels
    : dims[1] <= dims[2];
  const channelCount = channelsFirst ? dims[1] : dims[2];
  const predictionCount = channelsFirst ? dims[2] : dims[1];
  if (channelCount < 5) {
    throw new Error(`YOLO output has too few channels: ${channelCount}`);
  }

  const valueAt = channelsFirst
    ? (channel, index) => data[(channel * predictionCount) + index]
    : (channel, index) => data[(index * channelCount) + channel];
  const candidates = [];

  for (let index = 0; index < predictionCount; index += 1) {
    let score = 0;
    let classIndex = 0;
    for (let channel = 4; channel < channelCount; channel += 1) {
      const candidateScore = valueAt(channel, index);
      if (candidateScore > score) {
        score = candidateScore;
        classIndex = channel - 4;
      }
    }
    if (!Number.isFinite(score) || score < confidenceThreshold) continue;
    if (allowedClassIds && !allowedClassIds.includes(classIndex)) continue;

    const centerX = valueAt(0, index);
    const centerY = valueAt(1, index);
    const width = valueAt(2, index);
    const height = valueAt(3, index);
    const left = (centerX - (width / 2) - transform.padLeft) / transform.scaleX;
    const top = (centerY - (height / 2) - transform.padTop) / transform.scaleY;
    const right = (centerX + (width / 2) - transform.padLeft) / transform.scaleX;
    const bottom = (centerY + (height / 2) - transform.padTop) / transform.scaleY;
    const x1 = clamp(left, 0, transform.sourceWidth);
    const y1 = clamp(top, 0, transform.sourceHeight);
    const x2 = clamp(right, 0, transform.sourceWidth);
    const y2 = clamp(bottom, 0, transform.sourceHeight);
    if (x2 - x1 < 2 || y2 - y1 < 2) continue;

    candidates.push({
      classIndex,
      score,
      bbox: [x1, y1, x2 - x1, y2 - y1]
    });
  }

  return nonMaximumSuppression(candidates, iouThreshold, 100);
}

export function nonMaximumSuppression(candidates, iouThreshold, limit = 100) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const selected = [];
  for (const candidate of sorted) {
    if (selected.length >= limit) break;
    const overlaps = selected.some((item) => (
      item.classIndex === candidate.classIndex
      && intersectionOverUnion(item.bbox, candidate.bbox) > iouThreshold
    ));
    if (!overlaps) selected.push(candidate);
  }
  return selected;
}

export function intersectionOverUnion(first, second) {
  const [ax, ay, aw, ah] = first;
  const [bx, by, bw, bh] = second;
  const overlapWidth = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
  const overlapHeight = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  const intersection = overlapWidth * overlapHeight;
  const union = (aw * ah) + (bw * bh) - intersection;
  return union > 0 ? intersection / union : 0;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

// Camera pixels and the drawn floor plan are different coordinate systems.
// Only explicitly calibrated camera polygons may determine availability.
export function matchCameraSlots(detections, config, width, height) {
  if (config?.coordinate_system !== "normalized_camera_image" || !config.slots?.length
      || !(width > 0 && height > 0)) return [];
  const slots = config.slots.filter((slot) => Array.isArray(slot.polygon)
    && slot.polygon.length >= 3 && slot.polygon.every((point) => Array.isArray(point)
      && point.length === 2 && point.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)));
  return slots.map((slot) => {
    const occupied = detections.some(({ bbox }) => {
      if (!bbox?.every(Number.isFinite)) return false;
      const [x, y, w, h] = bbox;
      return pointInsidePolygon([(x + w / 2) / width, (y + h / 2) / height], slot.polygon);
    });
    return { ...slot, status: occupied ? "occupied" : "empty" };
  });
}

function pointInsidePolygon([x, y], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[j];
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (Math.abs(cross) < 1e-9 && x >= Math.min(ax, bx) && x <= Math.max(ax, bx)
        && y >= Math.min(ay, by) && y <= Math.max(ay, by)) return true;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

export function stabilizeCameraSlots(results, history, confirmations = 3) {
  return results.map((slot) => {
    const previous = history.get(slot.id) || { status: "unknown", emptyCount: 0 };
    const emptyCount = slot.status === "empty" ? previous.emptyCount + 1 : 0;
    const status = slot.status === "occupied" ? "occupied"
      : emptyCount >= confirmations ? "empty" : previous.status;
    history.set(slot.id, { status, emptyCount });
    return { ...slot, status };
  });
}
