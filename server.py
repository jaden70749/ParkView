#!/usr/bin/env python3
"""ParkView web server and 30-second edge CCTV analysis worker."""

from __future__ import annotations

import argparse
import hmac
import io
import ipaddress
import json
import math
import os
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

os.environ.setdefault("YOLO_CONFIG_DIR", "/tmp/parkview-ultralytics")
os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp|stimeout;5000000"
)

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps
from ultralytics import YOLO


ROOT = Path(__file__).resolve().parent


def load_environment_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if key:
            os.environ.setdefault(key, value)


load_environment_file(ROOT / ".env")

MODEL_PATH = Path(
    os.environ.get("PARKVIEW_MODEL_PATH", ROOT / "models" / "yolov5su.pt")
).expanduser()
REGIONS_PATH = Path(
    os.environ.get("PARKVIEW_REGIONS_PATH", ROOT / "parking_regions.json")
).expanduser()
DEBUG_DIR = ROOT / "debug"
CAMERA_URL = os.environ.get(
    "PARKVIEW_CAMERA_URL", os.environ.get("PARKVIEW_RTSP_URL", "")
).strip()
CAMERA_NAME = os.environ.get("PARKVIEW_CAMERA_NAME", "주차장 CCTV").strip()
SITE_ID = os.environ.get("PARKVIEW_SITE_ID", "site-1").strip()
CAMERA_SOCKET_TIMEOUT = max(
    1.0, float(os.environ.get("PARKVIEW_CAMERA_SOCKET_TIMEOUT", "3"))
)
FLOOR_ID = os.environ.get("PARKVIEW_FLOOR_ID", "B1").strip()
CAPTURE_INTERVAL = max(5, int(os.environ.get("PARKVIEW_ANALYSIS_INTERVAL", "30")))
INFERENCE_SIZE = int(os.environ.get("PARKVIEW_IMAGE_SIZE", "640"))
MIN_SCORE = float(os.environ.get("PARKVIEW_CONFIDENCE", "0.25"))
DETECTION_CLASSES = {
    value.strip().lower()
    for value in os.environ.get(
        "PARKVIEW_DETECTION_CLASSES",
        os.environ.get("PARKVIEW_VEHICLE_CLASSES", ""),
    ).split(",")
    if value.strip()
}
EMPTY_CONFIRMATIONS = max(1, int(os.environ.get("PARKVIEW_EMPTY_CONFIRMATIONS", "2")))
DEBUG_ENABLED = os.environ.get("PARKVIEW_DEBUG", "false").lower() in {
    "1",
    "true",
    "yes",
    "on",
}
ALLOW_DIAGNOSTIC_UPLOADS = os.environ.get(
    "PARKVIEW_ALLOW_DIAGNOSTIC_UPLOADS", "false"
).lower() in {"1", "true", "yes", "on"}
CALIBRATION_MODE = os.environ.get(
    "PARKVIEW_CALIBRATION_MODE", "false"
).lower() in {"1", "true", "yes", "on"}
ADMIN_TOKEN = os.environ.get("PARKVIEW_ADMIN_TOKEN", "").strip()
ADMIN_TOKEN_CONFIGURED = (
    len(ADMIN_TOKEN) >= 20
    and ADMIN_TOKEN != "CHANGE_THIS_TO_A_LONG_RANDOM_VALUE"
)
FIREBASE_DATABASE_URL = os.environ.get("FIREBASE_DATABASE_URL", "").strip()
FIREBASE_AUTH_TOKEN = os.environ.get("FIREBASE_AUTH_TOKEN", "").strip()
FIREBASE_SLOT_PATH = os.environ.get(
    "PARKVIEW_FIREBASE_PATH", "parkview/demo/B1/slots"
).strip("/")
KAKAO_JAVASCRIPT_KEY = os.environ.get("KAKAO_JAVASCRIPT_KEY", "").strip()
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash").strip()
AI_ALLOW_PRIVATE_NETWORK = os.environ.get(
    "PARKVIEW_AI_ALLOW_PRIVATE_NETWORK", "true"
).lower() in {"1", "true", "yes", "on"}
PUBLIC_RELAY_MODE = os.environ.get("PARKVIEW_PUBLIC_RELAY", "false").lower() in {
    "1", "true", "yes", "on",
}
MAX_IMAGE_BYTES = 12 * 1024 * 1024
MAX_JSON_BYTES = 1024 * 1024
MAX_GEMINI_JSON_BYTES = 48 * 1024 * 1024

_model: YOLO | None = None
_model_lock = threading.RLock()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def allowed_origin_values() -> tuple[str, ...]:
    raw = os.environ.get(
        "PARKVIEW_ALLOWED_ORIGINS",
        os.environ.get("PARKVIEW_ALLOWED_ORIGIN", "https://jaden70749.github.io"),
    )
    values = []
    for item in str(raw).split(","):
        value = item.strip()
        if value:
            values.append(value)
    if not values:
        values = ["https://jaden70749.github.io"]
    return tuple(values)


def resolve_allowed_origin(origin: str) -> str | None:
    if not origin:
        return None
    allowed = allowed_origin_values()
    if origin in allowed:
        return origin
    return None


def public_runtime_config() -> dict[str, Any]:
    return {
        "mapProvider": "kakao" if KAKAO_JAVASCRIPT_KEY else "fallback",
        "kakaoJavaScriptKey": KAKAO_JAVASCRIPT_KEY,
        "kakaoConfigured": bool(KAKAO_JAVASCRIPT_KEY),
        "geminiConfigured": bool(GEMINI_API_KEY),
    }


