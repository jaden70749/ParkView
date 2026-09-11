"""Scoped region persistence with optimistic concurrency and legacy migration."""
import copy
import hashlib
import json
import math
import threading
from pathlib import Path

LOCK = threading.RLock()


class RegionConflict(ValueError):
    pass


def context(lot_id, floor_id):
    return str(lot_id or "").strip(), str(floor_id or "").strip().upper()


def revision(config):
    value = {k: v for k, v in config.items() if k not in {"revision", "configurations", "expected_revision"}}
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def read_document(path):
    if not Path(path).exists():
        return {}
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("저장된 주차면 데이터 형식이 올바르지 않습니다")
    return value


def configurations(document):
    entries = copy.deepcopy(document.get("configurations", []))
    active = {k: v for k, v in document.items() if k != "configurations"}
    key = context(active.get("lot_id"), active.get("floor_id"))
    if active.get("slots") is not None and not any(context(c.get("lot_id"), c.get("floor_id")) == key for c in entries):
        entries.append(active)
    return entries


def load(path, lot_id=None, floor_id=None):
    with LOCK:
        document = read_document(path)
        if lot_id is None and floor_id is None:
            value = {k: v for k, v in document.items() if k != "configurations"}
        else:
            key = context(lot_id, floor_id)
            value = next((c for c in configurations(document) if context(c.get("lot_id"), c.get("floor_id")) == key), None)
            if value is None:
                # Ownerless legacy records stay preserved, but never block a new context.
                value = {"lot_id": key[0], "floor_id": key[1], "slots": []}
        value.setdefault("coordinate_system", "normalized_camera_image")
        value.setdefault("slots", [])
        if "lot_id" in value:
            value["lot_id"], value["floor_id"] = context(value.get("lot_id"), value.get("floor_id"))
        value["revision"] = revision(value)
        return value


def validate_slots(slots):
    if not isinstance(slots, list) or len(slots) > 2000:
        raise ValueError("주차면 목록이 올바르지 않습니다")
    ids, indices = set(), set()
    for slot in slots:
        if not isinstance(slot, dict):
            raise ValueError("주차면 형식이 올바르지 않습니다")
        polygon = slot.get("polygon")
        if not isinstance(polygon, list) or not 3 <= len(polygon) <= 512:
            raise ValueError("주차면은 3개 이상의 꼭짓점이 필요합니다")
        for p in polygon:
            if not isinstance(p, list) or len(p) != 2 or not all(isinstance(v, (int, float)) and math.isfinite(v) and 0 <= v <= 1 for v in p):
                raise ValueError("주차면 좌표는 0~1 범위여야 합니다")
        area = abs(sum(polygon[i][0] * polygon[(i+1) % len(polygon)][1] - polygon[(i+1) % len(polygon)][0] * polygon[i][1] for i in range(len(polygon)))) / 2
        if area < 1e-8:
            raise ValueError("넓이가 없는 주차면은 저장할 수 없습니다")
        index, name = slot.get("slot_index"), slot.get("id")
        if type(index) is not int or index < 0 or not isinstance(name, str) or not name or index in indices or name in ids:
            raise ValueError("주차면 번호가 중복되었거나 올바르지 않습니다")
        ids.add(name)
        indices.add(index)


def save(path, payload):
    if not isinstance(payload, dict):
        raise ValueError("주차면 설정 형식이 올바르지 않습니다")
    lot_id, floor_id = context(payload.get("lot_id"), payload.get("floor_id"))
    if not lot_id or not floor_id:
        raise ValueError("주차장 ID와 층 ID가 필요합니다")
    validate_slots(payload.get("slots"))
    with LOCK:
        existing = load(path, lot_id, floor_id)
        expected = payload.get("expected_revision")
        if expected is not None and expected != existing["revision"]:
            raise RegionConflict("이 주차장·층의 좌표가 다른 화면에서 변경되었습니다. 다시 불러온 뒤 저장해 주세요.")
        entries = configurations(read_document(path))
        value = {k: copy.deepcopy(v) for k, v in payload.items() if k not in {"revision", "expected_revision", "configurations"}}
        value.update(lot_id=lot_id, floor_id=floor_id)
        entries = [c for c in entries if context(c.get("lot_id"), c.get("floor_id")) != (lot_id, floor_id)]
        entries.append(value)
        document = {**value, "configurations": entries}
        temporary = Path(path).with_suffix(".tmp")
        temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)
        return load(path, lot_id, floor_id)
