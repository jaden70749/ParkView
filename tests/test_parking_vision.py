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

    def test_local_shadow_on_floor_is_not_a_parked_object(self):
        self.config["reference_id"] = vision.save_reference(encode(self.frame))
        shadow = self.frame.copy()
        shadow[50:270, 50:270] = np.clip(shadow[50:270, 50:270].astype(int)-35, 0, 255)
        result = vision.analyze(encode(shadow), self.config)[0][0]
        self.assertEqual(result["occupied"], 0)
        self.assertAlmostEqual(result["lighting_offset"], -35, delta=1)
        cv2.rectangle(shadow, (140, 140), (180, 175), (210, 210, 210), -1)
        self.assertEqual(vision.analyze(encode(shadow), self.config)[0][0]["occupied"], 1)

    def test_thin_video_artifact_is_removed_but_dark_object_is_kept(self):
        self.config["reference_id"] = vision.save_reference(encode(self.frame))
        noisy = self.frame.copy()
        cv2.line(noisy, (120, 150), (200, 150), (0, 0, 0), 1)
        self.assertEqual(vision.analyze(encode(noisy), self.config)[0][0]["occupied"], 0)
        cv2.rectangle(noisy, (140, 140), (180, 175), (60, 60, 60), -1)
        self.assertEqual(vision.analyze(encode(noisy), self.config)[0][0]["occupied"], 1)

    def test_small_camera_jitter_on_textured_floor_is_not_occupancy(self):
        rng = np.random.default_rng(42)
        texture = rng.integers(110, 210, (400, 600), dtype=np.uint8)
        self.frame = np.repeat(texture[:, :, None], 3, axis=2)
        cv2.rectangle(self.frame, (100, 100), (220, 220), (20, 20, 20), 6)
        self.config["reference_id"] = vision.save_reference(encode(self.frame))
        shifted = cv2.warpAffine(self.frame, np.float32([[1, 0, -.5], [0, 1, -1]]),
                                 (600, 400), borderMode=cv2.BORDER_REFLECT)
        results, ready, _ = vision.analyze(encode(shifted), self.config)
        self.assertTrue(ready)
        self.assertEqual(results[0]["occupied"], 0)
        cv2.rectangle(shifted, (140, 140), (180, 175), (40, 40, 40), -1)
        self.assertEqual(vision.analyze(encode(shifted), self.config)[0][0]["occupied"], 1)
        moved = cv2.warpAffine(self.frame, np.float32([[1, 0, 7], [0, 1, 0]]),
                               (600, 400), borderMode=cv2.BORDER_REFLECT)
        results, ready, _ = vision.analyze(encode(moved), self.config)
        self.assertFalse(ready)
        self.assertIsNone(results[0]["occupied"])

    def test_vehicle_can_move_between_bays_with_small_rotation(self):
        rng = np.random.default_rng(12)
        texture = rng.integers(120, 200, (400, 600), dtype=np.uint8)
        frame = np.repeat(texture[:, :, None], 3, axis=2)
        cv2.rectangle(frame, (100, 100), (220, 220), (20, 20, 20), 6)
        cv2.rectangle(frame, (260, 100), (380, 220), (20, 20, 20), 6)
        self.config["slots"].append({"id": "2", "slot_index": 1,
            "polygon": [[.438,.255],[.63,.255],[.63,.545],[.438,.545]]})
        self.config["reference_id"] = vision.save_reference(encode(frame))
        warp = cv2.getRotationMatrix2D((300, 200), .15, 1)
        for occupied_index, x in enumerate([140, 300]):
            current = frame.copy()
            cv2.rectangle(current, (x, 140), (x+40, 175), (50, 50, 50), -1)
            current = cv2.warpAffine(current, warp, (600, 400), borderMode=cv2.BORDER_REFLECT)
            cv2.rectangle(current, (460, 20), (580, 90), (10, 10, 10), -1)
            result, ready, _ = vision.analyze(encode(current), self.config)
            self.assertTrue(ready)
            self.assertEqual([r["occupied"] for r in result],
                             [int(i == occupied_index) for i in range(2)])

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

    def test_nested_slot_borders_are_not_counted_twice(self):
        frame = np.full((600, 800, 3), 180, np.uint8)
        for x in [100, 220, 340]:
            cv2.rectangle(frame, (x, 100), (x+90, 180), (10, 10, 10), 5)
            cv2.rectangle(frame, (x+10, 110), (x+80, 170), (20, 20, 20), 3)
        result = vision.detect(encode(frame), "lot", "1F")
        self.assertEqual(len(result["slots"]), 3)

    def test_outline_around_multiple_spaces_is_not_a_parking_space(self):
        spaces = [
            np.array([[.1,.1],[.25,.1],[.25,.3],[.1,.3]], np.float32),
            np.array([[.3,.1],[.45,.1],[.45,.3],[.3,.3]], np.float32),
            np.array([[.5,.1],[.65,.1],[.65,.3],[.5,.3]], np.float32),
        ]
        group = np.array([[.05,.05],[.7,.05],[.7,.35],[.05,.35]], np.float32)
        result = vision.remove_group_outlines([group, *spaces])
        self.assertEqual(len(result), 3)
        self.assertTrue(all(any(np.array_equal(item, space) for item in result) for space in spaces))

    def test_unknown_does_not_become_empty_after_stabilization(self):
        worker = server.AnalysisWorker()
        for _ in range(5):
            result = worker._stabilize([{"id": "1", "status": "unknown"}])
        self.assertIsNone(result[0]["occupied"])
        self.assertEqual(result[0]["status"], "unknown")

    def test_one_frame_flash_does_not_mark_an_empty_bay_occupied(self):
        worker = server.AnalysisWorker()
        empty = {"id": "1", "status": "empty", "strategy": "empty_reference_difference"}
        occupied = {**empty, "status": "occupied"}
        for _ in range(server.EMPTY_CONFIRMATIONS):
            worker._stabilize([empty])
        self.assertEqual(worker._stabilize([occupied])[0]["occupied"], 0)
        self.assertEqual(worker._stabilize([empty])[0]["occupied"], 0)
        self.assertEqual(worker._stabilize([occupied])[0]["occupied"], 0)
        self.assertEqual(worker._stabilize([occupied])[0]["occupied"], 1)
