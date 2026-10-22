# pi-code-blocks

Renders completed, top-level code fences in assistant messages with `batcat`'s
syntax colors, line numbers, grid borders, and a dark grey background, without
visible Markdown fence markers. Conversation history stays as Markdown. User
messages and thinking aren't changed.

Requires Pi's `registerMarkdownTransformer` API, available in Pi 1.3.0, and
`batcat` or `bat` on PATH. On Debian/Ubuntu, install bat with `sudo apt install bat`.
`batcat` takes precedence if both names exist.

Try it from the repository root:

```sh
pi --extension ./pi/extensions/pi-code-blocks/index.ts
```

Ask Pi to reply with a fenced Python example. For example:

````text
Show this in a Python code block: print("Hello world")
````

For the usual installation, run `./setup.sh`, then `/reload` in Pi. Setup's
existing extension discovery links this directory automatically. Existing real
files or directories at the destination are preserved.

Bat uses its existing theme configuration, including `BAT_THEME`. The extension
sets colors on, disables paging, and chooses `numbers,grid` with character
wrapping to fit Pi's message width. The background is fixed at `#282828`, including
padding to the block's full width. The Markdown language `csharp` maps to bat's
`cs` syntax. Unknown languages use bat's plain-text layout.

Incomplete streaming fences keep Pi's normal rendering until the closing fence
arrives. Nested fences inside blockquotes or lists aren't specially handled.
Results are cached by code, language, and width, up to 128 entries. Reload after
changing bat configuration to clear the cache.

Missing bat, failed processes, blocks over 64 KiB, or widths below 14 columns
keep the original Markdown. Each bat invocation has a 250 ms timeout. There are
no npm dependencies or shell commands built from message content.
