"""A pretend Bitbucket Server for trying StoryZLine without a real one.

Serves the files under samples/<repository>/... through the same REST paths StoryZLine
uses on Bitbucket Server. Needs only Python 3.7+ (standard library). Listens on 127.0.0.1.

    python tools/mock_bitbucket.py [--port 5199]

In StoryZLine use URL http://127.0.0.1:5199, any user ID, any password except "wrong"
(which shows a failed login), project DEMO, repository ecomm-services or enterprise-services.
"""
import argparse
import json
import os
import re
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SAMPLES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "samples")
PROJECT = "DEMO"
RAW = re.compile(r"^/rest/api/1\.0/projects/([^/]+)/repos/([^/]+)/raw/(.+)$")
BROWSE = re.compile(r"^/rest/api/1\.0/projects/([^/]+)/repos/([^/]+)/browse(?:/(.*))?$")


class Handler(BaseHTTPRequestHandler):
    server_version = "MockBitbucket"

    def send(self, status, body, content_type="text/plain"):
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        print("  %s %s" % (self.command, urllib.parse.unquote(self.path)), flush=True)

    def logged_in(self):
        """Any user ID and password, except the password "wrong"."""
        auth = self.headers.get("Authorization") or ""
        if auth.startswith("Basic "):
            import base64
            try:
                user, _, password = base64.b64decode(auth[6:]).decode("utf-8").partition(":")
            except ValueError:
                return False
            return bool(user) and password != "wrong"
        return auth.startswith("Bearer ") and auth[7:] != "wrong"

    def do_GET(self):
        if not self.logged_in():
            return self.send(401, "Authentication required")
        split = urllib.parse.urlsplit(self.path)
        path = split.path
        if path == "/rest/api/1.0/projects":  # StoryZLine's login check
            return self.send(200, json.dumps({"values": [{"key": PROJECT, "name": "Demo"}]}), "application/json")
        m = BROWSE.match(path)
        if m:
            return self.list_folder(m, urllib.parse.parse_qs(split.query))
        m = RAW.match(path)
        if not m:
            return self.send(404, "Not found")
        project, repo, file_path = (urllib.parse.unquote(g) for g in m.groups())
        file = os.path.normpath(os.path.join(SAMPLES, repo, file_path))
        if project != PROJECT or not file.startswith(os.path.join(SAMPLES, repo) + os.sep) or not os.path.isfile(file):
            return self.send(404, "File not found: %s/%s/%s" % (project, repo, file_path))
        with open(file, "rb") as f:  # byte for byte, as Bitbucket serves raw files
            self.send(200, f.read().decode("utf-8"))

    def list_folder(self, m, query):
        """A folder's entries, as Bitbucket Server's browse REST API pages them (?limit=&start=)."""
        project, repo = urllib.parse.unquote(m.group(1)), urllib.parse.unquote(m.group(2))
        folder = urllib.parse.unquote(m.group(3) or "").strip("/")
        root = os.path.join(SAMPLES, repo)
        d = os.path.normpath(os.path.join(root, folder))
        if project != PROJECT or not (d == root or d.startswith(root + os.sep)) or not os.path.isdir(d):
            return self.send(404, json.dumps({"errors": [{"message": "Folder not found: %s" % folder}]}), "application/json")
        limit = max(1, min(1000, int((query.get("limit") or ["25"])[0])))
        start = max(0, int((query.get("start") or ["0"])[0]))
        names = sorted(os.listdir(d))
        values = [{"path": {"name": n, "toString": n}, "type": "DIRECTORY" if os.path.isdir(os.path.join(d, n)) else "FILE"}
                  for n in names[start:start + limit]]
        page = {"size": len(values), "limit": limit, "start": start, "isLastPage": start + limit >= len(names), "values": values}
        if not page["isLastPage"]:
            page["nextPageStart"] = start + limit
        self.send(200, json.dumps({"path": {"toString": folder}, "children": page}), "application/json")


def main():
    parser = argparse.ArgumentParser(description="Pretend Bitbucket Server for StoryZLine demos")
    parser.add_argument("--port", type=int, default=5199)
    args = parser.parse_args()
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as e:
        print("Could not listen on port %d: %s" % (args.port, e))
        sys.exit(1)
    repos = sorted(d for d in os.listdir(SAMPLES) if os.path.isdir(os.path.join(SAMPLES, d)))
    print("Mock Bitbucket at http://127.0.0.1:%d  (project %s; repositories: %s)" % (args.port, PROJECT, ", ".join(repos)), flush=True)
    print("Any user ID; any password except 'wrong'. Ctrl+C to stop.", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
