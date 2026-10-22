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


def deduplicate_nested_polygons(polygons):
    ranked = sorted(
        polygons,
        key=lambda polygon: cv2.contourArea(polygon.astype(np.float32)),
        reverse=True,
    )
    kept = []
    for polygon in ranked:
        area = cv2.contourArea(polygon.astype(np.float32))
        duplicate = False
        for existing in kept:
            existing_area = cv2.contourArea(existing.astype(np.float32))
            smaller = min(area, existing_area)
            larger = max(area, existing_area)
            if smaller <= 0 or smaller / larger < 0.45:
                continue
            intersection, _ = cv2.intersectConvexConvex(
                polygon.astype(np.float32), existing.astype(np.float32)
            )
            if intersection / smaller >= 0.72:
                duplicate = True
                break
        if not duplicate:
            kept.append(polygon)
    return kept


def remove_group_outlines(polygons):
    areas = [cv2.contourArea(p.astype(np.float32)) for p in polygons]
    kept = []
    for index, polygon in enumerate(polygons):
        enclosed = 0
        contour = polygon.astype(np.float32)
        for other_index, other in enumerate(polygons):
            if index == other_index or areas[other_index] >= areas[index] * 0.6:
                continue
            center = tuple(other.astype(np.float32).mean(axis=0))
            if cv2.pointPolygonTest(contour, center, False) >= 0:
                enclosed += 1
        if enclosed < 2:
            kept.append(polygon)
    return kept


def order_quad(points):
    points = np.asarray(points, dtype=np.float32)
    sums = points.sum(axis=1)
    differences = np.diff(points, axis=1).reshape(-1)
    return np.float32([
        points[np.argmin(sums)],
        points[np.argmin(differences)],
        points[np.argmax(sums)],
        points[np.argmax(differences)],
    ])


def rectify_polygons(polygons, roi):
    matrix = cv2.getPerspectiveTransform(
        order_quad(roi),
        np.float32([[0, 0], [1, 0], [1, 1], [0, 1]]),
    )
    return [cv2.perspectiveTransform(p.astype(np.float32)[None], matrix)[0]
            for p in polygons]


def deduplicate_close_polygons(polygons, projected):
    """Remove duplicate contours that describe the same bay after rectification."""
    ranked = sorted(
        zip(polygons, projected),
        key=lambda pair: cv2.contourArea(pair[1].astype(np.float32)),
        reverse=True,
    )
    kept = []
    for polygon, guide in ranked:
        center = guide.mean(axis=0)
        width = float(np.ptp(guide[:, 0]))
        height = float(np.ptp(guide[:, 1]))
        duplicate = False
        for _, existing in kept:
            existing_center = existing.mean(axis=0)
            if (abs(float(center[0] - existing_center[0])) < min(width, float(np.ptp(existing[:, 0]))) * 0.35
                    and abs(float(center[1] - existing_center[1])) < min(height, float(np.ptp(existing[:, 1]))) * 0.35):
                duplicate = True
                break
        if not duplicate:
            kept.append((polygon, guide))
    return [item[0] for item in kept], [item[1] for item in kept]


def group_polygon_rows(polygons, projected=None):
    projected = projected or polygons
    pairs = sorted(zip(polygons, projected), key=lambda pair: float(pair[1][:, 1].mean()))
    rows = []
    for polygon, guide in pairs:
        center_y = float(guide[:, 1].mean())
        height = float(np.ptp(guide[:, 1]))
        if not rows:
            rows.append([])
        else:
            row_y = float(np.mean([item[1][:, 1].mean() for item in rows[-1]]))
            row_height = float(np.median([np.ptp(item[1][:, 1]) for item in rows[-1]]))
            if abs(center_y - row_y) > min(height, row_height) * 0.5:
                rows.append([])
        rows[-1].append((polygon, guide))
    return rows


