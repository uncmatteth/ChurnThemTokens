# ChurnThemTokens

**Use the ChatGPT Pro login you already pay for to get work done on your computer.**

The goal is the workflow you know from Codex: give it a job, let it work on your
files, see progress, and keep talking. Here, the **actual Pro model in your
ordinary ChatGPT web chat** does the thinking. ChurnThemTokens gives that chat
local tools and brings the results back into the conversation.

Your existing browser login stays in Chrome. The bridge sends messages through
that chat and runs the requested tools locally. It makes no Codex model calls
and needs no model API key.

```text
 / \__
(    @\___
 /         O
/   (_____/
/_____/   U
    Lulu
```

**Early preview:** the local tools and browser fixtures have automated tests.
The complete live Pro-to-computer workflow still needs verification. This is
not yet a replacement for every feature in the Codex app.

## Why use your Pro chat?

You can have ChatGPT Pro usage available even when you have used your
Work/Codex allowance. OpenAI documents ordinary Chat's usage separately from
Work and Codex. This project is built to use that **Pro chat you already have**
for local work. [Official model and usage guidance](https://help.openai.com/en/articles/20001354-gpt-6-and-other-models-in-chatgpt).

It doesn't add an allowance or guarantee twice as many tokens. Pro models still
have limits. The practical benefit is using the access included in your existing
subscription, with local tools attached to the chat.

## Tell your agent to set it up

Give a local coding agent with terminal and browser access this prompt:

> Install https://github.com/uncmatteth/ChurnThemTokens. Read AGENTS.md and handle
> the setup yourself. Use my current project folder, connect my existing ChatGPT
> Pro chat, and verify it with the quick check. Only ask me for a specific browser
> or OS confirmation that you cannot perform yourself.

The agent handles configuration and browser setup. After installation, open your
Pro chat, open **ChurnThemTokens**, connect, and describe the job. The panel shows
which computer is connected, what it can do, and which folders are allowed.

## What the tools can do

- Read, search, create and edit files, with conflict checks and backups.
- Run commands, show progress, and return actual output and exit status.
- Inspect Git and work with isolated worktrees.
- Use optional browser and desktop backends when their dependencies and OS allow it.

The first relay carries text; image attachment is unfinished. The installer
supports Linux and macOS Chrome; Windows native-host installation is not yet
implemented. The optional desktop backend requires X11 on Linux and does not
support Wayland. These are current gaps, alongside the unverified live Pro flow.

<details>
<summary>Installer details for agents</summary>

Read [AGENTS.md](AGENTS.md). Node.js 18.17+ and Git are required. File and command
tools have no npm runtime dependencies. From this checkout:

```sh
node install.js --root project=/absolute/approved/project --allow-write --allow-exec --dry-run
node install.js --root project=/absolute/approved/project --allow-write --allow-exec
```

The installer creates private configuration, registers the local computer helper,
and verifies its native transport. Its output gives the agent the remaining
browser actions. A successful local handshake is not proof of a working Pro chat.

Repeating the same installation is safe; conflicting configuration is refused.
Use `--config /absolute/private/config.json` for an explicit instance, or
`--chrome-user-data-dir /absolute/directory` for a non-default Chrome installation.
Never inspect or copy that profile's login files. The extension's display name
is ChurnThemTokens; its compatibility host name and ID remain stable.

</details>

## Local access

File tools stay inside approved folders. Command execution runs as your OS user;
those folders do not sandbox shell commands. Review the access in the panel
before allowing a task. **Disconnect & stop** closes the helper and cancels its
owned running jobs. See [SECURITY.md](SECURITY.md) and [TESTING.md](TESTING.md).

Built from the MIT-licensed Direct Chat executor in
[BridgeBrain](https://github.com/uncmatteth/gbrain-bridgebrain/tree/feat/direct-chat-computer-bridge/direct-chat).
The standalone package does not require GBrain or its separate Codex helper.