def client_is_private(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private


def validate_gemini_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Gemini request must be a JSON object")
    contents = payload.get("contents")
    if not isinstance(contents, list) or not contents:
        raise ValueError("Gemini request must contain contents")
    generation_config = payload.get("generationConfig", {})
    if not isinstance(generation_config, dict):
        raise ValueError("generationConfig must be an object")
    return {
        "contents": contents,
        "generationConfig": generation_config,
    }


def request_gemini(payload: Any) -> dict[str, Any]:
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY가 서버에 설정되지 않았습니다")
    request_payload = validate_gemini_payload(payload)
    model = urllib.parse.quote(GEMINI_MODEL, safe="-._")
    api_key = urllib.parse.quote(GEMINI_API_KEY, safe="")
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={api_key}"
    )
    body = json.dumps(request_payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        error_body = error.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(error_body).get("error", {}).get("message")
        except json.JSONDecodeError:
            detail = None
        raise RuntimeError(detail or f"Gemini HTTP {error.code}") from error
    if not isinstance(result, dict):
        raise RuntimeError("Gemini 응답 형식이 올바르지 않습니다")
    return result


def get_model() -> YOLO:
    global _model
    if _model is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"YOLO model not found: {MODEL_PATH}")
        with _model_lock:
            if _model is None:
                _model = YOLO(str(MODEL_PATH))
                print(
                    f"MODEL_LOADED path={MODEL_PATH} classes={_model.names} "
                    f"imgsz={INFERENCE_SIZE} conf={MIN_SCORE}",
                    flush=True,
                )
    return _model


def ensure_debug_directory() -> None:
    if DEBUG_ENABLED:
        (DEBUG_DIR / "slot_crops").mkdir(parents=True, exist_ok=True)


def load_region_config() -> dict[str, Any]:
    payload: dict[str, Any] = {
        "coordinate_system": "normalized_camera_image",
        "slots": [],
    }
    if REGIONS_PATH.exists():
        loaded = json.loads(REGIONS_PATH.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            payload.update(loaded)

    regions = []
    for index, slot in enumerate(payload.get("slots", [])):
        if not isinstance(slot, dict):
            continue
        polygon = slot.get("polygon")
        if not valid_polygon(polygon):
            try:
                x, y = float(slot["x"]), float(slot["y"])
                width, height = float(slot["w"]), float(slot["h"])
            except (KeyError, TypeError, ValueError):
                continue
            polygon = [
                [x, y],
                [x + width, y],
                [x + width, y + height],
                [x, y + height],
            ]
        polygon = [[clamp01(float(x)), clamp01(float(y))] for x, y in polygon]
        regions.append(
            {
                "id": str(slot.get("id", f"slot_{index + 1}")),
                "slot_index": int(slot.get("slot_index", index)),
                "kind": str(slot.get("kind", "normal")),
                "polygon": polygon,
            }
        )

    payload["slots"] = regions
    return payload


def valid_polygon(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) >= 3
        and all(
            isinstance(point, list)
            and len(point) == 2
            and all(isinstance(number, (int, float)) for number in point)
            for point in value
        )
    )


def valid_quad(value: Any) -> bool:
    return isinstance(value, list) and len(value) == 4 and valid_polygon(value)


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def order_camera_quad(points: list[list[float]]) -> list[list[float]]:
    """Return points in top-left, top-right, bottom-right, bottom-left order."""
    if not valid_quad(points):
        raise ValueError("주차장 외곽선은 네 점이어야 합니다")
    source = np.asarray(points, dtype=np.float32)
    sums = source.sum(axis=1)
    differences = np.diff(source, axis=1).reshape(-1)
    ordered = np.asarray(
        [
            source[np.argmin(sums)],
            source[np.argmin(differences)],
            source[np.argmax(sums)],
            source[np.argmax(differences)],
        ],
        dtype=np.float32,
    )
    if len({tuple(point) for point in ordered.tolist()}) != 4:
        raise ValueError("주차장 외곽선의 네 점이 서로 달라야 합니다")
    if abs(cv2.contourArea(ordered)) < 0.002:
        raise ValueError("자동 좌표를 만들기에는 주차장 영역이 너무 작습니다")
    return [[float(x), float(y)] for x, y in ordered]


def plan_slot_corners(slot: dict[str, Any]) -> list[list[float]]:
    try:
        x = float(slot["x"])
        y = float(slot["y"])
        width = float(slot["w"])
        height = float(slot["h"])
        rotation = math.radians(float(slot.get("rotation", 0)))
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("도면 주차칸 좌표 형식이 올바르지 않습니다") from error
    if not all(math.isfinite(value) for value in (x, y, width, height, rotation)):
        raise ValueError("도면 주차칸 좌표에 유효하지 않은 값이 있습니다")
    if width <= 0 or height <= 0:
        raise ValueError("도면 주차칸의 너비와 높이는 0보다 커야 합니다")
    center_x = x + width / 2
    center_y = y + height / 2
    cosine = math.cos(rotation)
    sine = math.sin(rotation)
    corners = []
    for offset_x, offset_y in (
        (-width / 2, -height / 2),
        (width / 2, -height / 2),
        (width / 2, height / 2),
        (-width / 2, height / 2),
    ):
        corners.append(
            [
                center_x + offset_x * cosine - offset_y * sine,
                center_y + offset_x * sine + offset_y * cosine,
            ]
        )
    return corners


def project_plan_slots_to_camera(
    plan_slots: list[dict[str, Any]],
    camera_quad: list[list[float]],
    floor_id: str,
) -> list[dict[str, Any]]:
    if not isinstance(plan_slots, list) or not 1 <= len(plan_slots) <= 240:
        raise ValueError("자동 지정할 도면 주차칸은 1~240개여야 합니다")
    all_corners = [plan_slot_corners(slot) for slot in plan_slots]
    flattened = np.asarray(
        [point for corners in all_corners for point in corners], dtype=np.float32
    )
    minimum_x, minimum_y = flattened.min(axis=0)
    maximum_x, maximum_y = flattened.max(axis=0)
    if maximum_x - minimum_x <= 0 or maximum_y - minimum_y <= 0:
        raise ValueError("도면 주차칸 영역을 계산할 수 없습니다")
    plan_quad = np.float32(
        [
            [minimum_x, minimum_y],
            [maximum_x, minimum_y],
            [maximum_x, maximum_y],
            [minimum_x, maximum_y],
        ]
    )
    matrix = cv2.getPerspectiveTransform(
        plan_quad, np.float32(order_camera_quad(camera_quad))
    )
    projected = []
    safe_floor_id = str(floor_id or "floor")
    for index, (slot, corners) in enumerate(zip(plan_slots, all_corners)):
        transformed = cv2.perspectiveTransform(np.float32([corners]), matrix)[0]
        polygon = [
            [round(clamp01(float(point[0])), 6), round(clamp01(float(point[1])), 6)]
            for point in transformed
        ]
        projected.append(
            {
                "id": f"{safe_floor_id}-{index + 1:03d}",
                "slot_index": index,
                "kind": str(slot.get("kind", "normal")),
                "polygon": polygon,
            }
        )
    return projected


