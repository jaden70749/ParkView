"""Fixed-camera, reviewed parking polygons and empty-frame occupancy."""
import hashlib
import io
import re
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

REFERENCES = Path(__file__).parent / ".occupancy-references"


def decode(raw):
    image = Image.open(io.BytesIO(raw))
    if image.width * image.height > 24_000_000:
        raise ValueError("이미지는 2400만 화소 이하로 선택해 주세요")
    return np.array(ImageOps.exif_transpose(image).convert("RGB"))


def detect(raw, lot_id, floor_id, roi=None):
    if not lot_id or not floor_id:
        raise ValueError("주차장과 층이 필요합니다")
    rgb = decode(raw)
    scale = min(1, 1600 / max(rgb.shape[:2]))
    frame = cv2.resize(rgb, None, fx=scale, fy=scale)
    gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
    h, w = gray.shape
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                   cv2.THRESH_BINARY_INV, 41, 12)
    contours, hierarchy = cv2.findContours(binary, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    for i, contour in enumerate(contours):
        if hierarchy[0][i][3] < 0:
            continue
        area = cv2.contourArea(contour)
        if not h*w*0.00012 < area < h*w*0.025:
            continue
        poly = cv2.approxPolyDP(contour, cv2.arcLength(contour, True)*0.025, True)
        if len(poly) != 4 or not cv2.isContourConvex(poly):
            continue
        _, sides, _ = cv2.minAreaRect(poly)
        if min(sides) < 6 or max(sides)/min(sides) > 10:
            continue
        if area/(sides[0]*sides[1]) < 0.65:
            continue
        points = poly.reshape(-1, 2).astype(float)
        center = points.mean(axis=0)
        points = points[np.argsort(np.arctan2(points[:, 1]-center[1], points[:, 0]-center[0]))]
        normalized = points / [w, h]
        if roi is not None:
            boundary = np.array(roi, dtype=np.float32)
            if boundary.shape != (4, 2) or not np.isfinite(boundary).all():
                raise ValueError("감지 구역의 모서리 4개를 선택해 주세요")
            if any(cv2.pointPolygonTest(boundary, tuple(p), False) < 0 for p in normalized):
                continue
        candidates.append(normalized)
    candidates.sort(key=lambda p: float(p[:, 1].mean()))
    rows = []
    for p in candidates:
        if not rows or abs(p[:, 1].mean()-rows[-1][0][:, 1].mean()) > min(np.ptp(p[:, 1]), np.ptp(rows[-1][0][:, 1]))*0.5:
            rows.append([])
        rows[-1].append(p)
    candidates = [p for row in rows for p in sorted(row, key=lambda p: float(p[:, 0].mean()))]
    slots = [dict(id=f"{floor_id}-{i+1:03d}", slot_index=i, kind="normal",
                  polygon=np.round(p, 6).tolist()) for i, p in enumerate(candidates)]
    return dict(lot_id=lot_id, floor_id=floor_id, slots=slots, source="opencv_closed_lines",
                review_required=True, coordinate_system="normalized_camera_image")


def save_reference(raw):
    rgb = decode(raw)
    output = io.BytesIO()
    Image.fromarray(rgb).save(output, format="PNG")
    data = output.getvalue()
    key = hashlib.sha256(data).hexdigest()
    REFERENCES.mkdir(exist_ok=True)
    path = REFERENCES / f"{key}.png"
    if not path.exists():
        path.write_bytes(data)
    return key


def analyze(raw, config):
    rgb = decode(raw)
    slots = config.get("slots", [])
    results = [dict(id=s["id"], slot_index=s["slot_index"], kind=s.get("kind", "normal"),
                    polygon=s["polygon"],
                    status="unknown", occupied=None, matched_detection=None,
                    strategy="empty_reference_difference") for s in slots]
    key = str(config.get("reference_id", ""))
    if not re.fullmatch(r"[a-f0-9]{64}", key) or not (REFERENCES / f"{key}.png").is_file():
        return results, False, "빈 주차장 기준 사진을 저장해 주세요"
    reference = decode((REFERENCES / f"{key}.png").read_bytes())
    if reference.shape != rgb.shape:
        return results, False, "영상 크기가 변경되었습니다. 기준 사진을 다시 등록해 주세요"
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    base = cv2.cvtColor(reference, cv2.COLOR_RGB2GRAY)
    shift, response = cv2.phaseCorrelate(base.astype(np.float32), gray.astype(np.float32))
    if response > 0.15 and np.hypot(*shift) > 3:
        return results, False, "카메라 위치가 바뀌었습니다. 좌표와 기준 사진을 다시 확인해 주세요"
    h, w = gray.shape
    lighting_offset = np.median(gray.astype(float)-base.astype(float))
    for slot, result in zip(slots, results):
        polygon = np.round(np.array(slot["polygon"])*[w-1, h-1]).astype(np.int32)
        x, y, bw, bh = cv2.boundingRect(polygon)
        mask = np.zeros((bh, bw), np.uint8)
        cv2.fillPoly(mask, [polygon-[x, y]], 255)
        margin = max(1, int(min(bw, bh)*0.07))
        mask = cv2.erode(mask, np.ones((margin*2+1, margin*2+1), np.uint8))
        inside = mask > 0
        count = int(inside.sum())
        if count < 30:
            continue
        delta = gray[y:y+bh, x:x+bw].astype(float)-base[y:y+bh, x:x+bw].astype(float)
        delta -= lighting_offset
        changed = ((np.abs(delta) > 18) & inside).astype(np.uint8)
        n, _, stats, _ = cv2.connectedComponentsWithStats(changed, 8)
        area = int(stats[1:, cv2.CC_STAT_AREA].max()) if n > 1 else 0
        ratio = area/count
        occupied = ratio >= 0.04
        result.update(status="occupied" if occupied else "empty", occupied=int(occupied),
                      change_ratio=round(ratio, 4))
    return results, bool(slots), ""
