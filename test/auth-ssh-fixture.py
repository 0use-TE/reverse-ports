"""Optional local SSH integration fixture: pip install paramiko, then run this file.

Uses real SSH transports and loopback listeners, with disposable test credentials.
No accounts, system SSH configuration, or user known_hosts are modified.
"""
import json
import logging
import re
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import paramiko

ROOT = Path(sys.argv[1]).resolve()
ROOT.mkdir(parents=True, exist_ok=True)
logging.getLogger("paramiko").setLevel(logging.CRITICAL)
KEY = paramiko.RSAKey.generate(2048)
EVENTS = []
LOCK = threading.Lock()


def event(**data):
    with LOCK:
        EVENTS.append(data)
        (ROOT / "events.json").write_text(json.dumps(EVENTS, indent=2), encoding="utf-8")


def listener():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen()
    sock.settimeout(1)
    return sock


def relay(left, right):
    remaining = [2]
    lock = threading.Lock()
    def copy(source, destination):
        try:
            while True:
                data = source.recv(32768)
                if not data:
                    break
                destination.sendall(data)
        except (OSError, EOFError):
            pass
        finally:
            try:
                if isinstance(destination, paramiko.Channel):
                    destination.shutdown_write()
                else:
                    destination.shutdown(socket.SHUT_WR)
            except OSError:
                pass
            with lock:
                remaining[0] -= 1
                if remaining[0] == 0:
                    left.close()
                    right.close()
    threading.Thread(target=copy, args=(left, right), daemon=True).start()
    threading.Thread(target=copy, args=(right, left), daemon=True).start()


class SSHServer(paramiko.ServerInterface):
    def __init__(self, transport, role):
        self.transport = transport
        self.role = role
        self.destinations = {}
        self.forwards = {}
        self.sessions = []

    def get_allowed_auths(self, username):
        return "password"

    def check_auth_password(self, username, password):
        ok = username == self.role and password == self.role + "-test-only-password"
        event(type="authentication", role=self.role, accepted=ok)
        return paramiko.AUTH_SUCCESSFUL if ok else paramiko.AUTH_FAILED

    def check_channel_request(self, kind, chanid):
        return paramiko.OPEN_SUCCEEDED if kind == "session" else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def check_channel_direct_tcpip_request(self, chanid, origin, destination):
        if destination[0] != "127.0.0.1" or destination[1] not in SSH_PORTS:
            return paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED
        self.destinations[chanid] = destination
        event(type="jump-forward", role=self.role, port=destination[1])
        return paramiko.OPEN_SUCCEEDED

    def check_port_forward_request(self, address, port):
        if address != "127.0.0.1":
            return False
        sock = socket.socket()
        try:
            sock.bind((address, port))
            sock.listen()
            sock.settimeout(1)
        except OSError:
            sock.close()
            return False
        actual_port = sock.getsockname()[1]
        self.forwards[actual_port] = sock
        event(type="reverse-listen", role=self.role, port=actual_port)

        def accept():
            while self.transport.is_active() and self.forwards.get(actual_port) is sock:
                try:
                    client, origin = sock.accept()
                except socket.timeout:
                    continue
                except OSError:
                    break
                try:
                    channel = self.transport.open_channel("forwarded-tcpip", (address, actual_port), origin)
                    relay(client, channel)
                except Exception:
                    client.close()
            sock.close()
        threading.Thread(target=accept, daemon=True).start()
        return actual_port

    def cancel_port_forward_request(self, address, port):
        sock = self.forwards.pop(port, None)
        if sock:
            sock.close()

    def check_channel_exec_request(self, channel, command):
        match = re.fullmatch(rb"printf '(REVERSE_PORTS_READY_[a-f0-9]+)\\n'; cat", command)
        if not match:
            event(type="unexpected-command", role=self.role)
            return False
        channel.sendall(match[1] + b"\n")
        event(type="ready", role=self.role)
        return True


def handle(client, role):
    transport = paramiko.Transport(client)
    server = SSHServer(transport, role)
    try:
        transport.add_server_key(KEY)
        transport.start_server(server=server)
        while transport.is_active():
            channel = transport.accept(1)
            if channel is None:
                continue
            destination = server.destinations.pop(channel.get_id(), None)
            if destination:
                upstream = socket.create_connection(destination, timeout=5)
                upstream.settimeout(None)
                relay(channel, upstream)
            else:
                server.sessions.append(channel)
    except Exception as error:
        event(type="connection-ended", role=role, reason=type(error).__name__)
    finally:
        transport.close()
        for sock in server.forwards.values():
            sock.close()


def serve(sock, role):
    while True:
        try:
            client, _ = sock.accept()
        except socket.timeout:
            continue
        threading.Thread(target=handle, args=(client, role), daemon=True).start()


class Target(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Length", str(len(b"reverse-ports-password-e2e-ok")))
        self.end_headers()
        self.wfile.write(b"reverse-ports-password-e2e-ok")
        event(type="http-target", path=self.path)

    def log_message(self, *args):
        pass


SOCKETS = {role: listener() for role in ("destination", "jump1", "jump2")}
SSH_PORTS = {sock.getsockname()[1] for sock in SOCKETS.values()}
previous = ROOT / "fixture.json"
target_port = json.loads(previous.read_text(encoding="utf-8"))["targetPort"] if previous.exists() else 0
http = ThreadingHTTPServer(("127.0.0.1", target_port), Target)
threading.Thread(target=http.serve_forever, daemon=True).start()
known_hosts = ROOT / "known_hosts"
known_hosts.write_text("".join(f"[127.0.0.1]:{port} {KEY.get_name()} {KEY.get_base64()}\n" for port in SSH_PORTS), encoding="utf-8")
common = f'''Host *
  HostName 127.0.0.1
  UserKnownHostsFile "{known_hosts.as_posix()}"
  StrictHostKeyChecking yes
  PubkeyAuthentication no
  PreferredAuthentications password
  ControlMaster no
  ControlPath none
'''
aliases = []
for alias, role, jumps in (("rp-direct", "destination", None), ("rp-one-jump", "destination", "rp-jump1"), ("rp-two-jumps", "destination", "rp-jump1,rp-jump2"), ("rp-jump1", "jump1", None), ("rp-jump2", "jump2", None)):
    entry = f"Host {alias}\n  User {role}\n  Port {SOCKETS[role].getsockname()[1]}\n"
    if jumps:
        entry += f"  ProxyJump {jumps}\n"
    aliases.append(entry)
for first in ("rp-direct", "rp-one-jump", "rp-two-jumps"):
    config = "\n".join(sorted(aliases, key=lambda entry: not entry.startswith(f"Host {first}\n"))) + "\n" + common
    (ROOT / f"{first}.config").write_text(config, encoding="utf-8")
metadata = {"targetPort": http.server_port, "sshPorts": dict(zip(SOCKETS, (sock.getsockname()[1] for sock in SOCKETS.values())))}
(ROOT / "fixture.json").write_text(json.dumps(metadata), encoding="utf-8")
for role, sock in SOCKETS.items():
    threading.Thread(target=serve, args=(sock, role), daemon=True).start()
print(json.dumps(metadata), flush=True)
while True:
    time.sleep(1)
