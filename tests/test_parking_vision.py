import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image
import parking_vision as vision
import server


def encode(image):
    out = io.BytesIO()
    Image.fromarray(image).save(out, format="PNG")
    return out.getvalue()


class VisionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        patcher = patch.object(vision, "REFERENCES", Path(self.temp.name))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.frame = np.full((400, 600, 3), 170, dtype=np.uint8)
        cv2.rectangle(self.frame, (100, 100), (220, 220), (20, 20, 20), 6)
        self.config = {"slots": [{"id": "1", "slot_index": 0,
                        "polygon": [[.17, .255], [.365, .255], [.365, .545], [.17, .545]]}]}

    def test_missing_reference_is_unknown_not_empty(self):
        slots, ready, _ = vision.analyze(encode(self.frame), self.config)
        self.assertFalse(ready)
        self.assertIsNone(slots[0]["occupied"])

    def test_object_then_removal_and_uniform_lighting(self):
        self.config["reference_id"] = vision.save_reference(encode(self.frame))
        slots, ready, _ = vision.analyze(encode(self.frame), self.config)
        self.assertTrue(ready)
        self.assertEqual(slots[0]["occupied"], 0)
        occupied = self.frame.copy()
        cv2.rectangle(occupied, (140, 140), (180, 175), (220, 220, 220), -1)
        self.assertEqual(vision.analyze(encode(occupied), self.config)[0][0]["occupied"], 1)
        cv2.rectangle(occupied, (104, 104), (216, 216), (220, 220, 220), -1)
        self.assertEqual(vision.analyze(encode(occupied), self.config)[0][0]["occupied"], 1)
        bright = np.clip(self.frame.astype(int)+20, 0, 255).astype(np.uint8)
        self.assertEqual(vision.analyze(encode(bright), self.config)[0][0]["occupied"], 0)

    def test_resolution_change_is_unknown(self):
        self.config["reference_id"] = vision.save_reference(encode(self.frame))
        self.assertFalse(vision.analyze(encode(self.frame[::2, ::2]), self.config)[1])

    def test_closed_black_lines_generate_reviewable_polygons(self):
        frame = np.full((600, 800, 3), 180, np.uint8)
        for x in [100, 170, 400]:
            for y in [100, 160, 220, 280]:
                cv2.rectangle(frame, (x, y), (x+70, y+60), (10, 10, 10), 5)
        result = vision.detect(encode(frame), "lot", "1F")
        self.assertEqual(len(result["slots"]), 12)
        self.assertTrue(result["review_required"])
        roi = [[.1,.1],[.35,.1],[.35,.65],[.1,.65]]
        self.assertEqual(len(vision.detect(encode(frame), "lot", "1F", roi)["slots"]), 8)

    def test_unknown_does_not_become_empty_after_stabilization(self):
        worker = server.AnalysisWorker()
        for _ in range(5):
            result = worker._stabilize([{"id": "1", "status": "unknown"}])
        self.assertIsNone(result[0]["occupied"])
        self.assertEqual(result[0]["status"], "unknown")
