#!/usr/bin/env python3
"""Host network broker, host administration CLI, and sandbox transport adapters."""
import argparse
import base64
import collections
import fcntl
import http.client
import http.server
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import select
import signal
import socket
import socketserver
import ssl
import struct
import subprocess
import sys
import threading
import time
import urllib.parse
import uuid

MAX_BODY = 16 * 1024 * 1024
MAX_FRAME = 24 * 1024 * 1024
METHODS = {'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'}


def hostname(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-zA-Z0-9.-]+', value):
        raise ValueError('expected an exact DNS hostname')
    value = value.lower()
    if len(value) > 253 or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label)
                               for label in value.split('.')):
        raise ValueError('invalid hostname')
    return value


def parse_url(value):
    if not isinstance(value, str) or any(ord(c) <= 32 or ord(c) >= 127 for c in value):
        raise ValueError('URL must be ASCII without whitespace or control characters')
    u = urllib.parse.urlsplit(value)
    if u.scheme not in ('http', 'https') or not u.hostname or u.username is not None or '#' in value:
        raise ValueError('expected HTTP(S) URL without credentials or fragment')
    host = u.hostname.lower()
    try:
        ipaddress.ip_address(host)
    except ValueError:
        hostname(host)
    port = u.port if u.port is not None else (443 if u.scheme == 'https' else 80)
    if not 1 <= port <= 65535:
        raise ValueError('invalid port')
    path = u.path or '/'
    # Reject routing ambiguity rather than guess how an upstream decodes it.
    if '\\' in value or re.search(r'%(?![0-9a-fA-F]{2})', value):
        raise ValueError('invalid URL escape')
    decoded = urllib.parse.unquote(path)
    if ('%' in decoded or '\\' in decoded or any(ord(c) < 32 or ord(c) == 127 for c in decoded)
            or re.search(r'%2f', path, re.I) or any(p in ('.', '..') for p in decoded.split('/'))):
        raise ValueError('ambiguous URL path')
    authority = f'[{host}]' if ':' in host else host
    if port != (443 if u.scheme == 'https' else 80):
        authority += f':{port}'
    return urllib.parse.urlsplit(urllib.parse.urlunsplit((u.scheme, authority, path, u.query, '')))


def origin(u):
    return u.scheme, u.hostname, u.port or (443 if u.scheme == 'https' else 80)


class Policy:
    def __init__(self, providers):
        self.providers = {hostname(h) for h in providers}
        self.grants = {}
        self.denials = collections.deque(maxlen=100)
        self.lock = threading.Lock()

    def add(self, url, method, ttl, requests, prefix, any_query, private):
        u = parse_url(url)
        if method not in METHODS or not isinstance(ttl, (float, int)) or not math.isfinite(ttl) or ttl <= 0:
            raise ValueError('method and positive finite TTL required')
        if type(requests) is not int or requests <= 0:
            raise ValueError('positive finite request count required')
        if any(type(v) is not bool for v in (prefix, any_query, private)):
            raise ValueError('scope flags must be booleans')
        grant = dict(id=uuid.uuid4().hex[:12], url=u.geturl(), method=method,
                     expires=time.time() + ttl, remaining=requests, prefix=prefix,
                     any_query=any_query, private=private)
        grant['_deadline'] = time.monotonic() + ttl
        with self.lock:
            self.grants[grant['id']] = grant
        return {k: v for k, v in grant.items() if not k.startswith('_')}

    def matching(self, method, u, private):
        for g in self.grants.values():
            allowed = parse_url(g['url'])
            path_ok = u.path == allowed.path or (g['prefix'] and u.path.startswith(allowed.path.rstrip('/') + '/'))
            if (g['_deadline'] > time.monotonic() and g['remaining'] > 0 and g['method'] == method
                    and origin(allowed) == origin(u) and path_ok
                    and (g['any_query'] or u.query == allowed.query) and (not private or g['private'])):
                return g
        return None

    def authorize(self, method, u, private):
        with self.lock:
            grant = self.matching(method, u, private)
            if grant:
                grant['remaining'] -= 1
                return grant['id']
            self.denials.append(dict(time=time.time(), method=method, url=u.geturl(), private=private))
            return None

    def provider_allowed(self, host, port):
        return host in self.providers and port == 443

    def admin(self, msg):
        op = msg['op']
        if op == 'allow':
            return self.add(msg['url'], msg['method'], msg['ttl'], msg['requests'],
                            msg['prefix'], msg['any_query'], msg['private'])
        with self.lock:
            if op == 'list':
                return dict(providers=sorted(self.providers), grants=[
                    {k: v for k, v in g.items() if not k.startswith('_')} for g in self.grants.values()])
            if op == 'denied':
                return list(self.denials)
            if op == 'revoke':
                return dict(revoked=self.grants.pop(msg['id'], None) is not None)
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


