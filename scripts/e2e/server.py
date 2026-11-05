#!/usr/bin/env python3
"""Tiny HTTPS static server for the e2e fixture (self-signed cert)."""
import http.server, ssl, sys, os
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixture")
cert = os.path.join(os.path.dirname(os.path.abspath(__file__)), "certs", "cert.pem")
key = os.path.join(os.path.dirname(os.path.abspath(__file__)), "certs", "key.pem")
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
os.chdir(root)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
httpd = http.server.HTTPServer(("127.0.0.1", port), Quiet)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain(cert, key)
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
httpd.serve_forever()
