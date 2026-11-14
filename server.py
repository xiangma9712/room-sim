#!/usr/bin/env python3
"""
HTTP + SSE Live-Sync Web Server for Room-Sim.
Watches `data/rooms/*.json` and `data/workspace.json` so room switches
and furniture edits sync in real time between MCP and browser.
"""

from __future__ import annotations
import json
import os
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import mcp_server
import room_engine

ROOT_DIR = Path(__file__).parent
STATIC_DIR = ROOT_DIR / "static"
PORT = int(os.environ.get("PORT", "8765"))


def _build_payload() -> dict:
    state = room_engine.load_room_doc()
    analysis = room_engine.analyze_layout(state)
    return {
        "activeRoomId": state["id"],
        "rooms": room_engine.list_rooms(),
        "state": state,
        "analysis": analysis,
    }


class RoomSimHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def log_message(self, format: str, *args) -> None:
        if len(args) > 0 and ("/events" in str(args[0]) or "/api/state" in str(args[0])):
            return
        super().log_message(format, *args)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        super().end_headers()

    def _send_json(self, data: dict, status: int = 200) -> None:
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            self._send_json(_build_payload())
            return

        if parsed.path == "/api/catalog":
            self._send_json({
                "style_themes": room_engine.STYLE_THEMES,
                "furniture_catalog": room_engine.FURNITURE_CATALOG,
            })
            return

        if parsed.path == "/events":
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()

            last_mtime = 0.0
            try:
                while True:
                    mtime = room_engine.get_data_mtime()
                    if mtime != last_mtime:
                        last_mtime = mtime
                        payload = json.dumps(_build_payload(), ensure_ascii=False)
                        self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
                        self.wfile.flush()
                    time.sleep(0.25)
            except (BrokenPipeError, ConnectionResetError):
                return

        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length).decode("utf-8")) if length > 0 else {}

        if parsed.path == "/api/state":
            state = body.get("state")
            if not state:
                self._send_json({"error": "Missing state"}, 400)
                return
            room_engine.save_room_doc(state)
            self._send_json(_build_payload())
            return

        if parsed.path == "/api/tool":
            tool_name = body.get("name", "")
            tool_args = body.get("arguments") or {}
            try:
                result = mcp_server.handle_tool_call(tool_name, tool_args)
                payload = _build_payload()
                payload["result"] = result
                self._send_json(payload)
            except Exception as exc:
                self._send_json({"error": str(exc)}, 400)
            return

        self._send_json({"error": "Not found"}, 404)


def main() -> None:
    room_engine.load_workspace()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), RoomSimHandler)
    print(f"🏠 Room-Sim 3D Web Server running at http://localhost:{PORT}")
    print("   Watching data/rooms/*.json for real-time MCP updates...")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        server.server_close()


if __name__ == "__main__":
    main()
