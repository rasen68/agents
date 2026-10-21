#!/usr/bin/env bash

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
    done

    for command in "$tooling"/bin/*; do
        link_file "$command" "$home/.local/bin/${command##*/}"
    done
}

link_home "$HOME" "$TOOLING"

# Pi writes these files itself. Seed defaults without making the checkout mutable.
for config in settings.json keybindings.json; do
    target="$HOME/.pi/agent/$config"
    if [[ ! -e $target && ! -L $target ]]; then
        mkdir -p "$(dirname "$target")"
        cp -- "$TOOLING/pi/$config" "$target" || exit "$?"
    fi
done

# Remove only links created by earlier versions of setup.
for legacy in extensions/cd extensions/reasoning-shortcuts.ts extensions/picker-navigation.ts picker-navigation extensions/transcript-memory; do
    target="$HOME/.pi/agent/$legacy"
    if [[ -L $target && $(readlink "$target") == "$TOOLING/pi/$legacy" ]]; then
        rm -- "$target" || exit "$?"
    fi
done

for package in "$TOOLING"/pi/local-packages/pi-*; do
    [[ -d $package ]] || continue
    link_file "$package" "$HOME/.pi/agent/local-packages/${package##*/}"
done

for extension in "$TOOLING"/pi/extensions/*; do
    [[ -e $extension ]] || continue
    link_file "$extension" "$HOME/.pi/agent/extensions/${extension##*/}"
done

echo 'Shared instructions, skills, and Pi configuration configured.'