def complete_row_gaps(row, projected=None, x_bounds=None):
    """Recover bays hidden by glare or damaged paint using a stable row pitch."""
    projected = projected or row
    pairs = sorted(zip(row, projected), key=lambda pair: float(pair[1][:, 0].mean()))
    ordered = [pair[0] for pair in pairs]
    guides = [pair[1] for pair in pairs]
    if len(ordered) < 6:
        return ordered, 0
    centers = np.array([polygon.mean(axis=0) for polygon in guides])
    gaps = np.diff(centers[:, 0])
    positive = gaps[gaps > 1e-5]
    if len(positive) < 4:
        return ordered, 0
    percentile = 45 if x_bounds is not None else 60
    regular = positive[positive <= np.percentile(positive, percentile)]
    pitch = float(np.median(regular)) if len(regular) >= 3 else float(np.median(positive))
    if pitch <= 1e-5:
        return ordered, 0
    completed = []
    inferred = 0
    for index, polygon in enumerate(ordered[:-1]):
        completed.append(polygon)
        gap = float(gaps[index])
        ratio = gap / pitch
        if ratio < 2.05 or ratio > 5.25:
            continue
        rounding = 0.5 if x_bounds is not None else 0.1
        missing = min(4, max(0, int(np.floor(ratio + rounding)) - 1))
        following = ordered[index + 1]
        for step in range(1, missing + 1):
            weight = step / (missing + 1)
            completed.append(polygon * (1 - weight) + following * weight)
            inferred += 1
    completed.append(ordered[-1])

    if x_bounds is not None:
        widths = [float(np.ptp(polygon[:, 0])) for polygon in guides]
        margin = max(float(np.median(widths)) * 0.65, pitch * 0.35)
        left, right = x_bounds
        while float(guides[0][:, 0].mean()) - pitch >= left + margin:
            step = ordered[0] - ordered[1]
            ordered.insert(0, ordered[0] + step)
            guides.insert(0, guides[0] + (guides[0] - guides[1]))
            completed.insert(0, ordered[0])
            inferred += 1
        while float(guides[-1][:, 0].mean()) + pitch <= right - margin:
            step = ordered[-1] - ordered[-2]
            ordered.append(ordered[-1] + step)
            guides.append(guides[-1] + (guides[-1] - guides[-2]))
            completed.append(ordered[-1])
            inferred += 1
    return completed, inferred


