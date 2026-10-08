#!/usr/bin/env python3
"""Host approvals and read-only sandbox network tools."""
import argparse
import json
import os
from pathlib import Path
import re
import sys

from sandbox_network import exchange


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
        msg.update(private=args.allow_private)
        msg.update(host=args.host, port=args.port, connections=args.connections)
    else:
        msg['id'] = args.id
    try:
        result = exchange(named_socket(args.name, 'admin.sock'), msg)
    except ValueError as exc:
        if args.command == 'allow' and str(exc) == "'ttl'":
            raise ValueError(
                f'older network broker requires ttl; restart sandbox {args.name} '
                'from a host shell, then retry the grant'
            ) from exc
        raise
    print(json.dumps(result, indent=2))
    return 0


def agent_command(args):
    print(json.dumps(exchange(agent_socket(args.name), dict(op=args.command)), indent=2))
    return 0


def add_user_commands(commands):
    p = commands.add_parser('allow', help='host only: grant access until revoked or the session ends')
    p.set_defaults(run=user_command)
    p.add_argument('name')
    p.add_argument('--host', required=True, help='exact host or IP; permits opaque TCP traffic to --port')
    p.add_argument('--port', required=True, type=int)
    p.add_argument('--connections', type=int, help='limit new TCP connections; default unlimited')
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
