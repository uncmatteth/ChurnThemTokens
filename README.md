# ChurnThemTokens

I already pay for ChatGPT Pro. I want it to work on my computer the way Codex
does: read files, make changes and run commands.

That's what I'm building here. A Chrome extension passes requests from your
Pro chat to a helper on your computer, then sends the results back. Your login
stays in Chrome. No Codex model calls. No model API key.

```text
 / \__
(    @\___
 /         O
/   (_____/
/_____/   U
    Lulu
```

**Still a preview.** The local tools and browser fixtures pass tests. A complete
task from a real Pro chat has not been verified yet. Setup needs that check too.

## Setup

Install [ChurnThemTokens from the Chrome Web Store](https://chromewebstore.google.com/detail/nmmgjnldkinoellekdjmmdgcjadmabok) when its listing becomes available. That
adds the extension without Chrome developer mode. The computer helper still
needs local setup and a project folder you approve. Tell the coding agent on
your computer:

> Install https://github.com/uncmatteth/ChurnThemTokens. Read AGENTS.md and handle
> the setup yourself. Use my current project folder, connect my existing ChatGPT
> Pro chat, and verify it with the quick check. Only ask me for a specific browser
> or OS confirmation that you cannot perform yourself.

The [setup skill](skills/churn-them-tokens) is included. To install it in Codex,
tell your agent:

> Install the skill from https://github.com/uncmatteth/ChurnThemTokens/tree/main/skills/churn-them-tokens.

Your agent should do the setup. If Chrome or the OS needs your approval, it
should ask for that specific click.

It uses your own ChatGPT login. If you're signed out, the agent opens sign-in
and you enter your password/passkey and MFA. Your login stays in the browser.

## Use it when you need it

Once the skill is installed, call it with a task:

> Use $churn-them-tokens to read this project's README and tell me what's unfinished.

It only runs when you ask. The agent connects the Pro chat, checks it, submits
the task and disconnects afterward. The full live flow still needs verification.

Connect for a task, then disconnect when you're done. After setup, the extension
has these controls:

1. Open your ChatGPT chat and select the Pro model.
2. Open **ChurnThemTokens**, read its data disclosure, and click **Agree & connect this Pro chat**.
3. Check the computer and folders shown, enter the task, and click **Allow tools & run task**.
4. Click **Disconnect & stop** when you're finished.

You can ask your agent to handle these steps too.

## Tools

- Read, search and edit files, with hashes and backups.
- Run commands and report their output and exit status.
- Inspect Git and create separate worktrees.
- Optional browser and desktop tools ([requirements](requirements-ui.txt)).

The installer registers the Chrome native helper on Linux, macOS and Windows.
The separate **ChurnThemTokens Desktop** app opens as a normal window with
Start sharing, Show screen, Stop sharing and Click X, Y controls. Run
`python3 desktop_companion.py` on Linux/macOS or `python desktop_companion.py`
on Windows after installing the optional UI dependencies. The extension starts
its own instance of this companion when you click **Agree & connect this Pro
chat**; if desktop tools are enabled, it requests local screen and mouse access
and displays the resulting status. Its **Share desktop for mouse control** and
**Stop desktop sharing** buttons manage that extension session. The standalone
window is for direct local use and has its own session.

The computer's operating system may ask for screen and input permission.
Screenshots are attached to the connected ChatGPT chat when its attachment
control is available. **Disconnect & stop** closes the extension's session.
The desktop tool also offers `start`, `status` and `stop` actions. Linux
desktop sharing needs system GI, GStreamer/PipeWire and Pillow on Wayland, or
PyAutoGUI on X11. macOS and Windows use PyAutoGUI and Pillow, and may require
their own screen/input permissions. Builds for each operating system must be
made on that operating system.

## Tokens

ChatGPT has a separate usage allowance from Work/Codex. The point is to use the
Pro chat you're already paying for. Pro still has limits.
[OpenAI's usage guide](https://help.openai.com/en/articles/20001354-gpt-6-and-other-models-in-chatgpt).

<details>
<summary>Installer details for agents</summary>

Read [AGENTS.md](AGENTS.md). You'll need Node.js 18.17+ and Git. File and command
tools have no npm runtime dependencies. Run from this checkout:

```sh
node install.js --root project=/absolute/approved/project --allow-write --allow-exec --dry-run
node install.js --root project=/absolute/approved/project --allow-write --allow-exec
```

The installer creates private configuration, registers the helper and checks
the local connection. The agent still needs to connect the Pro chat and run
the quick check.

Repeating the same installation is safe; conflicting configuration is refused.
Use `--config /absolute/private/config.json` for a separate instance, or
`--chrome-user-data-dir /absolute/directory` for a non-default Chrome installation.
Never inspect or copy that profile's login files.

</details>

## Access

File tools stay inside the folders you approve. Shell commands run as your OS
user and can reach outside those folders. Check the permissions before running
a task. **Disconnect & stop** closes the helper and stops its running jobs.
See [SECURITY.md](SECURITY.md) and [TESTING.md](TESTING.md).

Built from the MIT-licensed Direct Chat executor in
[BridgeBrain](https://github.com/uncmatteth/gbrain-bridgebrain/tree/feat/direct-chat-computer-bridge/direct-chat).
