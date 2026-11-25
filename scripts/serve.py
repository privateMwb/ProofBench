"""Local dev server for ProofBench: serves ./site with no caching and correct MIME types."""
import functools
import http.server
import mimetypes
import os

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/wasm", ".wasm")

SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site")


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


print("Serving", os.path.abspath(SITE), "at http://localhost:8000  (Ctrl+C to stop)")
http.server.test(HandlerClass=functools.partial(Handler, directory=SITE), port=8000, bind="127.0.0.1")
