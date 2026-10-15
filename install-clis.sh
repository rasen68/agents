#!/usr/bin/env bash

# Install Claude Code
if [[ -z $( command -v claude ) ]]; then
	echo "Installing Claude Code..."
	curl -fsSL https://claude.ai/install.sh | bash
else
	echo "Claude Code already installed!"
fi

# Install Codex TUI (CLI)
if [[ -z $( command -v codex ) ]]; then
	echo "Installing Codex TUI..."
	CODEX_NON_INTERACTIVE=1 curl -fsSL https://chatgpt.com/codex/install.sh | bash
else
	echo "Codex TUI already installed!"
fi

# Install Cursor Agent
if [[ -z $( command -v agent ) ]]; then
	echo "Installing Cursor Agent..."
	curl -fsSL https://cursor.com/install | bash
else
	echo "Cursor agent already installed!"
fi

if ! command -v pi >/dev/null 2>&1; then
    echo 'Installing Pi...'
    curl -fsSL https://pi.dev/install.sh | sh
else
    echo 'Pi already installed!'
fi

# The managed Pi installer may provide Node without adding it to the shell PATH.
node_bin="${XDG_DATA_HOME:-$HOME/.local/share}/pi-node/current/bin"
if [[ -x $node_bin/node ]]; then
    export PATH="$node_bin:$PATH"
fi
TOOLING=$(dirname "$(readlink -f "$0")")
node "$TOOLING/pi/install.mjs" || exit "$?"
