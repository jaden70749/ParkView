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
  iouThreshold = DEFAULT_IOU_THRESHOLD
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
