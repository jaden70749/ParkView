import unittest
from unittest import mock

import numpy as np

import server


class RegionMatchingTests(unittest.TestCase):
    def test_camera_polygon_matches_detection_center(self):
        config = {
            "coordinate_system": "normalized_camera_image",
            "slots": [
                {
                    "id": "B1-001",
                    "slot_index": 0,
                    "kind": "normal",
                    "polygon": [[0.1, 0.1], [0.4, 0.1], [0.4, 0.5], [0.1, 0.5]],
                }
            ],
        }
        detections = [
            {"bbox_normalized": [0.15, 0.2, 0.1, 0.1], "score": 0.9}
        ]

        results, ready, strategy = server.match_detections_to_regions(
            detections, config
        )

        self.assertTrue(ready)
        self.assertEqual(strategy, "camera_roi")
        self.assertEqual(results[0]["status"], "occupied")

    def test_homography_transforms_camera_point_before_matching(self):
        config = {
            "coordinate_system": "normalized_plan",
            "calibration": {
                "camera_points": [[0, 0], [1, 0], [1, 1], [0, 1]],
                "plan_points": [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]],
            },
            "slots": [
                {
                    "id": "B1-001",
                    "slot_index": 0,
                    "kind": "normal",
                    "polygon": [[0.42, 0.42], [0.58, 0.42], [0.58, 0.58], [0.42, 0.58]],
                }
            ],
        }
        detections = [
            {"bbox_normalized": [0.45, 0.45, 0.1, 0.1], "score": 0.9}
        ]

        results, ready, strategy = server.match_detections_to_regions(
            detections, config
        )

        self.assertTrue(ready)
        self.assertEqual(strategy, "homography")
        self.assertEqual(results[0]["status"], "occupied")
        self.assertTrue(np.allclose(detections[0]["match_point"], [0.5, 0.5]))

    def test_plan_coordinates_require_calibration(self):
        config = {"coordinate_system": "normalized_plan", "slots": [{}]}
        results, ready, strategy = server.match_detections_to_regions([], config)
        self.assertFalse(ready)
        self.assertEqual(results, [])
        self.assertEqual(strategy, "missing_homography_calibration")


class StabilityTests(unittest.TestCase):
    def test_occupied_slot_requires_two_empty_results_to_clear(self):
        worker = server.AnalysisWorker()
        occupied = {"id": "B1-001", "status": "occupied"}
        empty = {"id": "B1-001", "status": "empty"}

        self.assertEqual(worker._stabilize([occupied])[0]["status"], "occupied")
        self.assertEqual(worker._stabilize([empty])[0]["status"], "occupied")
        self.assertEqual(worker._stabilize([empty])[0]["status"], "empty")


class RuntimeSecurityTests(unittest.TestCase):
    def test_public_config_only_exposes_browser_map_key(self):
        with mock.patch.object(
            server, "KAKAO_JAVASCRIPT_KEY", "public-map-key"
        ), mock.patch.object(server, "GEMINI_API_KEY", "server-only-key"):
            config = server.public_runtime_config()

        self.assertEqual(config["kakaoJavaScriptKey"], "public-map-key")
        self.assertTrue(config["geminiConfigured"])
        self.assertNotIn("server-only-key", str(config))

    def test_gemini_payload_is_limited_to_supported_fields(self):
        payload = server.validate_gemini_payload(
            {
                "contents": [{"role": "user", "parts": [{"text": "test"}]}],
                "generationConfig": {"responseMimeType": "application/json"},
                "apiKey": "must-not-pass-through",
                "model": "must-not-pass-through",
            }
        )

        self.assertEqual(set(payload), {"contents", "generationConfig"})

    def test_private_network_detection(self):
        self.assertTrue(server.client_is_private("127.0.0.1"))
        self.assertTrue(server.client_is_private("192.168.0.20"))
        self.assertFalse(server.client_is_private("8.8.8.8"))


if __name__ == "__main__":
    unittest.main()
