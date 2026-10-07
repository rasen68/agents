#!/usr/bin/env python3
"""Host network broker and sandbox proxy relay."""
import argparse
import collections
import fcntl
import http.server
import ipaddress
import json
import os
from pathlib import Path
import re
import select
import signal
import socket
import socketserver
import struct
import subprocess
import sys
import threading
import time
import urllib.parse
import uuid

MAX_FRAME = 24 * 1024 * 1024


def hostname(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-zA-Z0-9.-]+', value):
        raise ValueError('expected an exact DNS hostname')
    value = value.lower()
    if len(value) > 253 or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label)
                               for label in value.split('.')):
        raise ValueError('invalid hostname')
    return value


def endpoint_host(value):
    if not isinstance(value, str):
        raise ValueError('expected an exact DNS hostname or IP address')
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return hostname(value)


class Policy:
    def __init__(self, providers, routing_required=False):
        self.providers = {hostname(h) for h in providers}
        self.grants = {}
        self.denials = collections.deque(maxlen=100)
        self.lock = threading.Lock()
        self.changed = threading.Condition(self.lock)
        self.revision = 0
        self.routers = {}
        self.routing_required = routing_required

    def add_host(self, host, port, connections, private):
        host = endpoint_host(host)
        if type(port) is not int or not 1 <= port <= 65535:
            raise ValueError('port must be between 1 and 65535')
        if connections is not None and (type(connections) is not int or connections <= 0):
            raise ValueError('positive connection count required')
        if type(private) is not bool:
            raise ValueError('private flag must be a boolean')
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            address = None
        if address is not None and (address.is_unspecified
                or isinstance(address, ipaddress.IPv6Address) and (address.ipv4_mapped or address.scope_id)):
            raise ValueError('unspecified, IPv4-mapped, and scoped IP addresses are not supported')
        if (isinstance(address, ipaddress.IPv4Address) and address in ipaddress.ip_network('198.18.0.0/15')
                or host == '127.0.0.53' and port == 53):
            raise ValueError('destination is reserved for sandbox DNS routing')
        grant = dict(id=uuid.uuid4().hex[:12], kind='host', host=host, port=port,
                     remaining=connections, private=private)
        with self.lock:
            self.grants[grant['id']] = grant
            self.revision += 1
            self.changed.notify_all()
        return grant.copy()

    def provider_allowed(self, host, port):
        return host in self.providers and port == 443

    def endpoints(self):
        with self.lock:
            return self._endpoints()

    def _endpoints(self):
        endpoints = {(host, 443) for host in self.providers}
        endpoints.update((g['host'], g['port']) for g in self.grants.values()
                         if g['remaining'] is None or g['remaining'] > 0)
        return [dict(host=host, port=port) for host, port in sorted(endpoints)]

    def wait_for_routes(self):
        with self.changed:
            revision = self.revision
            def ready():
                return ((bool(self.routers) or not self.routing_required)
                        and all(r >= revision for r in self.routers.values()))
            if not self.changed.wait_for(ready, timeout=5):
                raise ValueError('grant recorded, but network routing did not become ready')

    def authorize_tunnel(self, host, port, private, consume=True):
        with self.lock:
            if self.provider_allowed(host, port) and not private:
                return 'provider'
            for g in self.grants.values():
                if (g['host'] == host and g['port'] == port
                        and (g['remaining'] is None or g['remaining'] > 0)
                        and (not private or g['private'])):
                    if consume and g['remaining'] is not None:
                        g['remaining'] -= 1
                    return g['id']
            self.denials.append(dict(time=time.time(), method='CONNECT',
                                     url=f'{host}:{port}', private=private))
            return None

    def inspect(self, op):
        with self.lock:
            if op == 'list':
                return dict(providers=sorted(self.providers), grants=[
                    g.copy() for g in self.grants.values()])
            if op == 'denied':
                return list(self.denials)
        raise ValueError('unknown inspection operation')

    def admin(self, msg):
        op = msg['op']
        if op == 'allow':
            return self.add_host(msg['host'], msg['port'],
                                 msg.get('connections'), msg['private'])
        with self.lock:
            if op == 'revoke':
                revoked = self.grants.pop(msg['id'], None) is not None
                self.revision += 1
                self.changed.notify_all()
                return dict(revoked=revoked)
        raise ValueError('unknown administration operation')


def resolve(host, port):
    addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    if not addresses:
        raise ValueError('no DNS addresses')
    private = any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses)
    return addresses, private


def connect_pinned(addresses):
    last = None
    for family, kind, proto, _, address in addresses:
        s = socket.socket(family, kind, proto)
        s.settimeout(30)
        try:
            s.connect(address)
            return s
        except OSError as e:
            last = e
            s.close()
    raise last


