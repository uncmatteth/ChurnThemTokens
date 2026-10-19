# ChurnThemTokens

**Let your ChatGPT Pro chat work on your computer.**

Source preview: local transport and interface tests are available. A live Pro
round trip must still be verified on each installation before it is called connected.

Your existing ChatGPT web chat does the thinking. A small Chrome extension
passes its requests to a local helper and sends the real results back to that
same chat. No Codex model calls, model API keys or public tunnel.

## Tell your agent to go

Give a local coding agent with terminal and browser access this prompt:

> Install https://github.com/uncmatteth/ChurnThemTokens. Read AGENTS.md, handle
> the setup yourself, connect my existing ChatGPT Pro chat, and verify it with
> the quick check. Use only the project folder I have authorized. Don't make
> me run commands or navigate developer settings for you.

The agent owns setup, including the browser steps. Chrome or the operating
system may require a local confirmation the agent cannot approve for you.
The agent must name that specific action and report an incomplete connection
honestly. This source release does not silently install a browser extension.

Already installed? Open your **Pro** chat in ChatGPT, open **ChurnThemTokens**,
connect, and describe what you want done. The panel shows the connected computer
and its access in plain language. A quick check tests a temporary file and a
harmless command before real work.

## What it can do

- Read, search, create and edit files with conflict checks and backups.
- Run commands and inspect actual output and exit status.
- Work with Git and isolated worktrees.
- Use optional browser and desktop tools when their dependencies and OS allow it.

The browser relay currently carries text. Image attachment is unfinished.
The local installer supports Linux and macOS Chrome. Windows native-host
installation is not yet supported. The optional desktop backend requires X11
on Linux; it does not support Wayland. Actual Pro interaction must be checked
in the signed-in chat; automated fixtures do not prove that connection.

## For the installing agent

Read [AGENTS.md](AGENTS.md). Node.js 18.17+ and Git are required. No npm runtime
dependencies are needed for file/command tools. From this checkout, run:

```sh
node install.js --root project=/absolute/approved/project --allow-write --allow-exec --dry-run
node install.js --root project=/absolute/approved/project --allow-write --allow-exec
```

The output tells the agent exactly what remains in the browser. Repeating an
identical installation is safe. Conflicting configuration is refused rather
than overwritten. Use `--config /absolute/private/config.json` for an explicit
instance or `--chrome-user-data-dir /absolute/directory` for a non-default
Chrome installation. Never inspect or copy the contents of that browser profile.

## Access and usage

File tools stay inside explicitly approved folders. Command execution runs as
your OS user and is not sandboxed by those folders. Review the access shown in
the panel before allowing a task. **Disconnect & stop** closes the local helper
and cancels its owned jobs.

ChatGPT's normal usage limits still apply. ChurnThemTokens doesn't increase
allowances or promise unlimited use. Existing browser login stays in Chrome;
the helper never reads account credentials. See [SECURITY.md](SECURITY.md) and
[TESTING.md](TESTING.md).

Built from the MIT-licensed Direct Chat executor in
[BridgeBrain](https://github.com/uncmatteth/gbrain-bridgebrain/tree/feat/direct-chat-computer-bridge/direct-chat).
GBrain and its separate Codex helper are not included or required.
