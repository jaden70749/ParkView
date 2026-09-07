#!/usr/bin/env python3
"""Small production-facing Gemini proxy for the ParkView static app."""

from __future__ import annotations

import argparse
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict, deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash").strip()
ALLOWED_ORIGINS = {
    origin.strip().rstrip("/")
    for origin in os.environ.get(
        "PARKVIEW_ALLOWED_ORIGINS",
        "https://jaden70749.github.io,http://localhost:5181,http://127.0.0.1:5181",
    ).split(",")
    if origin.strip()
}
MAX_REQUEST_BYTES = max(
    1024 * 1024,
    int(os.environ.get("PARKVIEW_MAX_AI_REQUEST_BYTES", str(24 * 1024 * 1024))),
)
RATE_LIMIT_REQUESTS = max(2, int(os.environ.get("PARKVIEW_AI_RATE_LIMIT", "30")))
RATE_LIMIT_WINDOW = max(60, int(os.environ.get("PARKVIEW_AI_RATE_WINDOW", "600")))

_rate_lock = threading.Lock()
_rate_entries: dict[str, deque[float]] = defaultdict(deque)
_gemini_slots = threading.BoundedSemaphore(2)


def validate_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("요청 형식이 올바르지 않습니다")
    contents = payload.get("contents")
    if not isinstance(contents, list) or not contents:
        raise ValueError("분석할 사진과 요청 내용이 없습니다")
    generation_config = payload.get("generationConfig", {})
    if not isinstance(generation_config, dict):
        raise ValueError("생성 설정이 올바르지 않습니다")
    return {"contents": contents, "generationConfig": generation_config}


def request_gemini(payload: Any) -> dict[str, Any]:
    if not GEMINI_API_KEY:
        raise RuntimeError("AI 서버 키가 설정되지 않았습니다")
    model = urllib.parse.quote(GEMINI_MODEL, safe="-._")
    key = urllib.parse.quote(GEMINI_API_KEY, safe="")
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={key}"
    )
    request = urllib.request.Request(
        url,
        data=json.dumps(validate_payload(payload), ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(body).get("error", {}).get("message")
        except json.JSONDecodeError:
            detail = None
        raise RuntimeError(detail or f"AI API HTTP {error.code}") from error
    except urllib.error.URLError as error:
        raise RuntimeError("AI API에 연결할 수 없습니다") from error


def rate_limit_allows(client: str) -> tuple[bool, int]:
    now = time.monotonic()
    with _rate_lock:
        entries = _rate_entries[client]
        while entries and entries[0] <= now - RATE_LIMIT_WINDOW:
            entries.popleft()
        if len(entries) >= RATE_LIMIT_REQUESTS:
            retry_after = max(1, int(entries[0] + RATE_LIMIT_WINDOW - now))
            return False, retry_after
        entries.append(now)
        return True, 0


class EdgeApiHandler(BaseHTTPRequestHandler):
    server_version = "ParkViewEdge/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} {format % args}", flush=True)

    @property
    def request_origin(self) -> str:
        return self.headers.get("Origin", "").strip().rstrip("/")

    def origin_allowed(self) -> bool:
        return self.request_origin in ALLOWED_ORIGINS

    def end_headers(self) -> None:
        if self.origin_allowed():
            self.send_header("Access-Control-Allow-Origin", self.request_origin)
            self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        if not self.origin_allowed():
            self.send_json(HTTPStatus.FORBIDDEN, {"error": "허용되지 않은 웹 주소입니다"})
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/api/health":
            self.send_json(
                HTTPStatus.OK,
                {"ok": True, "service": "parkview-plan-api", "geminiConfigured": bool(GEMINI_API_KEY)},
            )
            return
        if path == "/api/public-config":
            self.send_json(
                HTTPStatus.OK,
                {"geminiConfigured": bool(GEMINI_API_KEY), "backendConnected": True},
            )
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def do_POST(self) -> None:
        if self.path.split("?", 1)[0] != "/api/gemini/generate":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return
        if not self.origin_allowed():
            self.send_json(HTTPStatus.FORBIDDEN, {"error": "허용되지 않은 웹 주소입니다"})
            return
        allowed, retry_after = rate_limit_allows(self.client_address[0])
        if not allowed:
            self.send_response(HTTPStatus.TOO_MANY_REQUESTS)
            self.send_header("Retry-After", str(retry_after))
            self.send_header("Content-Type", "application/json; charset=utf-8")
            body = json.dumps({"error": "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."}, ensure_ascii=False).encode("utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_REQUEST_BYTES:
                raise ValueError("사진 용량이 너무 큽니다")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not _gemini_slots.acquire(blocking=False):
                self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "다른 도면을 생성 중입니다. 잠시 후 다시 시도해 주세요."})
                return
            try:
                result = request_gemini(payload)
            finally:
                _gemini_slots.release()
            self.send_json(HTTPStatus.OK, result)
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except Exception as error:
            print(f"AI_REQUEST_ERROR type={type(error).__name__}", flush=True)
            self.send_json(HTTPStatus.BAD_GATEWAY, {"error": str(error)})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "10000")))
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), EdgeApiHandler)
    print(f"ParkView plan API listening on {args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
