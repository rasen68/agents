#!/usr/bin/env bash
set -euo pipefail

TOOLING=$(dirname "$(readlink -f "$0")")
if (($#)); then
    echo 'Usage: setup.sh' >&2
    exit 2
fi

link_file() {
    local source=$1 target=$2
    if [[ ! -L $target && -e $target ]]; then
        printf 'Preserving existing destination: %s\n' "$target" >&2
        return 0
    fi
    mkdir -p "$(dirname "$target")"
    ln -sfnT -- "$source" "$target"
}

link_home() {
    local home=$1 tooling=$2 skill command agents_md
    local dests=(
        .agents/AGENTS.md .cursor/AGENTS.md .cursor/rules/AGENTS.mdc
        .claude/CLAUDE.md .codex/AGENTS.md .pi/agent/AGENTS.md
    )
    for agents_md in "${dests[@]}"; do
        link_file "$tooling/AGENTS.md" "$home/$agents_md"
    done

    for skill in "$tooling"/skills/*; do
        link_file "$skill" "$home/.agents/skills/${skill##*/}"
        link_file "$skill" "$home/.cursor/skills/${skill##*/}"
        link_file "$skill" "$home/.claude/skills/${skill##*/}"
        link_file "$skill" "$home/.pi/agent/skills/${skill##*/}"
    done

    for command in "$tooling"/bin/*; do
        link_file "$command" "$home/.local/bin/${command##*/}"
    done
}

link_home "$HOME" "$TOOLING"
echo 'Shared instructions and skills configured.'