def fetch(policy, msg):
    u = parse_url(msg['url'])
    method = msg['method']
    if method not in METHODS:
        raise ValueError('unsupported method')
    body = base64.b64decode(msg.get('body', ''), validate=True)
    if len(body) > MAX_BODY:
        raise ValueError('body exceeds 16 MiB')
    headers = msg.get('headers', {})
    if not isinstance(headers, dict):
        raise ValueError('headers must be an object')
    forbidden = {'host', 'connection', 'proxy-connection', 'proxy-authorization', 'transfer-encoding',
                 'content-length', 'upgrade', 'te', 'trailer', 'expect'}
    for key, value in headers.items():
        if (not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", key) or key.lower() in forbidden
                or not isinstance(value, str) or any(ord(c) < 32 or ord(c) > 126 for c in value)):
            raise ValueError('invalid or reserved HTTP header')
    # Do not perform DNS work for a request without a matching scope.
    with policy.lock:
        candidate = policy.matching(method, u, False)
    if not candidate:
        policy.authorize(method, u, False)
        raise PermissionError('request denied; ask host for a scoped sandbox-net allow grant')
    addresses, private = resolve(u.hostname, origin(u)[2])
    if not policy.authorize(method, u, private):
        raise PermissionError('request denied, including private destination policy')
    conn = http.client.HTTPConnection(u.hostname, origin(u)[2], timeout=30)
    conn.sock = connect_pinned(addresses)
    try:
        if u.scheme == 'https':
            conn.sock = ssl.create_default_context().wrap_socket(conn.sock, server_hostname=u.hostname)
        target = u.path + ('?' + u.query if u.query else '')
        conn.request(method, target, body=body, headers=headers)
        response = conn.getresponse()
        data = response.read(MAX_BODY + 1)
        if len(data) > MAX_BODY:
            raise ValueError('response exceeds 16 MiB')
        return dict(status=response.status, headers=response.getheaders(), body=base64.b64encode(data).decode())
    finally:
        conn.close()


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
    while True:
        ready, _, _ = select.select([left, right], [], [], 300)
        if not ready:
            return
        for source in ready:
            data = source.recv(65536)
            if not data:
                return
            (right if source is left else left).sendall(data)


