#!/usr/bin/env python3
"""Host approvals and read-only sandbox network tools."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import sys

from sandbox_network import MAX_BODY, METHODS, exchange


def duration(value):
    match = re.fullmatch(r'(\d+)(s|m|h)?', value)
    if not match or int(match[1]) == 0:
        raise argparse.ArgumentTypeError('use a positive TTL such as 30s, 10m, or 1h')
    return int(match[1]) * {'s': 1, 'm': 60, 'h': 3600, None: 1}[match[2]]


def named_socket(name, filename):
    if not name or not re.fullmatch(r'[a-zA-Z0-9_.-]+', name) or name in ('.', '..'):
        raise ValueError('provide a valid sandbox name from a host shell')
    root = Path(os.environ.get('AGENT_NETWORK_ROOT', str(Path.home() / '.local/state/agent-network')))
    return root / name / filename


def agent_socket(name):
    current = os.environ.get('AGENT_SANDBOX')
    if current:
        if name is not None and name != current:
            raise ValueError('only the current sandbox is accessible')
        return Path(os.environ.get('AGENT_NETWORK_SOCKET', '/run/agent-network.sock'))
    if name is None and os.environ.get('AGENT_NETWORK_SOCKET'):
        return Path(os.environ['AGENT_NETWORK_SOCKET'])
    return named_socket(name, 'request.sock')


def user_command(args):
    if os.environ.get('AGENT_SANDBOX'):
        raise ValueError('allow and revoke must run from a host shell')
    msg = dict(op=args.command)
    if args.command == 'allow':
        msg.update(ttl=args.ttl, private=args.allow_private)
        if args.host is not None:
            if args.port is None or args.method or args.requests is not None or args.path_prefix or args.any_query:
                raise ValueError('--host requires --port and cannot use HTTP scope options')
            msg.update(host=args.host, port=args.port, connections=args.connections)
        else:
            if args.method is None or args.requests is None or args.port is not None or args.connections is not None:
                raise ValueError('--url requires --method and --requests and cannot use TCP scope options')
            msg.update(url=args.url, method=args.method, requests=args.requests,
                       prefix=args.path_prefix, any_query=args.any_query)
    else:
        msg['id'] = args.id
    print(json.dumps(exchange(named_socket(args.name, 'admin.sock'), msg), indent=2))
    return 0


def agent_command(args):
    if args.command in ('list', 'denied'):
        print(json.dumps(exchange(agent_socket(args.name), dict(op=args.command)), indent=2))
        return 0
    headers = {}
    for entry in args.header:
        key, value = entry.split(':', 1)
        headers[key.strip()] = value.strip()
    body = b''
    if args.body_file:
        with open(args.body_file, 'rb') as source:
            body = source.read(MAX_BODY + 1)
    if len(body) > MAX_BODY:
        raise ValueError('body exceeds 16 MiB')
    result = exchange(agent_socket(args.sandbox), dict(op='fetch', method=args.method, url=args.url,
                      headers=headers, body=base64.b64encode(body).decode()))
    data = base64.b64decode(result['body'])
    if args.output:
        Path(args.output).write_bytes(data)
    else:
        sys.stdout.buffer.write(data)
    print(f"HTTP {result['status']}", file=sys.stderr)
    return 0 if result['status'] < 400 else 1


def add_user_commands(commands):
    p = commands.add_parser('allow', help='host only: grant temporary access')
    p.set_defaults(run=user_command)
    p.add_argument('name')
    scope = p.add_mutually_exclusive_group(required=True)
    scope.add_argument('--url')
    scope.add_argument('--host', help='exact host or IP; permits opaque TCP traffic to --port')
    p.add_argument('--port', type=int)
    p.add_argument('--connections', type=int, help='limit new TCP connections; default unlimited during TTL')
    p.add_argument('--method', choices=sorted(METHODS))
    p.add_argument('--ttl', required=True, type=duration)
    p.add_argument('--requests', type=int)
    p.add_argument('--path-prefix', action='store_true')
    p.add_argument('--any-query', action='store_true')
    p.add_argument('--allow-private', action='store_true')
    p = commands.add_parser('revoke', help='host only: withdraw a grant')
    p.set_defaults(run=user_command)
    p.add_argument('name')
    p.add_argument('id')


def add_agent_commands(commands):
    for op, help_text in (('list', 'inspect permissions'), ('denied', 'inspect blocked attempts')):
        p = commands.add_parser(op, help=f'agent or host: {help_text}')
        p.set_defaults(run=agent_command)
        p.add_argument('name', nargs='?', help='required on the host; defaults to the current sandbox inside')
    p = commands.add_parser('http', help='agent or host: make a scoped HTTP request')
    p.set_defaults(run=agent_command)
    p.add_argument('method', choices=sorted(METHODS))
    p.add_argument('url')
    p.add_argument('--sandbox', help='sandbox name when calling from the host')
    p.add_argument('--body-file')
    p.add_argument('--header', action='append', default=[])
    p.add_argument('--output')


def main():
    parser = argparse.ArgumentParser(prog='sandbox-net', description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    add_user_commands(commands)
    add_agent_commands(commands)
    args = parser.parse_args()
    try:
        return args.run(args)
    except (OSError, ValueError, KeyError, EOFError) as exc:
        print(f'sandbox-net: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
