"""Train the parking-space segmenter from reviewed image/polygon samples."""
import argparse
import json
import os
import shutil
from pathlib import Path

os.environ.setdefault("YOLO_CONFIG_DIR", "/tmp/parkview-ultralytics")
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=ROOT / "datasets/parking-spaces")
    parser.add_argument("--base", type=Path, default=ROOT / "models/yolo11n-seg.pt")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()
    data = args.data.resolve()
    # Split by capture group in the editor; never put augmented copies in validation.
    groups = {}
    for split in ("train", "val"):
        images = sorted((data / "images" / split).glob("*.jpg"))
        if not images:
            raise SystemExit(f"Missing reviewed {split} images in {data}")
        for image in images:
            if not (data / "labels" / split / f"{image.stem}.txt").is_file():
                raise SystemExit(f"Missing polygon labels: {image.name}")
        groups[split] = {json.loads((data / "metadata" / f"{i.stem}.json").read_text())["group"] for i in images}
    if groups["train"] & groups["val"]:
        raise SystemExit("Training and validation must use different capture groups.")
    if not args.base.is_file():
        raise SystemExit(f"Missing segmentation base model: {args.base}")
    import yaml
    config_path = data / "data.yaml"
    config_path.write_text(yaml.safe_dump({"path": str(data), "train": "images/train", "val": "images/val", "names": {0: "parking_space"}}))
    model = YOLO(str(args.base))
    model.train(data=str(config_path), epochs=args.epochs, imgsz=960, batch=2, workers=0,
                device=args.device, project=str(ROOT / "runs/parking-spaces"), name="segment",
                task="segment", seed=42, patience=20)
    best = Path(model.trainer.best)
    if not best.is_file():
        raise SystemExit("Training did not produce best.pt")
    candidate = YOLO(str(best))
    if candidate.task != "segment" or "parking_space" not in candidate.names.values():
        raise SystemExit("Invalid parking-space model")
    candidate.val(data=str(config_path), device=args.device, imgsz=960)
    target = ROOT / "models/parking-spaces-seg.pt"
    temporary = target.with_suffix(".tmp")
    shutil.copyfile(best, temporary)
    temporary.replace(target)
    print(f"Parking-space model installed: {target}")


if __name__ == "__main__":
    main()