def rectified_line_candidates(frame):
    """Keep borders seen at multiple exposures, including bays touching the selected edge."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_RGB2HSV)
    h, w = frame.shape[:2]
    groups = []
    for threshold in range(140, 231, 5):
        mask = cv2.inRange(hsv, (0, 0, threshold), (180, 100, 255))
        cv2.rectangle(mask, (0, 0), (w-1, h-1), 255, 3)
        contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = cv2.contourArea(contour)
            if not h*w*0.0004 < area < h*w*0.16:
                continue
            repaired = False
            polygon = cv2.approxPolyDP(contour, cv2.arcLength(contour, True)*0.025, True)
            if len(polygon) != 4 or not cv2.isContourConvex(polygon):
                hull = cv2.convexHull(contour)
                _, hull_sides, _ = cv2.minAreaRect(hull)
                box_area = hull_sides[0]*hull_sides[1]
                if box_area <= 0 or area/box_area < 0.68 or cv2.contourArea(hull)/box_area < 0.9:
                    continue
                # Wheelchair paint can connect to the white border; retain its rectangular hull.
                polygon = cv2.approxPolyDP(hull, cv2.arcLength(hull, True)*0.025, True)
                if len(polygon) != 4:
                    continue
                repaired = True
            _, sides, _ = cv2.minAreaRect(polygon)
            if min(sides) < 10 or max(sides)/min(sides) > 4:
                continue
            points = order_quad(polygon.reshape(-1, 2))
            center = points.mean(axis=0)
            size = np.ptp(points, axis=0)
            match = next((group for group in groups
                          if group["repaired"] == repaired
                          and np.all(np.abs(group["center"]-center) < size*0.25)), None)
            if match is None:
                groups.append({"center": center, "polygons": [points], "thresholds": {threshold}, "repaired": repaired})
            else:
                match["polygons"].append(points)
                match["thresholds"].add(threshold)
    candidates = []
    for group in sorted(groups, key=lambda group: group["repaired"]):
        if len(group["thresholds"]) < 2:
            continue
        polygon = np.median(group["polygons"], axis=0).astype(np.float32)
        if group["repaired"] and any(
                cv2.intersectConvexConvex(polygon, existing)[0]
                > min(cv2.contourArea(polygon), cv2.contourArea(existing))*0.4
                for existing in candidates):
            continue
        candidates.append(polygon)
    candidates = deduplicate_nested_polygons(candidates)
    candidates = remove_group_outlines(candidates)
    if not candidates:
        return []
    typical_area = float(np.median([cv2.contourArea(p) for p in candidates]))
    return [p for p in candidates if typical_area*0.4 < cv2.contourArea(p) < typical_area*1.8]


def complete_rectified_rows(polygons):
    rows = []
    for polygon in sorted(polygons, key=lambda p: tuple(p.mean(axis=0))):
        size = np.ptp(polygon, axis=0)
        axis = 1 if size[0] > size[1] else 0
        cross_axis = 1-axis
        center = polygon.mean(axis=0)
        row = next((row for row in rows if row["axis"] == axis
                    and abs(row["cross"]-center[cross_axis]) < size[cross_axis]*0.35), None)
        if row is None:
            row = {"axis": axis, "cross": center[cross_axis], "polygons": []}
            rows.append(row)
        row["polygons"].append(polygon)
        row["cross"] = float(np.median([p[:, cross_axis].mean() for p in row["polygons"]]))

    completed = []
    counts = []
    inferred = 0
    for row in sorted(rows, key=lambda row: (-row["axis"], row["cross"])):
        axis = row["axis"]
        ordered = sorted(row["polygons"], key=lambda p: float(p[:, axis].mean()))
        if len(ordered) < 2:
            continue
        positions = [float(p[:, axis].mean()) for p in ordered]
        gaps = np.diff(positions)
        pitch = float(np.median(gaps))
        measured = []
        for index, polygon in enumerate(ordered):
            measured.append((polygon, False))
            if index == len(ordered)-1 or len(ordered) < 4 or pitch <= 0:
                continue
            ratio = float(gaps[index]/pitch)
            missing = round(ratio)-1
            # Only bridge interior paint breaks. Never extend a row across the ROI or an aisle.
            if 1 <= missing <= 2 and abs(ratio-missing-1) < 0.25:
                for step in range(1, missing+1):
                    weight = step/(missing+1)
                    measured.append((polygon*(1-weight)+ordered[index+1]*weight, True))
                    inferred += 1
        counts.append(len(measured))
        completed.extend(measured)
    return completed, inferred, counts


def detect_rectified_lines(frame, boundary, lot_id, floor_id):
    h, w = frame.shape[:2]
    destination = np.float32([[0, 0], [1199, 0], [1199, 1199], [0, 1199]])
    matrix = cv2.getPerspectiveTransform((order_quad(boundary)*[w, h]).astype(np.float32), destination)
    rectified = cv2.warpPerspective(frame, matrix, (1200, 1200))
    completed, inferred, counts = complete_rectified_rows(rectified_line_candidates(rectified))
    inverse = np.linalg.inv(matrix)
    slots = []
    for index, (polygon, restored) in enumerate(completed):
        original = cv2.perspectiveTransform(polygon.astype(np.float32)[None], inverse)[0]/[w, h]
        slots.append(dict(id=f"{floor_id}-{index+1:03d}", slot_index=index, kind="normal",
                          polygon=np.round(np.clip(original, 0, 1), 6).tolist(), inferred=restored))
    return dict(lot_id=lot_id, floor_id=floor_id, slots=slots,
                source="opencv_rectified_closed_lines", inferred_count=inferred, row_counts=counts,
                review_required=True, coordinate_system="normalized_camera_image")


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
    contours, _ = cv2.findContours(binary, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    boundary = None
    if roi is not None:
        boundary = np.array(roi, dtype=np.float32)
        if boundary.shape != (4, 2) or not np.isfinite(boundary).all():
            raise ValueError("감지 구역의 모서리 4개를 선택해 주세요")
        if not cv2.isContourConvex(order_quad(boundary)):
            raise ValueError("감지 구역의 모서리를 주차장 둘레를 따라 선택해 주세요")
        if np.any(boundary < 0) or np.any(boundary > 1):
            raise ValueError("감지 구역을 영상 안에서 선택해 주세요")
        return detect_rectified_lines(frame, boundary, lot_id, floor_id)
    candidates = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if not h*w*0.00012 < area < h*w*0.025:
            continue
        poly = cv2.approxPolyDP(contour, cv2.arcLength(contour, True)*0.025, True)
        if len(poly) != 4 or not cv2.isContourConvex(poly):
            continue
        _, sides, _ = cv2.minAreaRect(poly)
        if min(sides) < 6 or max(sides)/min(sides) > 3:
            continue
        if area/(sides[0]*sides[1]) < 0.65:
            continue
        points = poly.reshape(-1, 2).astype(float)
        center = points.mean(axis=0)
        points = points[np.argsort(np.arctan2(points[:, 1]-center[1], points[:, 0]-center[0]))]
        normalized = points / [w, h]
        if boundary is not None:
            if any(cv2.pointPolygonTest(boundary, tuple(p), False) < 0 for p in normalized):
                continue
        candidates.append(normalized)
    candidates = deduplicate_nested_polygons(candidates)
    candidates = remove_group_outlines(candidates)
    projected = rectify_polygons(candidates, boundary) if boundary is not None else candidates
    candidates, projected = deduplicate_close_polygons(candidates, projected)
    rows = group_polygon_rows(candidates, projected)
    completed_rows = []
    inferred_count = 0
    for row in rows:
        polygons = [item[0] for item in row]
        guides = [item[1] for item in row]
        completed, inferred = complete_row_gaps(
            polygons, guides, (0.0, 1.0) if boundary is not None else None
        )
        completed_rows.append(completed)
        inferred_count += inferred
    candidates = [p for row in completed_rows for p in row]
    slots = [dict(id=f"{floor_id}-{i+1:03d}", slot_index=i, kind="normal",
                  polygon=np.round(p, 6).tolist()) for i, p in enumerate(candidates)]
    return dict(lot_id=lot_id, floor_id=floor_id, slots=slots, source="opencv_closed_lines",
                inferred_count=inferred_count,
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
    h, w = gray.shape
    polygons = [np.round(np.array(s["polygon"])*[w-1, h-1]).astype(np.int32) for s in slots]
    shift, response = cv2.phaseCorrelate(base.astype(np.float32), gray.astype(np.float32))
    if response > 0.15 and np.hypot(*shift) > 3:
        return results, False, "카메라 위치가 바뀌었습니다. 좌표와 기준 사진을 다시 확인해 주세요"
    warp = np.float32([[1, 0, shift[0]], [0, 1, shift[1]]]) if response > 0.15 else None
    # Register fixed tape and nearby floor, excluding cars and the rest of the room.
    if polygons and response <= 0.15:
        registration_mask = np.zeros((h, w), np.uint8)
        cv2.fillConvexPoly(registration_mask, cv2.convexHull(np.concatenate(polygons)), 255)
        registration_mask = cv2.dilate(registration_mask, np.ones((21, 21), np.uint8))
        for polygon in polygons:
            interior = np.zeros((h, w), np.uint8)
            cv2.fillPoly(interior, [polygon], 255)
            interior = cv2.erode(interior, np.ones((5, 5), np.uint8))
            registration_mask[interior > 0] = 0
        try:
            score, candidate = cv2.findTransformECC(
                base, gray, np.eye(2, 3, dtype=np.float32), cv2.MOTION_AFFINE,
                (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 80, 1e-5), registration_mask, 5)
            if score >= 0.9:
                points = np.concatenate(polygons).astype(np.float32)
                moved = cv2.transform(points[None], candidate)[0]
                if np.max(np.linalg.norm(moved-points, axis=1)) > 3:
                    return results, False, "카메라 위치가 바뀌었습니다. 좌표와 기준 사진을 다시 확인해 주세요"
                warp = candidate
        except cv2.error:
            pass
    # Move only the comparison image; saved polygons and reference stay unchanged.
    if warp is not None:
        base = cv2.warpAffine(base, warp,
                             (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    current_edges = cv2.Canny(gray, 60, 140)
    reference_edges = cv2.Canny(base, 60, 140)
    # Estimate illumination only from surrounding floor, never from parked objects.
    excluded = np.zeros((h, w), np.uint8)
    for polygon in polygons:
        cv2.fillPoly(excluded, [polygon], 255)
    excluded = cv2.dilate(excluded, np.ones((5, 5), np.uint8))
    difference = (cv2.GaussianBlur(gray, (3, 3), 0).astype(np.float32)
                  - cv2.GaussianBlur(base, (3, 3), 0).astype(np.float32))
    floor = (excluded == 0) & (base > 40) & (base < 235) & (gray > 20) & (gray < 245)
    lighting_offset = float(np.median(difference[floor])) if floor.any() else 0.0
    for polygon, result in zip(polygons, results):
        x, y, bw, bh = cv2.boundingRect(polygon)
        mask = np.zeros((bh, bw), np.uint8)
        cv2.fillPoly(mask, [polygon-[x, y]], 255)
        margin = max(1, int(min(bw, bh)*0.07))
        mask = cv2.erode(mask, np.ones((margin*2+1, margin*2+1), np.uint8))
        inside = mask > 0
        count = int(inside.sum())
        if count < 30:
            continue
        padding = max(8, int(max(bw, bh)*0.3))
        x0, y0 = max(0, x-padding), max(0, y-padding)
        x1, y1 = min(w, x+bw+padding), min(h, y+bh+padding)
        surrounding = difference[y0:y1, x0:x1][floor[y0:y1, x0:x1]]
        offset = lighting_offset
        if surrounding.size >= 32:
            low, high = np.percentile(surrounding, [25, 75])
            if high-low <= 12:
                offset = float(np.median(surrounding))
        delta = difference[y:y+bh, x:x+bw] - offset
        changed = ((np.abs(delta) > 25) & inside).astype(np.uint8)
        changed = cv2.morphologyEx(changed, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        n, _, stats, _ = cv2.connectedComponentsWithStats(changed, 8)
        area = int(stats[1:, cv2.CC_STAT_AREA].max()) if n > 1 else 0
        ratio = area/count
        new_edges = (current_edges[y:y+bh, x:x+bw] > 0) & (reference_edges[y:y+bh, x:x+bw] == 0)
        edge_ratio = float((new_edges & inside).sum()) / count
        occupied = ((0.08 <= ratio < 0.18 and edge_ratio >= 0.0105)
                    or (ratio >= 0.18 and edge_ratio >= 0.02))
        result.update(status="occupied" if occupied else "empty", occupied=int(occupied),
                      change_ratio=round(ratio, 4), edge_ratio=round(edge_ratio, 4),
                      lighting_offset=round(offset, 2))
    return results, bool(slots), ""
