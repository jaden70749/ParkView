import io
import http.client
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image

import server


class PublicRelayTests(unittest.TestCase):
    def setUp(self):
        self.relay = mock.patch.object(server, "PUBLIC_RELAY_MODE", True)
        self.relay.start()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.ParkViewHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        self.relay.stop()

    def request(self, method, path, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=3)
        connection.request(method, path, headers=headers or {})
        response = connection.getresponse()
        result = (response.status, response.headers, response.read())
        connection.close()
        return result

    def test_preflight_has_exactly_one_allowed_origin(self):
        origin = "https://jaden70749.github.io"
        with mock.patch.object(server, "allowed_origin_values", return_value=(origin,)):
            status, headers, _ = self.request("OPTIONS", "/api/camera/configure", {
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            })
        self.assertEqual(status, 204)
        self.assertEqual(headers.get_all("Access-Control-Allow-Origin"), [origin])

    def test_project_files_and_directory_are_not_published(self):
        for method in ("GET", "HEAD"):
            for path in ("/", "/.env", "/%2eenv", "/.git/config", "/debug/latest_capture.jpg"):
                with self.subTest(method=method, path=path):
                    self.assertEqual(self.request(method, path)[0], 404)

    def test_relay_cannot_use_localhost_to_bypass_authentication(self):
        with mock.patch.object(server, "AI_ALLOW_PRIVATE_NETWORK", True):
            self.assertEqual(self.request("GET", "/api/camera/preview")[0], 401)
            self.assertEqual(self.request("POST", "/api/gemini/generate")[0], 401)
            self.assertEqual(self.request("POST", "/api/camera/configure")[0], 401)

    def test_authenticated_preview_and_public_health_still_work(self):
        with mock.patch.object(server, "ADMIN_TOKEN_CONFIGURED", True), mock.patch.object(
            server, "ADMIN_TOKEN", "test-token"
        ), mock.patch.object(server.worker, "preview_frame", return_value=b"test-frame"):
            status, _, body = self.request("GET", "/api/camera/preview", {"Authorization": "Bearer test-token"})
        self.assertEqual((status, body), (200, b"test-frame"))
        self.assertEqual(self.request("GET", "/api/health")[0], 200)


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


class CameraRuntimeTests(unittest.TestCase):
    @staticmethod
    def jpeg_frame(width=320, height=180):
        output = io.BytesIO()
        Image.new("RGB", (width, height), (80, 120, 160)).save(
            output, format="JPEG"
        )
        return output.getvalue()

    def test_rtsp_endpoint_uses_default_port_without_exposing_credentials(self):
        endpoint = server.camera_network_endpoint(
            "rtsp://camera-user:camera-password@192.168.0.26/stream"
        )
        self.assertEqual(endpoint, ("192.168.0.26", 554))

    def test_camera_probe_saves_latest_frame_without_running_yolo(self):
        worker = server.AnalysisWorker()
        worker._camera_url = "rtsp://camera.local/stream"
        image_bytes = self.jpeg_frame()
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            server, "DEBUG_DIR", Path(directory)
        ), mock.patch.object(
            server, "capture_camera_frame", return_value=image_bytes
        ):
            result = worker.test_camera()

            self.assertTrue(result["connected"])
            self.assertEqual(result["image"]["width"], 320)
            self.assertTrue((Path(directory) / "latest_capture.jpg").exists())
            self.assertTrue(worker.health()["camera"]["connected"])

    def test_analysis_failure_does_not_report_camera_disconnected(self):
        worker = server.AnalysisWorker()
        worker._camera_url = "rtsp://camera.local/stream"
        image_bytes = self.jpeg_frame()
        with mock.patch.object(
            server, "DEBUG_ENABLED", False
        ), mock.patch.object(
            server, "capture_camera_frame", return_value=image_bytes
        ), mock.patch.object(
            server, "detect_objects", side_effect=RuntimeError("model failed")
        ):
            with self.assertRaisesRegex(RuntimeError, "model failed"):
                worker.run_once()

        health = worker.health()
        self.assertTrue(health["camera"]["connected"])
        self.assertIsNone(health["camera"]["last_error"])
        self.assertEqual(health["analysis_error"], "model failed")

    def test_capture_failure_updates_camera_health(self):
        worker = server.AnalysisWorker()
        worker._camera_url = "rtsp://camera.local/stream"
        with mock.patch.object(
            server,
            "capture_camera_frame",
            side_effect=ConnectionError("camera offline"),
        ):
            with self.assertRaisesRegex(ConnectionError, "camera offline"):
                worker.test_camera()

        camera = worker.health()["camera"]
        self.assertFalse(camera["connected"])
        self.assertEqual(camera["consecutive_failures"], 1)
        self.assertEqual(camera["last_error"], "camera offline")

    def test_runtime_camera_configuration_tests_before_connecting(self):
        worker = server.AnalysisWorker()
        worker._camera_url = ""
        image_bytes = self.jpeg_frame(640, 360)
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            server, "DEBUG_DIR", Path(directory)
        ), mock.patch.object(
            server, "capture_camera_frame", return_value=image_bytes
        ), mock.patch.object(worker, "start") as start:
            result = worker.configure_camera({
                "url": "rtsp://user:secret@192.168.0.26:554/stream",
                "name": "입구 CCTV",
                "floor_id": "1F",
            })

        self.assertTrue(result["connected"])
        self.assertEqual(result["image"]["width"], 640)
        self.assertEqual(worker.health()["camera"]["name"], "입구 CCTV")
        self.assertEqual(worker.health()["floor_id"], "1F")
        self.assertNotIn("secret", str(worker.health()))
        start.assert_called_once()


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

    def test_allowed_origin_parsing_accepts_multiple_sources(self):
        with mock.patch.dict(
            server.os.environ,
            {
                "PARKVIEW_ALLOWED_ORIGINS": "https://jaden70749.github.io,http://localhost:5180,http://127.0.0.1:5180",
                "PARKVIEW_ALLOWED_ORIGIN": "https://other.example",
            },
            clear=False,
        ):
            origins = server.allowed_origin_values()
            self.assertIn("https://jaden70749.github.io", origins)
            self.assertIn("http://localhost:5180", origins)
            self.assertIn("http://127.0.0.1:5180", origins)
            self.assertEqual(server.resolve_allowed_origin("https://jaden70749.github.io"), "https://jaden70749.github.io")
            self.assertIsNone(server.resolve_allowed_origin("https://blocked.example"))


if __name__ == "__main__":
    unittest.main()