class GatewayHandler(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(30)
        switched = False
        try:
            msg = receive(self.request)
            if self.server.admin:
                result = self.server.policy.admin(msg)
            elif msg.get('op') == 'fetch':
                result = fetch(self.server.policy, msg)
            elif msg.get('op') == 'tunnel':
                host, port = hostname(msg['host']), msg['port']
                if not self.server.policy.provider_allowed(host, port):
                    with self.server.policy.lock:
                        self.server.policy.denials.append(dict(time=time.time(), method='CONNECT', url=f'{host}:{port}'))
                    raise PermissionError('provider tunnel denied')
                addresses, private = resolve(host, port)
                if private:
                    raise PermissionError('provider resolves to a non-public address')
                with connect_pinned(addresses) as upstream:
                    send(self.request, dict(ok=True))
                    switched = True
                    bridge(self.request, upstream)
                return
            else:
                raise ValueError('unknown request operation')
            send(self.request, dict(ok=True, result=result))
        except (OSError, ValueError, KeyError, TypeError, EOFError, http.client.HTTPException) as e:
            if not switched:
                try:
                    send(self.request, dict(ok=False, error=str(e)))
                except OSError:
                    pass


class UnixServer(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True

    def __init__(self, path, policy, admin):
        self.policy, self.admin = policy, admin
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
        policy = Policy(args.provider)
        servers = []
        try:
            for admin, name in [(False, 'request.sock'), (True, 'admin.sock')]:
                path = runtime / name
                path.unlink(missing_ok=True)
                server = UnixServer(path, policy, admin)
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
            for name in ('request.sock', 'admin.sock'):
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
    def do_CONNECT(self):
        self.connection.settimeout(30)
        try:
            host, port = self.path.rsplit(':', 1)
            with unix_connect(self.server.gateway) as upstream:
                send(upstream, dict(op='tunnel', host=host, port=int(port)))
                response = receive(upstream)
                if not response.get('ok'):
                    self.send_error(403, 'Provider tunnel denied')
                    return
                self.send_response(200, 'Connection established')
                self.end_headers()
                self.wfile.flush()
                bridge(self.connection, upstream)
        except (OSError, ValueError, EOFError):
            self.close_connection = True
        self.close_connection = True

    def do_GET(self):
        self.send_error(403, 'Use sandbox-http for scoped HTTP requests')
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


def duration(value):
    match = re.fullmatch(r'(\d+)(s|m|h)?', value)
    if not match or int(match[1]) == 0:
        raise argparse.ArgumentTypeError('use a positive TTL such as 30s, 10m, or 1h')
    return int(match[1]) * {'s': 1, 'm': 60, 'h': 3600, None: 1}[match[2]]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command_name', required=True)
    p = commands.add_parser('serve')
    p.add_argument('--runtime', required=True)
    p.add_argument('--provider', action='append', default=[])
    p = commands.add_parser('relay')
    p.add_argument('--socket', required=True)
    p.add_argument('command', nargs=argparse.REMAINDER)
    for op in ('allow', 'list', 'revoke', 'denied'):
        p = commands.add_parser(op)
        p.add_argument('name')
        if op == 'allow':
            p.add_argument('--url', required=True)
            p.add_argument('--method', required=True, choices=sorted(METHODS))
            p.add_argument('--ttl', required=True, type=duration)
            p.add_argument('--requests', required=True, type=int)
            p.add_argument('--path-prefix', action='store_true')
            p.add_argument('--any-query', action='store_true')
            p.add_argument('--allow-private', action='store_true')
        if op == 'revoke':
            p.add_argument('id')
    p = commands.add_parser('http')
    p.add_argument('method', choices=sorted(METHODS))
    p.add_argument('url')
    p.add_argument('--body-file')
    p.add_argument('--header', action='append', default=[])
    p.add_argument('--output')
    args = parser.parse_args()
    try:
        if args.command_name == 'serve':
            serve(args)
        elif args.command_name == 'relay':
            status = relay(args)
            return status if status >= 0 else 128 - status
        elif args.command_name == 'http':
            headers = {}
            for entry in args.header:
                key, value = entry.split(':', 1)
                headers[key.strip()] = value.strip()
            body = b''
            if args.body_file:
                with open(args.body_file, 'rb') as f:
                    body = f.read(MAX_BODY + 1)
            if len(body) > MAX_BODY:
                raise ValueError('body exceeds 16 MiB')
            result = exchange(os.environ.get('AGENT_NETWORK_SOCKET', '/run/agent-network.sock'),
                              dict(op='fetch', method=args.method, url=args.url,
                                   headers=headers, body=base64.b64encode(body).decode()))
            data = base64.b64decode(result['body'])
            if args.output:
                Path(args.output).write_bytes(data)
            else:
                sys.stdout.buffer.write(data)
            print(f"HTTP {result['status']}", file=sys.stderr)
            return 0 if result['status'] < 400 else 1
        else:
            if not re.fullmatch(r'[a-zA-Z0-9_.-]+', args.name) or args.name in ('.', '..'):
                raise ValueError('invalid sandbox name')
            root = Path(os.environ.get('AGENT_NETWORK_ROOT', str(Path.home() / '.local/state/agent-network')))
            msg = dict(op=args.command_name)
            if args.command_name == 'allow':
                msg.update(url=args.url, method=args.method, ttl=args.ttl, requests=args.requests,
                           prefix=args.path_prefix, any_query=args.any_query, private=args.allow_private)
            if args.command_name == 'revoke':
                msg['id'] = args.id
            print(json.dumps(exchange(root / args.name / 'admin.sock', msg), indent=2))
        return 0
    except (OSError, ValueError, KeyError, EOFError) as e:
        print(f'sandbox-network: {e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
