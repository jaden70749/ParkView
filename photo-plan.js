(function () {
  let runtime;
  const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  function loadRuntime() {
    if (runtime) return runtime;
    runtime = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timer = setTimeout(() => reject(new Error("구획선 분석기를 불러오지 못했습니다.")), 45000);
      script.src = new URL("./vendor/opencv/opencv.js", document.baseURI).href;
      script.onload = async () => {
        try {
          const cv = await window.cv;
          if (!cv?.Mat) throw new Error("구획선 분석기가 준비되지 않았습니다.");
          clearTimeout(timer);
          resolve(cv);
        } catch (error) { clearTimeout(timer); reject(error); }
      };
      script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error("구획선 분석기 연결에 실패했습니다.")); };
      document.head.appendChild(script);
    }).catch(error => { runtime = null; throw error; });
    return runtime;
  }

  function stableRectangles(cv, canvas) {
    const rgba = cv.imread(canvas);
    const rgb = new cv.Mat();
    const hsv = new cv.Mat();
    const mask = new cv.Mat(canvas.height, canvas.width, cv.CV_8UC1);
    const candidates = [];
    try {
      cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
      cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
      for (const threshold of [185, 195, 205, 215, 225]) {
        for (let i = 0; i < mask.data.length; i++) {
          mask.data[i] = hsv.data[i * 3 + 1] <= 80 && hsv.data[i * 3 + 2] >= threshold ? 255 : 0;
        }
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        try {
          cv.findContours(mask, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
          for (let i = 0; i < contours.size(); i++) {
            const contour = contours.get(i);
            const polygon = new cv.Mat();
            try {
              const area = cv.contourArea(contour);
              if (area < canvas.width * canvas.height * 0.001 || area > canvas.width * canvas.height * 0.018) continue;
              cv.approxPolyDP(contour, polygon, cv.arcLength(contour, true) * 0.025, true);
              if (polygon.rows !== 4 || !cv.isContourConvex(polygon)) continue;
              const rect = cv.minAreaRect(contour);
              const short = Math.min(rect.size.width, rect.size.height);
              const ratio = Math.max(rect.size.width, rect.size.height) / short;
              if (short < 14 || ratio < 1.35 || ratio > 2.7) continue;
              const box = cv.boundingRect(contour);
              const match = candidates.find(item => Math.abs(item.x - box.x) < box.width * 0.15 && Math.abs(item.y - box.y) < box.height * 0.15);
              if (match) match.support.add(threshold);
              else candidates.push({ x: box.x, y: box.y, w: box.width, h: box.height, support: new Set([threshold]) });
            } finally { polygon.delete(); contour.delete(); }
          }
        } finally { contours.delete(); hierarchy.delete(); }
      }
      return candidates.filter(item => item.support.size >= 3).map(({ support, ...box }) => box);
    } finally { rgba.delete(); rgb.delete(); hsv.delete(); mask.delete(); }
  }

  function measuredRows(rectangles) {
    if (rectangles.length < 8) return [];
    const typicalArea = median(rectangles.map(box => box.w * box.h));
    const boxes = rectangles.filter(box => box.w * box.h < typicalArea * 1.8 && box.w * box.h > typicalArea * 0.45);
    const rows = [];
    for (const box of boxes) {
      const vertical = box.w > box.h;
      const cross = vertical ? box.x + box.w / 2 : box.y + box.h / 2;
      const depth = vertical ? box.w : box.h;
      let row = rows.find(item => item.vertical === vertical && Math.abs(item.cross - cross) < depth * 0.3);
      if (!row) { row = { vertical, cross, boxes: [] }; rows.push(row); }
      row.boxes.push({ ...box });
      row.cross = median(row.boxes.map(item => vertical ? item.x + item.w / 2 : item.y + item.h / 2));
    }
    return rows.filter(row => row.boxes.length >= 3).map(row => {
      const position = box => row.vertical ? box.y + box.h / 2 : box.x + box.w / 2;
      row.boxes.sort((a, b) => position(a) - position(b));
      const gaps = row.boxes.slice(1).map((box, i) => position(box) - position(row.boxes[i]));
      const pitch = median(gaps);
      const completed = [];
      for (let i = 0; i < row.boxes.length; i++) {
        const box = row.boxes[i];
        completed.push(box);
        const next = row.boxes[i + 1];
        if (!next) continue;
        const gap = position(next) - position(box);
        const missing = Math.round(gap / pitch) - 1;
        // Fill only interior broken-line gaps supported by the measured spacing on both sides.
        if (missing > 0 && missing <= 2 && Math.abs(gap / pitch - missing - 1) < 0.2) {
          for (let j = 1; j <= missing; j++) {
            const t = j / (missing + 1);
            completed.push({ x: box.x + (next.x - box.x) * t, y: box.y + (next.y - box.y) * t,
              w: median(row.boxes.map(item => item.w)), h: median(row.boxes.map(item => item.h)), inferred: true });
          }
        }
      }
      return { ...row, boxes: completed };
    }).sort((a, b) => Number(b.vertical) - Number(a.vertical) || a.cross - b.cross);
  }

  function measuredFloor(rectangles, floorName, expectedCount, sampleKind = () => "normal") {
    const rows = measuredRows(rectangles);
    const boxes = rows.flatMap(row => row.boxes);
    // Never choose thresholds, add end bays, or redistribute rows to match a requested total.
    if (!Number.isInteger(expectedCount) || rows.length < 2 || boxes.length !== expectedCount) return null;
    const left = Math.min(...boxes.map(box => box.x));
    const top = Math.min(...boxes.map(box => box.y));
    const width = Math.max(...boxes.map(box => box.x + box.w)) - left;
    const height = Math.max(...boxes.map(box => box.y + box.h)) - top;
    return {
      name: floorName, layoutSource: "photo_lines", aspectRatio: width / height,
      detectedSlotCount: boxes.length, rowCounts: rows.map(row => row.boxes.length),
      outline: [{ x: 2, y: 2 }, { x: 98, y: 2 }, { x: 98, y: 98 }, { x: 2, y: 98 }],
      zones: [], elements: [],
      slots: rows.flatMap((row, rowIndex) => row.boxes.map((box, rowPosition) => ({
        x: 2 + (box.x - left) / width * 96, y: 2 + (box.y - top) / height * 96,
        w: box.w / width * 96, h: box.h / height * 96, rotation: 0,
        kind: sampleKind(box), status: "unknown", rowIndex, rowPosition,
        inferredBoundary: Boolean(box.inferred)
      })))
    };
  }

  function classifyPaint(pixels, width, box) {
    let blue = 0, pink = 0, count = 0;
    for (let y = Math.ceil(box.y + box.h * 0.15); y < box.y + box.h * 0.85; y += 3) {
      for (let x = Math.ceil(box.x + box.w * 0.15); x < box.x + box.w * 0.85; x += 3) {
        const i = (y * width + x) * 4;
        const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
        if (b > r * 1.3 && b > g * 1.05) blue++;
        if (r > g * 1.35 && r > b * 1.08) pink++;
        count++;
      }
    }
    return blue / count > 0.3 ? "disabled" : pink / count > 0.3 ? "pregnant" : "normal";
  }

  async function detect(images, floorName, expectedCount) {
    if (!expectedCount || images.length !== 1) return null;
    const image = new Image();
    image.src = images[0].previewUrl;
    await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const cv = await loadRuntime();
    const rectangles = stableRectangles(cv, canvas);
    return measuredFloor(rectangles, floorName, expectedCount, box => classifyPaint(pixels, canvas.width, box));
  }

  window.ParkViewPhotoPlan = { detect, measuredRows, measuredFloor };
})();
