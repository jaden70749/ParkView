"""Replay a saved CCTV frame without connecting to a camera or modifying calibration."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import parking_vision
import region_store


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("--config", type=Path, default=ROOT / "parking_regions.json")
    expected = parser.add_mutually_exclusive_group()
    expected.add_argument("--expect-occupied", help="Comma-separated one-based bay numbers; empty string means none")
    expected.add_argument("--expect-unmapped", action="store_true")
    args = parser.parse_args()
    config = region_store.load(args.config)
    results, ready, message = parking_vision.analyze(args.image.read_bytes(), config)
    occupied = sorted(slot["slot_index"]+1 for slot in results if slot["occupied"] == 1)
    print(json.dumps({"ready": ready, "message": message, "count": len(results),
                      "occupied": occupied, "unknown": sum(slot["occupied"] is None for slot in results)},
                     ensure_ascii=False))
    if args.expect_unmapped:
        return 0 if results and not ready and all(slot["occupied"] is None for slot in results) else 1
    if args.expect_occupied is not None:
        wanted = sorted(int(number.strip()) for number in args.expect_occupied.split(",") if number.strip())
        return 0 if results and ready and all(slot["occupied"] is not None for slot in results) and occupied == wanted else 1
    return 0 if results else 1


if __name__ == "__main__":
    sys.exit(main())