def detect_parking_grid_quad(image_bytes: bytes) -> list[list[float]]:
    """Estimate the miniature parking-board bounds from connected dark tape."""
    encoded = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_GRAYSCALE)
    if image is None or min(image.shape[:2]) < 64:
        raise ValueError("CCTV 화면에서 주차장 영역을 읽지 못했습니다")
    height, width = image.shape[:2]
    scale = min(1.0, 900 / max(width, height))
    if scale < 1:
        image = cv2.resize(
            image,
            (round(width * scale), round(height * scale)),
            interpolation=cv2.INTER_AREA,
        )
    small_height, small_width = image.shape[:2]
    dark_limit = int(np.clip(np.percentile(image, 12), 28, 85))
    mask = cv2.inRange(image, 0, dark_limit)
    mask = cv2.morphologyEx(
        mask, cv2.MORPH_CLOSE, np.ones((3, 3), dtype=np.uint8), iterations=2
    )
    count, _, stats, centroids = cv2.connectedComponentsWithStats(mask, 8)
    points = []
    frame_area = small_width * small_height
    for label in range(1, count):
        x, y, component_width, component_height, area = stats[label]
        center_x, center_y = centroids[label]
        if area < frame_area * 0.00035:
            continue
        if not (small_width * 0.16 <= center_x <= small_width * 0.84):
            continue
        if not (small_height * 0.14 <= center_y <= small_height * 0.96):
            continue
        if max(component_width, component_height) < min(small_width, small_height) * 0.055:
            continue
        points.extend(
            [
                [x, y],
                [x + component_width, y],
                [x + component_width, y + component_height],
                [x, y + component_height],
            ]
        )
    if len(points) < 4:
        raise ValueError("CCTV 화면에서 주차선 외곽을 자동으로 찾지 못했습니다")
    rectangle = cv2.minAreaRect(np.asarray(points, dtype=np.float32))
    box = cv2.boxPoints(rectangle)
    normalized = [[float(x / small_width), float(y / small_height)] for x, y in box]
    return order_camera_quad(normalized)


def outline_from_region_config(config: dict[str, Any]) -> list[list[float]] | None:
    configured_outline = config.get("camera_outline")
    if valid_quad(configured_outline):
        return order_camera_quad(configured_outline)
    region_points = [
        point
        for slot in config.get("slots", [])
        if isinstance(slot, dict) and valid_polygon(slot.get("polygon"))
        for point in slot["polygon"]
    ]
    if len(region_points) < 4:
        return None
    points = np.asarray(region_points, dtype=np.float32)
    sums = points.sum(axis=1)
    differences = np.diff(points, axis=1).reshape(-1)
    outline = [
        points[np.argmin(sums)].tolist(),
        points[np.argmin(differences)].tolist(),
        points[np.argmax(sums)].tolist(),
        points[np.argmax(differences)].tolist(),
    ]
    try:
        return order_camera_quad(outline)
    except ValueError:
        return None