def send(sock, obj):
    data = json.dumps(obj, separators=(',', ':')).encode()
    if len(data) > MAX_FRAME:
        raise ValueError('frame too large')
    sock.sendall(struct.pack('!I', len(data)) + data)


def read_exact(sock, size):
    data = bytearray()
    while len(data) < size:
        chunk = sock.recv(min(size - len(data), 65536))
        if not chunk:
            raise EOFError('connection closed')
        data.extend(chunk)
    return data


def receive(sock):
    size, = struct.unpack('!I', read_exact(sock, 4))
    if size > MAX_FRAME:
        raise ValueError('frame too large')
    result = json.loads(read_exact(sock, size))
    if not isinstance(result, dict):
        raise ValueError('expected JSON object')
    return result


def bridge(left, right):
    left.settimeout(60)
    right.settimeout(60)
    readers = {left, right}
    while readers:
        ready, _, _ = select.select(list(readers), [], [], 300)
        if not ready:
            return
        for source in ready:
            data = source.recv(65536)
            destination = right if source is left else left
            if not data:
                readers.remove(source)
                try:
                    destination.shutdown(socket.SHUT_WR)
                except OSError:
                    pass
            else:
                destination.sendall(data)


class GatewayHandler(socketserver.BaseRequestHandler):
    def watch(self):
        policy, token = self.server.policy, object()
        with policy.changed:
            policy.routers[token] = -1
        try:
            while True:
                with policy.changed:
                    policy.changed.wait_for(lambda: policy.revision > policy.routers[token], timeout=1)
                    revision, endpoints = policy.revision, policy._endpoints()
                send(self.request, dict(revision=revision, endpoints=endpoints))
                if receive(self.request) != {'ready': revision}:
                    raise ValueError('invalid routing acknowledgement')
                with policy.changed:
                    policy.routers[token] = revision
                    policy.changed.notify_all()
        finally:
            with policy.changed:
                del policy.routers[token]
                policy.changed.notify_all()

    def handle(self):
        self.request.settimeout(30)
        switched = False
        try:
            msg = receive(self.request)
            if self.server.admin:
                result = self.server.policy.admin(msg)
                if msg['op'] == 'allow':
                    self.server.policy.wait_for_routes()
            elif msg.get('op') == 'watch' and self.server.routing:
                switched = True
                self.watch()
                return
            elif msg.get('op') in ('list', 'denied'):
                result = self.server.policy.inspect(msg['op'])
            elif msg.get('op') == 'endpoints':
                result = self.server.policy.endpoints()
            elif msg.get('op') == 'tunnel':
                host, port = endpoint_host(msg['host']), msg['port']
                if type(port) is not int or not 1 <= port <= 65535:
                    raise ValueError('invalid port')
                if not self.server.policy.authorize_tunnel(host, port, False, consume=False):
                    raise PermissionError('host tunnel denied')
                addresses, private = resolve(host, port)
                if not self.server.policy.authorize_tunnel(host, port, private):
                    raise PermissionError('host tunnel denied, including private destination policy')
                with connect_pinned(addresses) as upstream:
                    send(self.request, dict(ok=True))
                    switched = True
                    bridge(self.request, upstream)
                return
            else:
                raise ValueError('unknown request operation')
            send(self.request, dict(ok=True, result=result))
        except (OSError, ValueError, KeyError, TypeError, EOFError) as e:
            if not switched:
                try:
                    send(self.request, dict(ok=False, error=str(e)))
                except OSError:
                    pass


