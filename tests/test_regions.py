import json
import base64
import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy as np
from PIL import Image
import region_store
import parking_segmentation
import server


def config(lot="lot-1", floor="1F", x=0.1):
    return {"lot_id": lot, "floor_id": floor, "coordinate_system": "normalized_camera_image",
            "slots": [{"id": "slot-1", "slot_index": 0, "kind": "normal",
                       "polygon": [[x, 0.1], [0.5, 0.1], [0.5, 0.5], [x, 0.5]]}]}


class RegionStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "regions.json"

    def test_floor_case_and_whitespace_are_same_context(self):
        first = region_store.save(self.path, config(floor=" 1f "))
        update = config(x=0.2)
        update["expected_revision"] = first["revision"]
        region_store.save(self.path, update)
        self.assertEqual(region_store.load(self.path, " lot-1 ", "1f")["slots"][0]["polygon"][0], [0.2, 0.1])

    def test_different_lots_and_floors_are_preserved(self):
        region_store.save(self.path, config())
        region_store.save(self.path, config(lot="lot-2"))
        region_store.save(self.path, config(floor="2F"))
        for lot, floor in [("lot-1", "1F"), ("lot-2", "1F"), ("lot-1", "2F")]:
            self.assertEqual(len(region_store.load(self.path, lot, floor)["slots"]), 1)
        self.assertEqual(region_store.load(self.path, "new", "1F")["slots"], [])

    def test_ownerless_legacy_data_does_not_block_or_get_deleted(self):
        legacy = config()
        legacy.pop("lot_id")
        self.path.write_text(json.dumps(legacy))
        region_store.save(self.path, config())
        entries = region_store.configurations(region_store.read_document(self.path))
        self.assertTrue(any(not c.get("lot_id") and c["slots"] for c in entries))

    def test_stale_revision_conflicts_without_modifying_file(self):
        original = region_store.save(self.path, config())
        region_store.save(self.path, config(x=0.2))
        before = self.path.read_bytes()
        stale = config(x=0.3)
        stale["expected_revision"] = original["revision"]
        with self.assertRaises(region_store.RegionConflict):
            region_store.save(self.path, stale)
        self.assertEqual(self.path.read_bytes(), before)

    def test_empty_context_and_removing_last_slot_can_be_saved(self):
        initial = region_store.load(self.path, "lot-1", "1F")
        value = config()
        value["expected_revision"] = initial["revision"]
        saved = region_store.save(self.path, value)
        value.update(slots=[], expected_revision=saved["revision"])
        self.assertEqual(region_store.save(self.path, value)["slots"], [])

    def test_invalid_polygon_and_duplicate_number_are_rejected(self):
        value = config()
        value["slots"].append(value["slots"][0].copy())
        with self.assertRaises(ValueError):
            region_store.save(self.path, value)
        value = config()
        value["slots"][0]["polygon"][0][0] = float("nan")
        with self.assertRaises(ValueError):
            region_store.save(self.path, value)


class SegmentationTests(unittest.TestCase):
    def test_sample_exports_polygons_and_prevents_validation_leakage(self):
        output = io.BytesIO()
        Image.new("RGB", (32, 24), "white").save(output, format="PNG")
        sample = dict(config(), image_base64=base64.b64encode(output.getvalue()).decode(), group="camera-a-day-1", split="train")
        with tempfile.TemporaryDirectory() as directory:
            saved = parking_segmentation.save_training_sample(sample, directory)
            label = Path(directory) / "labels/train" / (saved["sample"] + ".txt")
            self.assertEqual(label.read_text().split(), ["0", "0.1", "0.1", "0.5", "0.1", "0.5", "0.5", "0.1", "0.5"])
            sample.update(split="val", group="different-name")
            with self.assertRaises(ValueError):
                parking_segmentation.save_training_sample(sample, directory)

    def test_trapezoid_mask_preserves_perspective_and_filters_vehicle_class(self):
        trapezoid = [[0.2, 0.1], [0.4, 0.1], [0.5, 0.5], [0.1, 0.5]]
        result = SimpleNamespace(masks=SimpleNamespace(xyn=[trapezoid, trapezoid]),
                                 boxes=SimpleNamespace(cls=np.array([0, 1]), conf=np.array([0.9, 0.99])),
                                 names={0: "parking_space", 1: "car"})
        slots = parking_segmentation.slots_from_prediction(result, "1F")
        self.assertEqual(len(slots), 1)
        self.assertEqual(slots[0]["polygon"], trapezoid)
        self.assertEqual(slots[0]["id"], "1F-001")

    def test_missing_slot_model_does_not_load_vehicle_or_download(self):
        with mock.patch.object(parking_segmentation, "MODEL_PATH", Path("/nonexistent/parking-seg.pt")), mock.patch.object(parking_segmentation, "YOLO") as yolo:
            with self.assertRaises(FileNotFoundError):
                parking_segmentation.get_model()
            yolo.assert_not_called()

    def test_overlap_matches_without_detection_center_inside(self):
        value = config()
        value["occupancy_strategy"] = "polygon_overlap"
        detection = {"bbox_normalized": [0.4, 0.1, 0.25, 0.4], "score": 0.9}
        slots, ready, _ = server.match_detections_to_regions([detection], value)
        self.assertTrue(ready)
        self.assertEqual(slots[0]["occupied"], 1)

    def test_touching_edge_has_zero_overlap(self):
        self.assertEqual(server.polygon_box_overlap(config()["slots"][0]["polygon"], [0.5, 0.1, 0.2, 0.4]), 0)