def build_auto_region_config(
    payload: dict[str, Any],
    existing_config: dict[str, Any],
    image_bytes: bytes | None = None,
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("자동 좌표 요청 형식이 올바르지 않습니다")
    plan_slots = payload.get("slots")
    lot_id = str(payload.get("lot_id", "")).strip()
    floor_id = str(payload.get("floor_id", "")).strip()
    if not lot_id or not floor_id:
        raise ValueError("주차장과 층 정보가 필요합니다")
    matching_context = (
        existing_config.get("lot_id") in (None, lot_id)
        and existing_config.get("floor_id") in (None, floor_id)
    )
    existing_outline = outline_from_region_config(existing_config) if matching_context else None
    if existing_outline:
        camera_quad = existing_outline
        source = "existing_outline"
    else:
        if not image_bytes:
            raise ValueError("자동 좌표 지정을 위한 CCTV 화면이 필요합니다")
        camera_quad = detect_parking_grid_quad(image_bytes)
        source = "camera_grid"
    slots = project_plan_slots_to_camera(plan_slots, camera_quad, floor_id)
    return {
        "coordinate_system": "normalized_camera_image",
        "lot_id": lot_id,
        "floor_id": floor_id,
        "auto_generated": True,
        "auto_source": source,
        "camera_outline": order_camera_quad(camera_quad),
        "slots": slots,
    }


def calibration_matrix(config: dict[str, Any]) -> np.ndarray | None:
    if config.get("coordinate_system") != "normalized_plan":
        return None
    calibration = config.get("calibration", {})
    camera_points = calibration.get("camera_points")
    plan_points = calibration.get("plan_points")
    if not valid_quad(camera_points) or not valid_quad(plan_points):
        return None
    return cv2.getPerspectiveTransform(
        np.float32(camera_points), np.float32(plan_points)
    )


def transform_point(
    point: tuple[float, float], matrix: np.ndarray | None
) -> tuple[float, float]:
    if matrix is None:
        return point
    source = np.float32([[[point[0], point[1]]]])
    transformed = cv2.perspectiveTransform(source, matrix)[0][0]
    return float(transformed[0]), float(transformed[1])


def point_in_polygon(
    point: tuple[float, float], polygon: list[list[float]]
) -> bool:
    contour = np.asarray(polygon, dtype=np.float32)
    return cv2.pointPolygonTest(contour, point, False) >= 0


def match_detections_to_regions(
    detections: list[dict[str, Any]], config: dict[str, Any]
) -> tuple[list[dict[str, Any]], bool, str]:
    regions = config["slots"]
    coordinate_system = config.get(
        "coordinate_system", "normalized_camera_image"
    )
    matrix = calibration_matrix(config)
    if coordinate_system == "normalized_plan" and matrix is None:
        return [], False, "missing_homography_calibration"
    if not regions:
        return [], False, "camera_regions_not_registered"

    candidates = []
    for detection_index, detection in enumerate(detections):
        x, y, width, height = detection["bbox_normalized"]
        camera_center = (x + width / 2, y + height / 2)
        match_point = transform_point(camera_center, matrix)
        detection["camera_center"] = [
            round(camera_center[0], 6),
            round(camera_center[1], 6),
        ]
        detection["match_point"] = [
            round(match_point[0], 6),
            round(match_point[1], 6),
        ]
        for region_index, region in enumerate(regions):
            if point_in_polygon(match_point, region["polygon"]):
                candidates.append(
                    (detection["score"], detection_index, region_index)
                )

    candidates.sort(reverse=True)
    used_detections: set[int] = set()
    used_regions: set[int] = set()
    matched: dict[int, int] = {}
    for _, detection_index, region_index in candidates:
        if detection_index in used_detections or region_index in used_regions:
            continue
        used_detections.add(detection_index)
        used_regions.add(region_index)
        matched[region_index] = detection_index

    results = []
    for region_index, region in enumerate(regions):
        detection_index = matched.get(region_index)
        results.append(
            {
                **region,
                "status": (
                    "occupied" if detection_index is not None else "empty"
                ),
                "matched_detection": detection_index,
                "strategy": (
                    "homography_center"
                    if matrix is not None
                    else "camera_polygon_center"
                ),
            }
        )
    return (
        results,
        True,
        "homography" if matrix is not None else "camera_roi",
    )


def detection_class_enabled(source_class: str) -> bool:
    return not DETECTION_CLASSES or source_class.lower() in DETECTION_CLASSES


def matched_detection_payload(
    detections: list[dict[str, Any]], slot_results: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    matched_indexes = sorted(
        {
            slot["matched_detection"]
            for slot in slot_results
            if isinstance(slot.get("matched_detection"), int)
            and 0 <= slot["matched_detection"] < len(detections)
        }
    )
    index_map = {source_index: index for index, source_index in enumerate(matched_indexes)}
    matched_detections = [detections[index] for index in matched_indexes]
    remapped_slots = [
        {
            **slot,
            "matched_detection": index_map.get(slot.get("matched_detection")),
        }
        for slot in slot_results
    ]
    return matched_detections, remapped_slots


def detect_objects(image_bytes: bytes, debug: bool = False) -> dict[str, Any]:
    image = ImageOps.exif_transpose(
        Image.open(io.BytesIO(image_bytes))
    ).convert("RGB")
    width, height = image.size
    if width < 64 or height < 64:
        raise ValueError(f"Camera image is too small: {width}x{height}")
    print(
        f"IMAGE_RECEIVED success=true bytes={len(image_bytes)} "
        f"width={width} height={height}",
        flush=True,
    )
    started = time.perf_counter()
    with _model_lock:
        prediction = get_model().predict(
            source=image,
            conf=MIN_SCORE,
            iou=0.45,
            imgsz=INFERENCE_SIZE,
            rect=False,
            max_det=100,
            device="cpu",
            verbose=False,
        )[0]

    detections = []
    for box, score_tensor, class_tensor in zip(
        prediction.boxes.xyxy,
        prediction.boxes.conf,
        prediction.boxes.cls,
    ):
        source_class = str(
            prediction.names[int(class_tensor)]
        ).lower()
        score = float(score_tensor)
        if score < MIN_SCORE or not detection_class_enabled(source_class):
            continue
        x1, y1, x2, y2 = (float(value) for value in box.tolist())
        box_width = max(0.0, x2 - x1)
        box_height = max(0.0, y2 - y1)
        if box_width == 0 or box_height == 0:
            continue
        detections.append(
            {
                "bbox": [x1, y1, box_width, box_height],
                "bbox_normalized": [
                    x1 / width,
                    y1 / height,
                    box_width / width,
                    box_height / height,
                ],
                "source_class": source_class,
                "score": round(score, 6),
            }
        )

    detections.sort(
        key=lambda item: item["score"], reverse=True
    )
    config = load_region_config()
    slot_results, mapping_ready, mapping_strategy = (
        match_detections_to_regions(detections, config)
    )
    matched_detections, slot_results = matched_detection_payload(
        detections, slot_results
    )
    print(
        f"YOLO_RAW_COUNT {len(detections)} MATCHED_PARKING_OBJECTS {len(matched_detections)}",
        flush=True,
    )
    for slot in slot_results:
        print(
            f"SLOT_MATCH slot={slot['slot_index'] + 1} "
            f"status={slot['status']} "
            f"detection={slot['matched_detection']} "
            f"strategy={slot['strategy']}",
            flush=True,
        )

    payload = {
        "ready": True,
        "analyzed_at": utc_now(),
        "site_id": SITE_ID,
        "lot_id": config.get("lot_id"),
        "calibration_floor_id": config.get("floor_id"),
        "floor_id": config.get("floor_id") or FLOOR_ID,
        "model": MODEL_PATH.name,
        "strategy": "yolo_object_occupancy",
        "settings": {
            "imgsz": INFERENCE_SIZE,
            "confidence": MIN_SCORE,
            "classes": sorted(DETECTION_CLASSES) or ["all"],
        },
        "image": {
            "width": width,
            "height": height,
            "bytes": len(image_bytes),
        },
        "count": len(matched_detections),
        "detections": matched_detections,
        "mapping_ready": mapping_ready,
        "mapping_strategy": mapping_strategy,
        "slot_results": slot_results,
        "elapsed_ms": round(
            (time.perf_counter() - started) * 1000, 1
        ),
    }
    if debug and DEBUG_ENABLED:
        save_debug_artifacts(image, payload)
    return payload


def save_debug_artifacts(
    image: Image.Image, payload: dict[str, Any]
) -> None:
    ensure_debug_directory()
    image.save(DEBUG_DIR / "latest_capture.jpg", quality=94)
    annotated = image.copy()
    draw = ImageDraw.Draw(annotated)
    for detection in payload["detections"]:
        x, y, width, height = detection["bbox"]
        draw.rectangle(
            (x, y, x + width, y + height),
            outline=(248, 196, 0),
            width=4,
        )
        draw.text(
            (x + 4, max(2, y - 16)),
            detection["source_class"],
            fill=(248, 196, 0),
        )
    annotated.save(
        DEBUG_DIR / "detection_result.jpg", quality=94
    )

    regions_image = image.copy()
    region_draw = ImageDraw.Draw(regions_image)
    crop_dir = DEBUG_DIR / "slot_crops"
    for old_crop in crop_dir.glob("slot_*.jpg"):
        old_crop.unlink()
    for result in payload["slot_results"]:
        points = [
            (round(x * image.width), round(y * image.height))
            for x, y in result["polygon"]
        ]
        color = (
            (220, 60, 60)
            if result["status"] == "occupied"
            else (40, 190, 70)
        )
        region_draw.polygon(points, outline=color, width=4)
        if payload["mapping_strategy"] == "camera_roi":
            xs = [point[0] for point in points]
            ys = [point[1] for point in points]
            image.crop(
                (min(xs), min(ys), max(xs), max(ys))
            ).save(
                crop_dir
                / f"slot_{result['slot_index'] + 1}.jpg",
                quality=94,
            )
    regions_image.save(
        DEBUG_DIR / "parking_regions.jpg", quality=94
    )
    (DEBUG_DIR / "slot_results.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def camera_network_endpoint(camera_url: str) -> tuple[str, int] | None:
    parsed = urllib.parse.urlsplit(camera_url)
    if parsed.scheme.lower() not in {"rtsp", "rtsps"}:
        return None
    if not parsed.hostname:
        raise ValueError("RTSP 카메라 주소에 호스트가 없습니다")
    try:
        port = parsed.port or 554
    except ValueError as error:
        raise ValueError("RTSP 카메라 포트가 올바르지 않습니다") from error
    return parsed.hostname, port


def check_camera_endpoint(camera_url: str) -> None:
    endpoint = camera_network_endpoint(camera_url)
    if endpoint is None:
        return
    try:
        with socket.create_connection(
            endpoint, timeout=CAMERA_SOCKET_TIMEOUT
        ):
            return
    except OSError as error:
        raise ConnectionError(
            "RTSP 카메라 네트워크에 연결할 수 없습니다"
        ) from error


def describe_camera_frame(image_bytes: bytes) -> dict[str, Any]:
    try:
        with Image.open(io.BytesIO(image_bytes)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
    except Exception as error:
        raise ValueError("카메라 프레임이 올바른 이미지가 아닙니다") from error
    grayscale = np.asarray(image.convert("L"))
    focus_score = float(
        cv2.Laplacian(grayscale, cv2.CV_64F).var()
    )
    return {
        "width": image.width,
        "height": image.height,
        "bytes": len(image_bytes),
        "brightness": round(float(grayscale.mean()), 1),
        "focus_score": round(focus_score, 1),
    }


def save_latest_camera_frame(image_bytes: bytes) -> Path:
    ensure_debug_directory()
    path = DEBUG_DIR / "latest_capture.jpg"
    path.write_bytes(image_bytes)
    return path


def capture_camera_frame(camera_url: str) -> bytes:
    source: str | int = (
        int(camera_url) if camera_url.isdigit() else camera_url
    )
    if isinstance(source, str):
        check_camera_endpoint(source)
    backend = (
        cv2.CAP_FFMPEG
        if isinstance(source, str)
        else cv2.CAP_ANY
    )
    capture = cv2.VideoCapture()
    try:
        if hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC"):
            capture.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
        if hasattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC"):
            capture.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if not capture.open(source, backend):
            raise ConnectionError(
                "RTSP 카메라 스트림을 열 수 없습니다"
            )
        frame = None
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline:
            ok, candidate = capture.read()
            if (
                ok
                and candidate is not None
                and candidate.size
            ):
                frame = candidate
                break
        if frame is None:
            raise ConnectionError(
                "RTSP 카메라에서 프레임을 받지 못했습니다"
            )
        ok, encoded = cv2.imencode(
            ".jpg",
            frame,
            [cv2.IMWRITE_JPEG_QUALITY, 94],
        )
        if not ok:
            raise RuntimeError(
                "카메라 프레임 JPEG 변환에 실패했습니다"
            )
        return encoded.tobytes()
    finally:
        capture.release()


def publish_firebase(
    slot_results: list[dict[str, Any]]
) -> dict[str, Any]:
    if not FIREBASE_DATABASE_URL:
        return {
            "status": "skipped",
            "reason": "not_configured",
        }
    if not slot_results:
        return {
            "status": "skipped",
            "reason": "camera_regions_not_registered",
        }
    payload = {
        "updated_at": utc_now(),
        "slots": {
            result["id"]: {
                "slot_index": result["slot_index"],
                "status": result["status"],
                "kind": result["kind"],
            }
            for result in slot_results
        },
    }
    url = (
        f"{FIREBASE_DATABASE_URL.rstrip('/')}/"
        f"{FIREBASE_SLOT_PATH}.json"
    )
    if FIREBASE_AUTH_TOKEN:
        url += "?auth=" + urllib.parse.quote(
            FIREBASE_AUTH_TOKEN
        )
    body = json.dumps(
        payload, ensure_ascii=False
    ).encode("utf-8")
    print(
        f"FIREBASE_PAYLOAD {body.decode('utf-8')}",
        flush=True,
    )
    try:
        request = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="PUT",
        )
        with urllib.request.urlopen(
            request, timeout=8
        ) as response:
            return {
                "status": "success",
                "http_status": response.status,
            }
    except Exception as error:
        return {"status": "failed", "error": str(error)}


class AnalysisWorker:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._analysis_lock = threading.Lock()
        self._last_result: dict[str, Any] | None = None
        self._last_error: str | None = None
        self._camera_connected = False
        self._last_camera_error: str | None = None
        self._last_analysis_error: str | None = None
        self._last_camera_attempt_at: str | None = None
        self._last_camera_success_at: str | None = None
        self._last_frame: dict[str, Any] | None = None
        self._consecutive_camera_failures = 0
        self._stable_status: dict[str, str] = {}
        self._empty_streak: dict[str, int] = {}
        self._camera_url = CAMERA_URL
        self._camera_name = CAMERA_NAME
        self._floor_id = FLOOR_ID

    def start(self) -> None:
        with self._lock:
            if not self._camera_url or self._thread is not None:
                return
            self._thread = threading.Thread(
                target=self._run,
                name="parkview-analysis",
                daemon=True,
            )
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=8)

    def _run(self) -> None:
        while not self._stop.is_set():
            started = time.monotonic()
            try:
                self.run_once()
            except Exception as error:
                print(
                    f"ANALYSIS_RETRY_SCHEDULED after={CAPTURE_INTERVAL}s "
                    f"type={type(error).__name__}",
                    flush=True,
                )
            remaining = max(
                0,
                CAPTURE_INTERVAL
                - (time.monotonic() - started),
            )
            self._stop.wait(remaining)

    def _capture(self, *, always_save: bool = False) -> tuple[bytes, dict[str, Any]]:
        attempted_at = utc_now()
        with self._lock:
            self._last_camera_attempt_at = attempted_at
            camera_url = self._camera_url
        if not camera_url:
            raise RuntimeError("RTSP 카메라 주소가 설정되지 않았습니다")
        try:
            image_bytes = capture_camera_frame(camera_url)
            frame = describe_camera_frame(image_bytes)
            if DEBUG_ENABLED or always_save:
                save_latest_camera_frame(image_bytes)
            succeeded_at = utc_now()
            with self._lock:
                self._camera_connected = True
                self._last_camera_error = None
                self._last_camera_success_at = succeeded_at
                self._last_frame = frame
                self._consecutive_camera_failures = 0
            return image_bytes, frame
        except Exception as error:
            with self._lock:
                self._camera_connected = False
                self._last_camera_error = str(error)
                self._consecutive_camera_failures += 1
            raise

    def test_camera(self) -> dict[str, Any]:
        if not self._camera_url:
            raise RuntimeError("RTSP 카메라 주소가 설정되지 않았습니다")
        if not self._analysis_lock.acquire(blocking=False):
            raise RuntimeError("이미 카메라 분석 중입니다")
        started = time.perf_counter()
        try:
            _image_bytes, frame = self._capture(always_save=True)
            elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
            print(
                f"CAMERA_TEST_OK resolution={frame['width']}x{frame['height']} "
                f"bytes={frame['bytes']} elapsed_ms={elapsed_ms}",
                flush=True,
            )
            return {
                "connected": True,
                "camera": self._camera_name,
                "floor_id": self._floor_id,
                "captured_at": self._last_camera_success_at,
                "image": frame,
                "elapsed_ms": elapsed_ms,
                "debug_file": "debug/latest_capture.jpg",
            }
        except Exception as error:
            print(
                f"CAMERA_TEST_ERROR type={type(error).__name__} error={error}",
                flush=True,
            )
            raise
        finally:
            self._analysis_lock.release()

    def configure_camera(self, payload: dict[str, Any]) -> dict[str, Any]:
        camera_url = str(payload.get("url", "")).strip()
        if len(camera_url) > 2048:
            raise ValueError("RTSP 주소가 너무 깁니다")
        parsed = urllib.parse.urlsplit(camera_url)
        if parsed.scheme.lower() not in {"rtsp", "rtsps"}:
            raise ValueError("rtsp:// 또는 rtsps:// 주소를 입력해 주세요")
        camera_network_endpoint(camera_url)
        if not self._analysis_lock.acquire(blocking=False):
            raise RuntimeError("이미 카메라 분석 중입니다")
        started = time.perf_counter()
        try:
            image_bytes = capture_camera_frame(camera_url)
            frame = describe_camera_frame(image_bytes)
            save_latest_camera_frame(image_bytes)
            connected_at = utc_now()
            with self._lock:
                self._camera_url = camera_url
                self._camera_name = str(payload.get("name", "")).strip()[:80] or "주차장 CCTV"
                self._floor_id = str(payload.get("floor_id", "")).strip()[:24] or "B1"
                self._camera_connected = True
                self._last_camera_error = None
                self._last_camera_attempt_at = connected_at
                self._last_camera_success_at = connected_at
                self._last_frame = frame
                self._consecutive_camera_failures = 0
            result = {
                "connected": True,
                "camera": self._camera_name,
                "floor_id": self._floor_id,
                "captured_at": connected_at,
                "image": frame,
                "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
            }
        finally:
            self._analysis_lock.release()
        self.start()
        return result

    def preview_frame(self) -> bytes:
        if not self._analysis_lock.acquire(blocking=False):
            raise RuntimeError("이미 카메라 분석 중입니다")
        try:
            image_bytes, _frame = self._capture(always_save=True)
            return image_bytes
        finally:
            self._analysis_lock.release()

    def run_once(self) -> dict[str, Any]:
        if not self._camera_url:
            raise RuntimeError(
                "RTSP 카메라 주소가 설정되지 않았습니다"
            )
        if not self._analysis_lock.acquire(blocking=False):
            raise RuntimeError("이미 분석 중입니다")
        try:
            image_bytes, _frame = self._capture()
            payload = detect_objects(
                image_bytes, debug=True
            )
            payload["floor_id"] = self._floor_id
            payload["slot_results"] = self._stabilize(
                payload["slot_results"]
            )
            payload["firebase"] = publish_firebase(
                payload["slot_results"]
            )
            with self._lock:
                self._last_result = payload
                self._last_error = None
                self._last_analysis_error = None
                self._camera_connected = True
            print(
                f"ANALYSIS_COMPLETE objects={payload['count']} "
                f"slots={len(payload['slot_results'])} "
                f"elapsed_ms={payload['elapsed_ms']}",
                flush=True,
            )
            return payload
        except Exception as error:
            with self._lock:
                self._last_error = str(error)
                if self._camera_connected:
                    self._last_analysis_error = str(error)
            print(
                f"ANALYSIS_ERROR type={type(error).__name__} "
                f"error={error}",
                flush=True,
            )
            raise
        finally:
            self._analysis_lock.release()

    def _stabilize(
        self, slot_results: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        stabilized = []
        for result in slot_results:
            slot_id = result["id"]
            candidate = result["status"]
            if candidate == "occupied":
                self._stable_status[slot_id] = "occupied"
                self._empty_streak[slot_id] = 0
            else:
                self._empty_streak[slot_id] = (
                    self._empty_streak.get(slot_id, 0) + 1
                )
                if (
                    self._empty_streak[slot_id]
                    >= EMPTY_CONFIRMATIONS
                ):
                    self._stable_status[slot_id] = "empty"
            stable = self._stable_status.get(slot_id, "unknown")
            stabilized.append(
                {**result, "status": stable}
            )
        return stabilized

    def health(self) -> dict[str, Any]:
        with self._lock:
            return {
                "ready": MODEL_PATH.exists(),
                "model": MODEL_PATH.name,
                "strategy": "edge_rtsp_object_occupancy",
                "analysis_interval_seconds": CAPTURE_INTERVAL,
                "region_count": len(
                    load_region_config()["slots"]
                ),
                "firebase_configured": bool(
                    FIREBASE_DATABASE_URL
                ),
                "debug": DEBUG_ENABLED,
                "camera": {
                    "name": self._camera_name,
                    "configured": bool(self._camera_url),
                    "connected": self._camera_connected,
                    "last_attempt_at": self._last_camera_attempt_at,
                    "last_success_at": self._last_camera_success_at,
                    "last_error": self._last_camera_error,
                    "consecutive_failures": self._consecutive_camera_failures,
                    "frame": self._last_frame,
                },
                "analysis_error": self._last_analysis_error,
                "site_id": SITE_ID,
                "floor_id": self._floor_id,
                "last_analysis_at": (
                    self._last_result.get("analyzed_at")
                    if self._last_result
                    else None
                ),
                "last_error": self._last_error,
            }

    def result(self) -> dict[str, Any]:
        with self._lock:
            return self._last_result or {
                "ready": False,
                "analyzed_at": None,
                "slot_results": [],
            }


worker = AnalysisWorker()


def save_regions(
    payload: dict[str, Any]
) -> dict[str, Any]:
    if (
        not isinstance(payload, dict)
        or not isinstance(payload.get("slots"), list)
    ):
        raise ValueError(
            "JSON body must contain a slots array"
        )
    temporary = REGIONS_PATH.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(
            payload, ensure_ascii=False, indent=2
        ),
        encoding="utf-8",
    )
    temporary.replace(REGIONS_PATH)
    config = load_region_config()
    return {
        "saved": True,
        "count": len(config["slots"]),
    }


def save_auto_regions(payload: dict[str, Any]) -> dict[str, Any]:
    existing = load_region_config()
    matching_context = (
        existing.get("lot_id") in (None, payload.get("lot_id"))
        and existing.get("floor_id") in (None, payload.get("floor_id"))
    )
    needs_frame = not (matching_context and outline_from_region_config(existing))
    config = build_auto_region_config(
        payload,
        existing,
        worker.preview_frame() if needs_frame else None,
    )
    save_regions(config)
    return load_region_config()


class ParkViewHandler(SimpleHTTPRequestHandler):
    def __init__(
        self, *args: Any, **kwargs: Any
    ) -> None:
        super().__init__(
            *args, directory=str(ROOT), **kwargs
        )

    def end_headers(self) -> None:
        origin = self.headers.get("Origin", "")
        matched_origin = resolve_allowed_origin(origin)
        if matched_origin:
            self.send_header("Access-Control-Allow-Origin", matched_origin)
            self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header(
            "Access-Control-Allow-Methods",
            "GET, POST, OPTIONS",
        )
        self.send_header(
            "Access-Control-Allow-Headers",
            "Authorization, Content-Type, bypass-tunnel-reminder",
        )
        self.end_headers()

    def send_head(self):
        # A public relay serves API routes only. Never publish the project
        # directory (including .env, debug captures, and repository files).
        if PUBLIC_RELAY_MODE:
            self.send_error(HTTPStatus.NOT_FOUND)
            return None
        return super().send_head()

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/api/public-config":
            self.send_json(
                HTTPStatus.OK, public_runtime_config()
            )
            return
        if path == "/api/health":
            self.send_json(
                HTTPStatus.OK, worker.health()
            )
            return
        if path == "/api/result":
            self.send_json(
                HTTPStatus.OK, worker.result()
            )
            return
        if path == "/api/regions":
            if not self.require_admin():
                return
            self.send_json(
                HTTPStatus.OK, load_region_config()
            )
            return
        if path == "/api/calibration-frame":
            if not self.require_admin():
                return
            try:
                if not CALIBRATION_MODE:
                    raise PermissionError("캘리브레이션 모드가 꺼져 있습니다")
                self.send_bytes(
                    HTTPStatus.OK,
                    worker.preview_frame(),
                    "image/jpeg",
                )
            except Exception as error:
                self.send_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": str(error), "type": type(error).__name__},
                )
            return
        if path == "/api/camera/preview":
            if not self.require_camera_preview():
                return
            try:
                self.send_bytes(
                    HTTPStatus.OK,
                    worker.preview_frame(),
                    "image/jpeg",
                )
            except Exception as error:
                self.send_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": str(error), "type": type(error).__name__},
                )
            return
        super().do_GET()

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        try:
            if path == "/api/gemini/generate":
                if not self.require_ai_access():
                    return
                payload = json.loads(
                    self.read_body(
                        MAX_GEMINI_JSON_BYTES
                    ).decode("utf-8")
                )
                self.send_json(
                    HTTPStatus.OK,
                    request_gemini(payload),
                )
                return
            if path == "/api/analyze":
                if not self.require_admin():
                    return
                self.send_json(
                    HTTPStatus.OK, worker.run_once()
                )
                return
            if path == "/api/camera/test":
                if not self.require_admin():
                    return
                self.send_json(
                    HTTPStatus.OK, worker.test_camera()
                )
                return
            if path == "/api/camera/configure":
                if not self.require_admin():
                    return
                payload = json.loads(
                    self.read_body(MAX_JSON_BYTES).decode("utf-8")
                )
                if not isinstance(payload, dict):
                    raise ValueError("카메라 설정 형식이 올바르지 않습니다")
                self.send_json(
                    HTTPStatus.OK,
                    worker.configure_camera(payload),
                )
                return
            if (
                path == "/api/detect"
                and ALLOW_DIAGNOSTIC_UPLOADS
            ):
                if not self.require_admin():
                    return
                self.send_json(
                    HTTPStatus.OK,
                    detect_objects(
                        self.read_body(MAX_IMAGE_BYTES),
                        debug=True,
                    ),
                )
                return
            if path == "/api/regions":
                if not self.require_admin():
                    return
                payload = json.loads(
                    self.read_body(
                        MAX_JSON_BYTES
                    ).decode("utf-8")
                )
                self.send_json(
                    HTTPStatus.OK,
                    save_regions(payload),
                )
                return
            if path == "/api/regions/auto":
                if not self.require_admin():
                    return
                payload = json.loads(
                    self.read_body(MAX_JSON_BYTES).decode("utf-8")
                )
                self.send_json(
                    HTTPStatus.OK,
                    save_auto_regions(payload),
                )
                return
            self.send_json(
                HTTPStatus.NOT_FOUND,
                {"error": "Not found"},
            )
        except Exception as error:
            print(
                f"REQUEST_ERROR path={path} "
                f"type={type(error).__name__} "
                f"error={error}",
                flush=True,
            )
            self.send_json(
                HTTPStatus.BAD_REQUEST,
                {
                    "error": str(error),
                    "type": type(error).__name__,
                },
            )

    def require_ai_access(self) -> bool:
        client_address = str(self.client_address[0])
        if (
            AI_ALLOW_PRIVATE_NETWORK
            and not PUBLIC_RELAY_MODE
            and client_is_private(client_address)
        ):
            return True
        return self.require_admin()

    def require_admin(self) -> bool:
        authorization = self.headers.get("Authorization", "")
        provided = authorization.removeprefix("Bearer ").strip()
        authorized = ADMIN_TOKEN_CONFIGURED and hmac.compare_digest(provided, ADMIN_TOKEN)
        if authorized:
            return True
        self.send_json(
            HTTPStatus.UNAUTHORIZED,
            {"error": "관리자 인증이 필요합니다"},
        )
        return False

    def require_camera_preview(self) -> bool:
        authorization = self.headers.get("Authorization", "")
        provided = authorization.removeprefix("Bearer ").strip()
        authorized = ADMIN_TOKEN_CONFIGURED and hmac.compare_digest(provided, ADMIN_TOKEN)
        local_request = (
            AI_ALLOW_PRIVATE_NETWORK
            and not PUBLIC_RELAY_MODE
            and client_is_private(str(self.client_address[0]))
        )
        if authorized or local_request:
            return True
        self.send_json(
            HTTPStatus.UNAUTHORIZED,
            {"error": "로컬 CCTV 서버 접근 권한이 필요합니다"},
        )
        return False

    def read_body(self, maximum: int) -> bytes:
        length = int(
            self.headers.get("Content-Length", "0")
        )
        if length <= 0 or length > maximum:
            raise ValueError(
                "Request body must be between 1 byte "
                f"and {maximum} bytes"
            )
        return self.rfile.read(length)

    def send_json(
        self, status: HTTPStatus, payload: dict[str, Any]
    ) -> None:
        body = json.dumps(
            payload, ensure_ascii=False
        ).encode("utf-8")
        self.send_response(status)
        self.send_header(
            "Content-Type",
            "application/json; charset=utf-8",
        )
        self.send_header(
            "Content-Length", str(len(body))
        )
        self.end_headers()
        self.wfile.write(body)

    def send_bytes(
        self, status: HTTPStatus, body: bytes, content_type: str
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--host", default="0.0.0.0"
    )
    parser.add_argument(
        "--port", type=int, default=5180
    )
    args = parser.parse_args()

    ensure_debug_directory()
    worker.start()
    server = ThreadingHTTPServer(
        (args.host, args.port), ParkViewHandler
    )
    print(
        f"ParkView server: "
        f"http://127.0.0.1:{args.port}/?v=97",
        flush=True,
    )
    print(
        "SERVICES "
        f"kakao={'configured' if KAKAO_JAVASCRIPT_KEY else 'not_configured'} "
        f"gemini={'configured' if GEMINI_API_KEY else 'not_configured'} "
        f"firebase={'configured' if FIREBASE_DATABASE_URL else 'not_configured'}",
        flush=True,
    )
    print(
        f"EDGE camera="
        f"{'configured' if CAMERA_URL else 'not_configured'} "
        f"interval={CAPTURE_INTERVAL}s "
        f"model={MODEL_PATH.name} "
        f"debug={DEBUG_ENABLED}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        worker.stop()


if __name__ == "__main__":
    main()
