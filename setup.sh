#!/usr/bin/env bash
set -euo pipefail

TOOLING=$(dirname "$(readlink -f "$0")")
source "$TOOLING/lib/links.sh"
if (($#)); then
    echo 'Usage: setup.sh' >&2
    exit 2
fi

link_home "$HOME" "$TOOLING"
echo 'Shared instructions and skills configured.'
