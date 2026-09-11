"""Parking-space masks are independent of the vehicle detection model."""
import io
import base64
import hashlib
import json
import os
import threading
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps
from ultralytics import YOLO

MODEL_PATH = Path(os.environ.get("PARKVIEW_SLOT_MODEL_PATH", Path(__file__).parent / "models/parking-spaces-seg.pt")).expanduser()
SLOT_CLASSES = {s.strip().lower() for s in os.environ.get("PARKVIEW_SLOT_CLASSES", "parking_space,parking_slot,parking-space,parking-slot").split(",") if s.strip()}
LOCK = threading.RLock()
_model = None
_model_stamp = None


def get_model():
    global _model, _model_stamp
    if not MODEL_PATH.is_file():
        raise FileNotFoundError("주차면 전용 세그멘테이션 모델이 없습니다. 서버의 PARKVIEW_SLOT_MODEL_PATH에 학습한 모델을 지정해 주세요.")
    stamp = (MODEL_PATH.stat().st_mtime_ns, MODEL_PATH.stat().st_size)
    if _model is None or stamp != _model_stamp:
        model = YOLO(str(MODEL_PATH))
        if model.task != "segment":
            raise ValueError("주차면 모델은 segmentation 모델이어야 합니다")
        if not SLOT_CLASSES.intersection(str(v).lower() for v in model.names.values()):
            raise ValueError("모델에 주차면 클래스가 없습니다. PARKVIEW_SLOT_CLASSES를 확인해 주세요.")
        _model = model
        _model_stamp = stamp
    return _model


def mask_polygon(points):
    points = np.asarray(points, dtype=np.float32)
    if points.ndim != 2 or points.shape[1] != 2 or len(points) < 3 or not np.isfinite(points).all():
        return None
    points = np.clip(points, 0, 1)
    perimeter = cv2.arcLength(points, True)
    # Simplify the actual mask without replacing perspective with an axis-aligned box.
    polygon = cv2.approxPolyDP(points, max(perimeter * 0.008, 0.0001), True).reshape(-1, 2)
    if len(polygon) < 3 or len(polygon) > 512 or abs(cv2.contourArea(polygon)) < 0.00002:
        return None
    return [[round(float(x), 6), round(float(y), 6)] for x, y in polygon]


def slots_from_prediction(prediction, floor_id, confidence=0.35):
    if prediction.masks is None:
        return []
    candidates = []
    for polygon, cls, score in zip(prediction.masks.xyn, prediction.boxes.cls.tolist(), prediction.boxes.conf.tolist()):
        if str(prediction.names[int(cls)]).lower() not in SLOT_CLASSES or score < confidence:
            continue
        points = mask_polygon(polygon)
        if points:
            candidates.append({"polygon": points, "confidence": round(float(score), 6), "kind": "normal"})
    candidates.sort(key=lambda s: (round(float(np.mean(s["polygon"], axis=0)[1]), 2), float(np.mean(s["polygon"], axis=0)[0])))
    for index, slot in enumerate(candidates):
        slot.update(id=f"{floor_id}-{index + 1:03d}", slot_index=index)
    return candidates


def detect(image_bytes, lot_id, floor_id):
    if not str(lot_id).strip() or not str(floor_id).strip():
        raise ValueError("주차장 ID와 층 ID가 필요합니다")
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    if image.width * image.height > 24_000_000:
        raise ValueError("이미지는 2400만 화소 이하로 선택해 주세요")
    floor_id = str(floor_id).strip().upper()
    with LOCK:
        prediction = get_model().predict(image, conf=0.35, iou=0.45, imgsz=1280, retina_masks=True, device="cpu", verbose=False)[0]
        slots = slots_from_prediction(prediction, floor_id)
    return {"lot_id": str(lot_id).strip(), "floor_id": floor_id,
            "coordinate_system": "normalized_camera_image", "slots": slots,
            "occupancy_strategy": "polygon_overlap", "occupancy_threshold": 0.3,
            "source": "yolo_segmentation", "review_required": True,
            "image": {"width": image.width, "height": image.height}}


def save_training_sample(payload, directory):
    import region_store
    region_store.validate_slots(payload.get("slots"))
    group = str(payload.get("group", "")).strip()
    split = payload.get("split", "train")
    if split not in {"train", "val"} or not group:
        raise ValueError("학습/검증 구분과 촬영 그룹을 입력해 주세요")
    raw = base64.b64decode(payload.get("image_base64", ""), validate=True)
    if len(raw) > 12 * 1024 * 1024:
        raise ValueError("이미지가 너무 큽니다")
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
    if image.width * image.height > 24_000_000:
        raise ValueError("이미지는 2400만 화소 이하로 선택해 주세요")
    name = hashlib.sha256(image.tobytes()).hexdigest()
    directory = Path(directory)
    with LOCK:
        for metadata in (directory / "metadata").glob("*.json"):
            existing = json.loads(metadata.read_text())
            if (existing["group"] == group or metadata.stem == name) and existing["split"] != split:
                raise ValueError("같은 촬영 그룹 또는 이미지는 학습과 검증에 동시에 사용할 수 없습니다")
        for part in (f"images/{split}", f"labels/{split}", "metadata"):
            (directory / part).mkdir(parents=True, exist_ok=True)
        image.save(directory / f"images/{split}/{name}.jpg", quality=95)
        lines = ["0 " + " ".join(str(v) for p in slot["polygon"] for v in p) for slot in payload["slots"]]
        (directory / f"labels/{split}/{name}.txt").write_text("\n".join(lines) + "\n")
        (directory / f"metadata/{name}.json").write_text(json.dumps({"group": group, "split": split, "lot_id": payload.get("lot_id"), "floor_id": payload.get("floor_id")}, ensure_ascii=False))
    return {"saved": True, "count": len(lines), "sample": name, "split": split}
