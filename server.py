"""StoryZLine server for laptops without Node.js. Needs only Python 3.7+ (standard library, no pip).

Serves public/ and proxies authenticated GETs to Bitbucket, with the same rules as server.js
and lib/proxy.js. Listens on 127.0.0.1 only.

    python server.py [--port 5180] [--open] [--proxy auto|system|direct|http://host:port]

--proxy (or STORYZLINE_PROXY):
  auto    (default) use the Windows proxy, but connect directly if the proxy asks for a login
          (407). Company proxies often need a Windows sign-in Python can't do, while the
          internal Bitbucket is reachable directly over the VPN.
  system  always use the Windows proxy settings.
  direct  never use a proxy.
  URL     use this proxy, e.g. http://proxy.bank.com:8080 or http://user:pass@proxy:8080.
"""
import argparse
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")
MAX_BYTES = 5 * 1024 * 1024
PROXY_MODE = "auto"
TYPES = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml"}


class ProxyError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def check_target(url, base_url):
    """The login may only ever be sent to the Bitbucket host the user typed (plus the Cloud API host)."""
    if not re.match(r"^https?://[^/\s]+", base_url or "", re.I):
        raise ProxyError("The Bitbucket URL must start with http:// or https://.")
    if not re.match(r"^https?://", url or "", re.I):
        raise ProxyError("Only http(s) URLs can be fetched.")
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    base_host = (urllib.parse.urlsplit(base_url).hostname or "").lower()
    cloud = re.search(r"(^|\.)bitbucket\.org$", base_host) is not None
    if host != base_host and not (cloud and host == "api.bitbucket.org"):
        raise ProxyError('Refusing to send the login to "%s": it is not the Bitbucket host "%s".' % (host, base_host), 403)


def redirect_handler(base_url):
    # urllib would otherwise forward the Authorization header to wherever Bitbucket redirects.
    class SameHostRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            check_target(newurl, base_url)
            return super().redirect_request(req, fp, code, msg, headers, newurl)
    return SameHostRedirect


def read_limited(resp):
    body = resp.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ProxyError("File is larger than 5 MB.", 413)
    return body


def proxy_get(url, conn):
    """Returns {status, contentType, body} for any HTTP reply; raises only when Bitbucket can't be reached."""
    conn = conn if isinstance(conn, dict) else {}
    base_url = str(conn.get("baseUrl") or "").strip()
    check_target(url, base_url)

    headers = {"Accept": "text/plain, application/json, */*", "User-Agent": "StoryZLine"}
    user = str(conn.get("user") or "").strip()
    password = str(conn.get("password") or "")
    if user:
        headers["Authorization"] = "Basic " + base64.b64encode(("%s:%s" % (user, password)).encode("utf-8")).decode("ascii")
    elif password:
        headers["Authorization"] = "Bearer " + password

    # A fresh Request per attempt: urllib rewrites a Request in place when it routes it through a proxy.
    req = lambda: urllib.request.Request(url, headers=headers)
    where = urllib.parse.urlsplit(url).netloc
    if PROXY_MODE == "direct":
        return fetch_once(req, base_url, {}, where)
    if PROXY_MODE not in ("auto", "system"):
        return fetch_once(req, base_url, {"http": PROXY_MODE, "https": PROXY_MODE}, where)
    try:
        result = fetch_once(req, base_url, None, where)
    except ProxyError as e:
        if PROXY_MODE != "auto" or "407" not in str(e):
            raise
        result = {"status": 407}
    if PROXY_MODE == "auto" and result["status"] == 407:
        # The Windows proxy wants a sign-in Python can't do; internal Bitbucket is usually reachable directly.
        try:
            return fetch_once(req, base_url, {}, where)
        except ProxyError as e:
            raise ProxyError("%s The Windows proxy also refused (407 Proxy Authentication Required). "
                             "If Bitbucket is only reachable through the proxy, start with "
                             "--proxy http://user:password@proxy-host:port." % e, e.status)
    return result


