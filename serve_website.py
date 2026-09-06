"""
Zero-dependency local HTTP server for Speedtest Pro showcase website.
Serves the website with accurate binary download MIME types and launches
your default browser automatically.
"""

import os
import sys
import webbrowser
import http.server
import socketserver

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


class SafeHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Force download headers for executables
        if self.path.endswith(".exe"):
            self.send_header("Content-Type", "application/octet-stream")
            filename = os.path.basename(self.path.split("?")[0])
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (ConnectionResetError, BrokenPipeError):
            pass

    def log_message(self, format, *args):
        # Clean logging format
        print(f"[HTTP {self.log_date_time_string()}] {args[0]} {args[1]}")


def run_server(port=8080, auto_open=True):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)

    for p in [port, port + 1, port + 2, 8888, 9000]:
        try:
            class ThreadedServer(socketserver.ThreadingTCPServer):
                daemon_threads = True
                allow_reuse_address = True

            with ThreadedServer(("", p), SafeHTTPRequestHandler) as httpd:
                url = f"http://localhost:{p}"
                print("=" * 60)
                print("[SPEEDTEST PRO] SHOWCASE WEBSITE SERVER ACTIVE")
                print(f"Local URL:  {url}")
                print(f"Root Path:  {script_dir}")
                print("Downloads:  Working direct links to Setup and Portable EXEs")
                print("Press Ctrl+C to terminate the server at any time")
                print("=" * 60)

                if auto_open:
                    webbrowser.open(url)

                httpd.serve_forever()
                break
        except OSError:
            continue


if __name__ == "__main__":
    port_arg = 8080
    auto_open_flag = True
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port_arg = int(sys.argv[1])
    if "--no-browser" in sys.argv:
        auto_open_flag = False

    try:
        run_server(port=port_arg, auto_open=auto_open_flag)
    except KeyboardInterrupt:
        print("\nServer stopped gracefully.")
