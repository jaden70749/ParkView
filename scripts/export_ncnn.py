#!/usr/bin/env python3
"""Export the configured YOLO model to NCNN for Raspberry Pi CPU inference."""

import os
from pathlib import Path

from ultralytics import YOLO


root = Path(__file__).resolve().parents[1]
model_path = Path(
    os.environ.get("PARKVIEW_MODEL_PATH", root / "models" / "yolov5su.pt")
).expanduser()
image_size = int(os.environ.get("PARKVIEW_IMAGE_SIZE", "640"))

if not model_path.exists():
    raise SystemExit(f"Model not found: {model_path}")

exported = YOLO(str(model_path)).export(format="ncnn", imgsz=image_size)
print(f"NCNN model exported: {exported}")

