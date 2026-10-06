#!/usr/bin/env python3
"""Route an isolated loopback-only network through the host broker."""
import argparse
import ipaddress
from pathlib import Path
import re
import signal
import socket
import socketserver
import struct
import subprocess
import sys
import tempfile
import threading

from sandbox_network import bridge, hostname, read_exact, receive, send, unix_connect

DNS_ADDRESS = '127.0.0.53'


class TunnelHandler(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            with unix_connect(self.server.gateway) as upstream:
                send(upstream, dict(op='tunnel', host=self.server.host, port=self.server.server_address[1]))
                if receive(upstream).get('ok'):
                    bridge(self.request, upstream)
        except (OSError, ValueError, EOFError):
            pass


class TunnelServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def server_bind(self):
        if self.address_family == socket.AF_INET6:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        super().server_bind()


class Router:
    def __init__(self, gateway):
        self.gateway = gateway
        self.names = {}
        self.listeners = {}
        self.lock = threading.Lock()
        self.stopped = threading.Event()
        self.ready = threading.Event()
        self.error = None

    def install(self, endpoints):
        with self.lock:
            targets = {}
            for endpoint in endpoints:
                host, port = endpoint['host'], endpoint['port']
                try:
                    address = str(ipaddress.ip_address(host))
                except ValueError:
                    if host not in self.names:
                        # Keep names separate even when they share an upstream IP.
                        if len(self.names) >= 65534:
                            raise ValueError('too many routed hostnames')
                        self.names[host] = str(ipaddress.IPv4Address('198.18.0.1') + len(self.names))
                    address = self.names[host]
                addresses = [address]
                if host == 'localhost':
                    addresses += ['127.0.0.1', '::1']
                for address in addresses:
                    key = address, port
                    if key not in targets or host == address:
                        targets[key] = host
            for key, host in targets.items():
                if key in self.listeners:
                    self.listeners[key].host = host
                else:
                    server = TunnelServer.__new__(TunnelServer)
                    server.address_family = socket.AF_INET6 if ':' in key[0] else socket.AF_INET
                    server.gateway, server.host = self.gateway, host
                    TunnelServer.__init__(server, key, TunnelHandler)
                    self.listeners[key] = server
                    threading.Thread(target=server.serve_forever, daemon=True).start()

    def refresh(self):
        try:
            with unix_connect(self.gateway) as connection:
                send(connection, dict(op='watch'))
                while not self.stopped.is_set():
                    snapshot = receive(connection)
                    self.install(snapshot['endpoints'])
                    send(connection, dict(ready=snapshot['revision']))
                    self.ready.set()
        except (OSError, ValueError, EOFError) as exc:
            self.error = exc
            self.ready.set()
            print(f'sandbox-routing: {exc}', file=sys.stderr)

    def answer(self, packet):
        if len(packet) < 12:
            raise ValueError('short DNS packet')
        ident, flags, questions, _, _, _ = struct.unpack('!6H', packet[:12])
        if questions != 1 or flags & 0xf800:
            raise ValueError('expected one standard DNS question')
        offset, labels = 12, []
        while True:
            if offset >= len(packet):
                raise ValueError('short DNS name')
            size = packet[offset]
            offset += 1
            if not size:
                break
            if size > 63 or offset + size > len(packet):
                raise ValueError('invalid DNS label')
            labels.append(packet[offset:offset + size].decode('ascii'))
            offset += size
        if offset + 4 > len(packet):
            raise ValueError('short DNS question')
        host = hostname('.'.join(labels))
        kind, cls = struct.unpack('!HH', packet[offset:offset + 4])
        question = packet[12:offset + 4]
        with self.lock:
            address = self.names.get(host)
        # An old address stays stable after revoke. Its TCP listener still asks
        # the broker for permission on each connection.
        answer = b''
        if address and kind == 1 and cls == 1:
            answer = b'\xc0\x0c' + struct.pack('!HHIH', 1, 1, 1, 4) + socket.inet_aton(address)
        return struct.pack('!6H', ident, 0x8080 | (flags & 0x0100) | (0 if address else 3),
                           1, bool(answer), 0, 0) + question + answer

    def close(self):
        self.stopped.set()
        for server in self.listeners.values():
            server.shutdown()
            server.server_close()


class DNSDatagram(socketserver.BaseRequestHandler):
    def handle(self):
        packet, sock = self.request
        try:
            sock.sendto(self.server.router.answer(packet), self.client_address)
        except (OSError, ValueError, EOFError, UnicodeError):
            pass


class DNSStream(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(5)
        try:
            while True:
                size, = struct.unpack('!H', read_exact(self.request, 2))
                answer = self.server.router.answer(read_exact(self.request, size))
                self.request.sendall(struct.pack('!H', len(answer)) + answer)
        except (OSError, ValueError, EOFError, UnicodeError):
            pass


class DNSUDPServer(socketserver.ThreadingUDPServer):
    daemon_threads = True


class DNSTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def run(args):
    # This runs as root only in an outer user namespace. The nested agent user
    # namespace cannot administer this network, and no host interface is added.
    subprocess.run(['ip', 'link', 'set', 'lo', 'up'], check=True)
    subprocess.run(['ip', 'route', 'add', 'local', '0.0.0.0/0', 'dev', 'lo', 'table', 'local'], check=True)
    subprocess.run(['ip', '-6', 'route', 'add', 'local', '::/0', 'dev', 'lo', 'table', 'local'], check=True)
    router = Router(args.socket)
    servers = []
    child = None
    refresh = None
    try:
        for cls, handler in ((DNSUDPServer, DNSDatagram), (DNSTCPServer, DNSStream)):
            server = cls((DNS_ADDRESS, 53), handler)
            server.router = router
            servers.append(server)
            threading.Thread(target=server.serve_forever, daemon=True).start()
        refresh = threading.Thread(target=router.refresh, daemon=True)
        refresh.start()
        if not router.ready.wait(5) or router.error:
            raise ValueError(f'network routing did not become ready: {router.error}')
        command = args.command
        if command and command[0] == '--':
            command = command[1:]
        if not command or command[0] != 'bwrap':
            raise ValueError('expected a Bubblewrap command')
        with tempfile.TemporaryFile() as resolver, tempfile.TemporaryFile() as hosts, tempfile.TemporaryFile() as nss:
            resolver.write(f'nameserver {DNS_ADDRESS}\noptions timeout:1 attempts:1\n'.encode())
            resolver.seek(0)
            hosts.write(b'127.0.0.1 localhost\n::1 localhost\n')
            hosts.seek(0)
            configuration = Path('/etc/nsswitch.conf').read_text()
            configuration = re.sub(r'^hosts:.*$', 'hosts: files dns', configuration, flags=re.MULTILINE)
            nss.write(configuration.encode())
            nss.seek(0)
            index = command.index('--')
            command[index:index] = ['--ro-bind-data', str(resolver.fileno()), '/etc/resolv.conf',
                                    '--ro-bind-data', str(hosts.fileno()), '/etc/hosts',
                                    '--ro-bind-data', str(nss.fileno()), '/etc/nsswitch.conf']
            def stop(signum, frame):
                if child is not None:
                    child.send_signal(signum)
            for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
                signal.signal(sig, stop)
            child = subprocess.Popen(command, pass_fds=(resolver.fileno(), hosts.fileno(), nss.fileno()))
            while True:
                if router.error:
                    raise ValueError(f'network routing failed: {router.error}')
                try:
                    return child.wait(timeout=.2)
                except subprocess.TimeoutExpired:
                    pass
    finally:
        if child is not None and child.poll() is None:
            child.terminate()
            child.wait()
        router.stopped.set()
        if refresh is not None:
            refresh.join(timeout=5)
        for server in servers:
            server.shutdown()
            server.server_close()
        router.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--socket', required=True)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    try:
        status = run(parser.parse_args())
        raise SystemExit(status if status >= 0 else 128 - status)
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f'sandbox-routing: {exc}\n')
