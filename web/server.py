#!/usr/bin/env python3
"""HTTP server with correct MIME types for PWA."""
import http.server
import os
import socketserver

PORT = 8765


class PWAHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".json": "application/manifest+json",
        ".svg": "image/svg+xml",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    with socketserver.TCPServer(("", PORT), PWAHandler) as httpd:
        httpd.allow_reuse_address = True
        print(f"Serving on http://localhost:{PORT}")
        httpd.serve_forever()
