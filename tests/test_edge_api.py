import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock

import edge_api


class EdgeApiTests(unittest.TestCase):
    def setUp(self):
        edge_api._rate_entries.clear()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), edge_api.EdgeApiHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, path, *, method="GET", origin=None, payload=None):
        headers = {}
        if origin:
            headers["Origin"] = origin
        data = None
        if payload is not None:
            data = json.dumps(payload).encode()
            headers["Content-Type"] = "application/json"
        return urllib.request.urlopen(
            urllib.request.Request(self.base_url + path, data=data, headers=headers, method=method),
            timeout=3,
        )

    def test_health_does_not_expose_key(self):
        with mock.patch.object(edge_api, "GEMINI_API_KEY", "server-secret"):
            response = self.request("/api/health")
            body = response.read().decode()
        self.assertEqual(response.status, 200)
        self.assertNotIn("server-secret", body)

    def test_health_reports_the_effective_non_retired_model(self):
        response = self.request("/api/health")
        body = json.loads(response.read().decode())

        self.assertEqual(body["geminiModel"], edge_api.GEMINI_MODELS[0])
        self.assertNotIn(body["geminiModel"], edge_api.RETIRED_GEMINI_MODELS)
        self.assertTrue(set(body["geminiModels"]).isdisjoint(edge_api.RETIRED_GEMINI_MODELS))

    def test_allowed_origin_can_generate(self):
        payload = {"contents": [{"parts": [{"text": "test"}]}]}
        with mock.patch.object(edge_api, "ALLOWED_ORIGINS", {"https://app.example"}), mock.patch.object(
            edge_api, "request_gemini", return_value={"candidates": []}
        ):
            response = self.request(
                "/api/gemini/generate",
                method="POST",
                origin="https://app.example",
                payload=payload,
            )
        self.assertEqual(response.status, 200)
        self.assertEqual(response.headers["Access-Control-Allow-Origin"], "https://app.example")

    def test_unknown_origin_is_rejected_before_gemini(self):
        with mock.patch.object(edge_api, "ALLOWED_ORIGINS", {"https://app.example"}), mock.patch.object(
            edge_api, "request_gemini"
        ) as gemini:
            with self.assertRaises(urllib.error.HTTPError) as raised:
                self.request(
                    "/api/gemini/generate",
                    method="POST",
                    origin="https://evil.example",
                    payload={"contents": [{}]},
                )
        self.assertEqual(raised.exception.code, 403)
        gemini.assert_not_called()

    def test_payload_drops_browser_supplied_key_and_model(self):
        result = edge_api.validate_payload(
            {
                "contents": [{"parts": [{"text": "test"}]}],
                "generationConfig": {},
                "apiKey": "browser-key",
                "model": "other-model",
            }
        )
        self.assertEqual(set(result), {"contents", "generationConfig"})


if __name__ == "__main__":
    unittest.main()