def fetch_once(make_request, base_url, proxies, where):
    """proxies: None = Windows proxy settings, {} = direct, or a urllib proxy map."""
    # Uses the Windows certificate store, like the browser.
    handlers = [redirect_handler(base_url)]
    if proxies is not None:
        handlers.append(urllib.request.ProxyHandler(proxies))
    opener = urllib.request.build_opener(*handlers)
    try:
        with opener.open(make_request(), timeout=20) as resp:
            return {"status": resp.status, "contentType": resp.headers.get("Content-Type", ""),
                    "body": read_limited(resp).decode("utf-8", "replace")}
    except urllib.error.HTTPError as e:
        return {"status": e.code, "contentType": e.headers.get("Content-Type", "") if e.headers else "",
                "body": read_limited(e).decode("utf-8", "replace")}
    except (urllib.error.URLError, OSError) as e:
        reason = getattr(e, "reason", e)
        route = "directly" if proxies == {} else "through the proxy"
        raise ProxyError("Could not reach Bitbucket at %s %s: %s." % (where, route, reason), 502)


class Handler(BaseHTTPRequestHandler):
    server_version = "StoryZLine"

    def log_message(self, fmt, *args):
        pass

    def send(self, status, body, content_type="application/json"):
        data = json.dumps(body).encode("utf-8") if content_type == "application/json" else body
        self.send_response(status)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def from_own_page(self):
        """Only the StoryZLine page itself may call the API (blocks cross-site and DNS-rebinding requests)."""
        port = self.server.server_address[1]
        host = (self.headers.get("Host") or "").lower()
        if host not in ("127.0.0.1:%d" % port, "localhost:%d" % port):
            return False
        if not re.match(r"^application/json\b", self.headers.get("Content-Type") or "", re.I):
            return False
        origin = self.headers.get("Origin")
        return not origin or origin.lower() == "http://" + host

    def do_POST(self):
        try:
            if not self.path.startswith("/api/"):
                return self.send(405, {"error": "Method not allowed"})
            if not self.from_own_page():
                return self.send(403, {"error": "Requests must come from the StoryZLine page."})
            if self.path != "/api/get":
                return self.send(404, {"error": "Not found"})
            length = int(self.headers.get("Content-Length") or 0)
            if length > 64 * 1024:
                raise ProxyError("Request too large.", 413)
            try:
                req = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                raise ProxyError("Invalid JSON body.")
            self.send(200, proxy_get(str(req.get("url") or ""), req.get("connection")))
        except ProxyError as e:
            self.send(e.status, {"error": str(e)})
        except Exception as e:  # keep serving after unexpected errors
            print("Error: %s" % e, flush=True)
            self.send(500, {"error": str(e)})

    def do_GET(self):
        if self.path == "/api/config":
            return self.send(200, {"server": "python"})
        path = urllib.parse.unquote(self.path.split("?", 1)[0])
        if path == "/":
            path = "/index.html"
        file = os.path.normpath(os.path.join(PUBLIC, path.lstrip("/\\")))
        if not file.lower().startswith(PUBLIC.lower() + os.sep):
            return self.send(403, b"Forbidden", "text/plain")
        if not os.path.isfile(file):
            return self.send(404, b"Not found", "text/plain")
        with open(file, "rb") as f:
            self.send(200, f.read(), TYPES.get(os.path.splitext(file)[1].lower(), "application/octet-stream"))


def main():
    parser = argparse.ArgumentParser(description="StoryZLine server (Python)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT") or 5180))
    parser.add_argument("--open", action="store_true", help="open the page in the browser")
    parser.add_argument("--proxy", default=os.environ.get("STORYZLINE_PROXY") or "auto",
                        help="auto (default), system, direct, or a proxy URL; see the top of server.py")
    args = parser.parse_args()
    global PROXY_MODE
    PROXY_MODE = args.proxy.strip()
    if PROXY_MODE not in ("auto", "system", "direct") and not re.match(r"^https?://", PROXY_MODE, re.I):
        parser.error("--proxy must be auto, system, direct or an http(s):// proxy URL")
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as e:
        print("Could not listen on port %d: %s" % (args.port, e))
        print("Another program (or StoryZLine) may already use it. Try: set PORT=5181")
        sys.exit(1)
    url = "http://127.0.0.1:%d" % args.port
    print("StoryZLine (Python) running at %s  - close this window or press Ctrl+C to stop" % url, flush=True)
    system = urllib.request.getproxies().get("https") or urllib.request.getproxies().get("http")
    shown = re.sub(r"//[^/@]*@", "//***@", PROXY_MODE)  # never print a proxy password
    print("Proxy mode: %s (Windows proxy: %s)" % (shown, system or "none"), flush=True)
    if args.open:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
