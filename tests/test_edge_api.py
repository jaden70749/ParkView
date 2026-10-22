import http.client
import threading
import unittest
import urllib.error
from http.server import ThreadingHTTPServer
from unittest import mock

import edge_api


class GeminiTimeoutTests(unittest.TestCase):
    payload = {"contents": [{"parts": [{"text": "test"}]}]}

    def test_socket_and_wrapped_timeouts_are_retryable(self):
        for error in (TimeoutError("The read operation timed out"), urllib.error.URLError(TimeoutError())):
            with self.subTest(error=type(error).__name__), mock.patch.object(edge_api.urllib.request, "urlopen", side_effect=error):
                with self.assertRaises(edge_api.GeminiApiError) as raised:
                    edge_api.request_gemini_model(self.payload, "test-model")
                self.assertEqual(raised.exception.status, 504)

    def test_timeout_during_response_read_is_retryable(self):
        response = mock.MagicMock()
        response.__enter__.return_value.read.side_effect = TimeoutError()
        with mock.patch.object(edge_api.urllib.request, "urlopen", return_value=response):
            with self.assertRaises(edge_api.GeminiApiError) as raised:
                edge_api.request_gemini_model(self.payload, "test-model")
        self.assertEqual(raised.exception.status, 504)

    def test_stalled_model_falls_back_without_repeating_the_same_model(self):
        with mock.patch.object(edge_api, "GEMINI_API_KEY", "test-key"), \
                mock.patch.object(edge_api, "GEMINI_MODELS", ("slow", "working")), \
                mock.patch.object(edge_api, "request_gemini_model", side_effect=[
                    edge_api.GeminiApiError("timeout", 504, "slow"), {"candidates": []}
                ]) as request:
            self.assertEqual(edge_api.request_gemini(self.payload), {"candidates": []})
        self.assertEqual([call.args[1] for call in request.call_args_list], ["slow", "working"])

    def test_fallback_stops_when_request_budget_is_exhausted(self):
        with mock.patch.object(edge_api, "GEMINI_API_KEY", "test-key"), \
                mock.patch.object(edge_api, "GEMINI_MODELS", ("slow", "next")), \
                mock.patch.object(edge_api.time, "monotonic", side_effect=[0, 0, 181]), \
                mock.patch.object(edge_api, "request_gemini_model", side_effect=edge_api.GeminiApiError("timeout", 504)) as request:
            with self.assertRaises(edge_api.GeminiUnavailableError):
                edge_api.request_gemini(self.payload)
        self.assertEqual(request.call_count, 1)

    def test_invalid_requests_are_not_retried(self):
        with mock.patch.object(edge_api, "GEMINI_API_KEY", "test-key"), \
                mock.patch.object(edge_api, "request_gemini_model", side_effect=edge_api.GeminiApiError("bad request", 400)) as request:
            with self.assertRaises(edge_api.GeminiApiError):
                edge_api.request_gemini(self.payload)
        self.assertEqual(request.call_count, 1)


class CameraRelayTests(unittest.TestCase):
    def setUp(self):
        edge_api._camera_frames.clear()
        self.secret = "relay-test-secret"
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), edge_api.EdgeApiHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        edge_api._camera_frames.clear()

    def request(self, method, path, body=b"", headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=3)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        result = (response.status, response.headers, response.read())
        connection.close()
        return result

    def test_ingest_requires_relay_secret_and_viewer_can_read_frame(self):
        with mock.patch.object(edge_api, "CAMERA_RELAY_SECRET", self.secret):
            self.assertEqual(self.request("POST", "/api/camera/ingest?camera_id=site-1", b"\xff\xd8frame", {
                "X-ParkView-Relay-Secret": self.secret,
                "X-ParkView-Viewer-Token": "viewer-token",
                "X-ParkView-Camera-Name": "%EC%A3%BC%EC%B0%A8%EC%9E%A5%20CCTV",
                "X-ParkView-Floor-Id": "1F",
                "Content-Length": "7",
                "Origin": "https://jaden70749.github.io",
            })[0], 200)
            status, headers, body = self.request("GET", "/api/camera/frame?camera_id=site-1", headers={
                "Authorization": "Viewer viewer-token",
                "Origin": "https://jaden70749.github.io",
            })
        self.assertEqual(status, 200)
        self.assertEqual(body, b"\xff\xd8frame")
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "https://jaden70749.github.io")
        with edge_api._camera_lock:
            self.assertEqual(edge_api._camera_frames["site-1"]["camera"], "주차장 CCTV")
            self.assertEqual(edge_api._camera_frames["site-1"]["floor_id"], "1F")

    def test_wrong_viewer_token_is_rejected(self):
        with mock.patch.object(edge_api, "CAMERA_RELAY_SECRET", self.secret):
            self.request("POST", "/api/camera/ingest?camera_id=site-1", b"\xff\xd8frame", {
                "X-ParkView-Relay-Secret": self.secret,
                "X-ParkView-Viewer-Token": "viewer-token",
                "Content-Length": "7",
            })
            self.assertEqual(self.request("GET", "/api/camera/frame?camera_id=site-1", headers={
                "Authorization": "Viewer wrong-token",
            })[0], 401)

    def test_school_pages_origin_is_allowed(self):
        status, headers, _body = self.request("OPTIONS", "/api/camera/frame", headers={
            "Origin": "https://waymakerschool.github.io",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization",
        })
        self.assertEqual(status, 204)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "https://waymakerschool.github.io")
        allowed_headers = {
            header.strip().lower()
            for header in headers.get("Access-Control-Allow-Headers", "").split(",")
        }
        self.assertIn("authorization", allowed_headers)

    def test_main_pages_origin_allows_admin_camera_headers(self):
        status, headers, _body = self.request("OPTIONS", "/api/camera/configure", headers={
            "Origin": "https://jaden70749.github.io",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        })
        self.assertEqual(status, 204)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "https://jaden70749.github.io")
        allowed_headers = {
            header.strip().lower()
            for header in headers.get("Access-Control-Allow-Headers", "").split(",")
        }
        self.assertTrue({"authorization", "content-type"}.issubset(allowed_headers))


if __name__ == "__main__":
    unittest.main()