class UnixServer(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True

    def __init__(self, path, policy, admin, routing=False):
        self.policy, self.admin = policy, admin
        self.routing = routing
        super().__init__(str(path), GatewayHandler)


def secure_directory(path):
    path = Path(path).absolute()
    if str(path) != os.path.realpath(path):
        raise ValueError('network directory must not use symlinks')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    stat = path.stat()
    if stat.st_uid != os.getuid() or stat.st_mode & 0o777 != 0o700:
        raise ValueError('network directory must be owned by you with mode 700')
    return path


def serve(args):
    runtime = secure_directory(args.runtime)
    with open(runtime / 'lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        policy = Policy(args.provider, routing_required=True)
        servers = []
        try:
            for admin, name in [(False, 'request.sock'), (True, 'admin.sock'), (False, 'route.sock')]:
                path = runtime / name
                path.unlink(missing_ok=True)
                server = UnixServer(path, policy, admin, routing=name == 'route.sock')
                os.chmod(path, 0o600)
                servers.append(server)
                threading.Thread(target=server.serve_forever, daemon=True).start()
            def stop(signum, frame):
                raise KeyboardInterrupt
            for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
                signal.signal(sig, stop)
            print('ready', flush=True)
            while True:
                signal.pause()
        except KeyboardInterrupt:
            pass
        finally:
            for server in servers:
                server.shutdown()
                server.server_close()
            for name in ('request.sock', 'admin.sock', 'route.sock'):
                (runtime / name).unlink(missing_ok=True)


def unix_connect(path):
    sock = socket.socket(socket.AF_UNIX)
    sock.settimeout(60)
    try:
        sock.connect(str(path))
        return sock
    except BaseException:
        sock.close()
        raise


def exchange(path, msg):
    with unix_connect(path) as s:
        send(s, msg)
        response = receive(s)
    if not response.get('ok'):
        raise ValueError(response.get('error', 'gateway error'))
    return response.get('result')


class ProxyHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    rbufsize = 0

    def __getattr__(self, name):
        # HTTP dispatch uses do_* attributes. Host grants allow custom methods.
        if name.startswith('do_'):
            return self.do_GET
        raise AttributeError(name)

    def do_CONNECT(self):
        self.connection.settimeout(30)
        try:
            host, port = self.path.rsplit(':', 1)
            host = host.strip('[]')
            with unix_connect(self.server.gateway) as upstream:
                send(upstream, dict(op='tunnel', host=host, port=int(port)))
                response = receive(upstream)
                if not response.get('ok'):
                    self.send_error(403, 'Host tunnel denied')
                    return
                self.send_response(200, 'Connection established')
                self.end_headers()
                self.wfile.flush()
                bridge(self.connection, upstream)
        except (OSError, ValueError, EOFError):
            self.close_connection = True
        self.close_connection = True

    def do_GET(self):
        self.close_connection = True
        try:
            if any(ord(c) <= 32 or ord(c) >= 127 for c in self.path):
                raise ValueError('invalid proxy URL')
            u = urllib.parse.urlsplit(self.path)
            if u.scheme != 'http' or not u.hostname or u.username is not None or u.fragment:
                raise ValueError('expected HTTP proxy URL without credentials or fragment')
            host = endpoint_host(u.hostname)
            port = u.port if u.port is not None else 80
            if not 1 <= port <= 65535 or '\\' in u.netloc:
                raise ValueError('invalid proxy destination')
            with unix_connect(self.server.gateway) as upstream:
                send(upstream, dict(op='tunnel', host=host, port=port))
                response = receive(upstream)
                if not response.get('ok'):
                    self.send_error(403, 'Host tunnel denied')
                    return
                target = (u.path or '/') + ('?' + u.query if u.query else '')
                headers = ''.join(f'{key}: {value}\r\n' for key, value in self.headers.items()
                                  if key.lower() not in ('host', 'connection', 'proxy-connection', 'proxy-authorization'))
                upstream.sendall((f'{self.command} {target} {self.request_version}\r\n'
                                  f'Host: {u.netloc}\r\n{headers}Connection: close\r\n\r\n').encode('latin-1'))
                bridge(self.connection, upstream)
        except (OSError, ValueError, EOFError):
            self.close_connection = True
    do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = do_OPTIONS = do_GET

    def log_message(self, *args):
        pass


class ProxyServer(http.server.ThreadingHTTPServer):
    daemon_threads = True


def relay(args):
    command = args.command
    if command and command[0] == '--':
        command = command[1:]
    if not command:
        raise ValueError('relay needs a command')
    with ProxyServer(('127.0.0.1', 0), ProxyHandler) as server:
        server.gateway = args.socket
        threading.Thread(target=server.serve_forever, daemon=True).start()
        env = os.environ.copy()
        proxy = f'http://127.0.0.1:{server.server_port}'
        for key in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'):
            env[key] = proxy
        env['NO_PROXY'] = env['no_proxy'] = ''
        env['NODE_USE_ENV_PROXY'] = '1'
        child = subprocess.Popen(command, env=env)
        def forward(signum, frame):
            child.send_signal(signum)
        for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            signal.signal(sig, forward)
        try:
            return child.wait()
        finally:
            if child.poll() is None:
                child.terminate()
                child.wait()
            server.shutdown()



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command_name', required=True)
    p = commands.add_parser('serve')
    p.add_argument('--runtime', required=True)
    p.add_argument('--provider', action='append', default=[])
    p = commands.add_parser('relay')
    p.add_argument('--socket', required=True)
    p.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    try:
        if args.command_name == 'serve':
            serve(args)
            return 0
        status = relay(args)
        return status if status >= 0 else 128 - status
    except (OSError, ValueError, KeyError, EOFError) as exc:
        print(f'sandbox-network: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
