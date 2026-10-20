#!/usr/bin/env bash

# Install Claude desktop
if [[ -z $( command -v claude-desktop ) ]]; then
	echo "Installing Claude desktop..."
	sudo curl -fsSLo /usr/share/keyrings/claude-desktop-archive-keyring.asc https://downloads.claude.ai/claude-desktop/key.asc
	echo 'deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/claude-desktop-archive-keyring.asc] https://downloads.claude.ai/claude-desktop/apt/stable stable main' | sudo tee /etc/apt/sources.list.d/claude-desktop.list

	sudo apt update
	sudo apt install -y claude-desktop
else
	echo "Claude desktop already installed!"
fi

# Install ChatGPT desktop
if [[ -z $( command -v chatgpt ) ]]; then
	echo "Installing ChatGPT desktop..."
	arch=$(dpkg --print-architecture)
	sudo curl -fsSLo /usr/share/keyrings/chatgpt-archive-keyring.gpg \
		https://persistent.oaistatic.com/codex-app-prod/linux/repository-signing-key.gpg
	sudo tee /etc/apt/sources.list.d/chatgpt.sources >/dev/null <<EOF
Types: deb
URIs: https://persistent.oaistatic.com/codex-app-prod/linux/deb
Suites: stable
Components: main
Architectures: ${arch}
Signed-By: /usr/share/keyrings/chatgpt-archive-keyring.gpg
EOF
	sudo apt update
	sudo apt install -y chatgpt
else
	echo "ChatGPT desktop already installed!"
fi

# Install Cursor desktop
if [[ -z $( command -v cursor ) ]]; then
	echo "Installing Cursor desktop..."
	curl -fsSL https://downloads.cursor.com/keys/anysphere.asc \
	  | sudo gpg --dearmor -o /usr/share/keyrings/anysphere.gpg
	echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/anysphere.gpg] https://downloads.cursor.com/aptrepo stable main' \
	  | sudo tee /etc/apt/sources.list.d/cursor.list
	sudo apt update
	sudo apt install -y cursor
else
	echo "Cursor desktop already installed!"
fi
