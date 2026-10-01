import http.client
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest import mock

import edge_api


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


if __name__ == "__main__":
    unittest.main()
