# ChurnThemTokens

I already pay for ChatGPT Pro. I want it to work on my computer the way Codex
does: read files, make changes and run commands. Sometimes the job also needs
someone to look at the screen and click something. That part is called
**AIClickThatShit**, built into ChurnThemTokens.

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

**Still a preview.** The local tools and browser fixtures pass tests. A real Pro
chat has returned screenshots and visibly completed a click and typing task on
Windows. Linux and macOS still need completed live checks, and clean disconnect
must be verified on each computer.

## Setup

Give the [repository](https://github.com/uncmatteth/ChurnThemTokens) to the coding agent on your computer and say:

> Install https://github.com/uncmatteth/ChurnThemTokens. Read AGENTS.md and handle
> the setup yourself. Use my current project folder, connect my existing ChatGPT
> Pro chat, and verify it with the quick check. Only ask me for a specific browser
> or OS confirmation that you cannot perform yourself.

The agent sets up the local helper and opens the [Chrome Web Store listing](https://chromewebstore.google.com/detail/nmmgjnldkinoellekdjmmdgcjadmabok)
in your existing profile when the listing is available. Chrome may require you
to click **Add to Chrome**. The OS may ask you to allow screen control. Those
are the only setup confirmations the agent should hand back to you; it resumes
the rest of the work. No Chrome Developer Mode or unpacked extension steps.

The portable [setup skill](skills/churn-them-tokens) is optional for later
agent tasks. Installing it is not another requirement for this setup.

It uses your own ChatGPT login. If you're signed out, the agent opens sign-in
and you enter your password/passkey and MFA. Your login stays in the browser.

## Use it when you need it

If you installed the optional skill, you can call it with a task:

> Use $churn-them-tokens to read this project's README and tell me what's unfinished.

It only runs when you ask. The agent connects the Pro chat, checks it, submits
the task and disconnects afterward. The full live flow still needs verification.

After Chrome adds the extension, its first task or quick check connects and runs
with one click:

1. Open your ChatGPT chat and select the Pro model.
2. Open **ChurnThemTokens** and click **Connect & run quick check**, or enter a task and click **Connect & run task**. The button connects the selected chat and starts that action.
3. The panel shows the computer and folders after connection. **AIClickThatShit** starts by default when desktop access is enabled locally; its Turn off control remains available.
4. Click **Disconnect & stop managed jobs** when you're finished.

You can ask your agent to handle these steps too.

## Tools

- Read, search and edit files, with hashes and backups.
- Run commands and report their output and exit status.
- Inspect Git and create separate worktrees.
- Built-in screen, mouse and keyboard control; [desktop dependencies](requirements-ui.txt) vary by OS.

## AIClickThatShit: screen and mouse control

Some jobs need more than files and a terminal: inspect a window, click a button,
type into an app, or check what actually appeared on screen. AIClickThatShit is
the screen, mouse and keyboard part of this project. It is included in this
repository and uses the same local helper and connected Pro chat. It does not
have a separate AI login or make its own model calls.

Here is how the parts fit together:

| Part | What it does |
| --- | --- |
| Your ChatGPT Pro chat | Reads the task and requests actions. |
| ChurnThemTokens Chrome extension | Connects that chat to your computer and returns tool results. |
| Local helper | Runs the file, command and UI tools enabled during setup. |
| AIClickThatShit | Starts by default and supplies screen images and mouse/keyboard actions. |

**It is on by default when desktop access is enabled in the local helper.**
Connecting the Pro chat starts the desktop sharing request. You can turn it off
and continue using ChurnThemTokens for files and commands. If the local helper has desktop
access enabled, the extension shows these controls:

On Wayland portals supporting permission restoration, AIClickThatShit requests
permission until explicitly revoked and saves the desktop's returned grant
privately. Reopening restores that grant; an already active session is reused.
If a GNOME Wayland session's public portal reports no screen sources,
AIClickThatShit uses GNOME's screen and input session instead. In that case,
`--allow-desktop` authorizes capture of all monitors and mouse/keyboard input
without an additional OS sharing dialog. The standalone app waits for its
Turn on button before starting desktop access.
The standalone Linux app keeps its initial sharing request open until you
complete it or stop control; it does not discard setup after a short timeout.
If a sharing dialog appears, select a monitor as well as allowing remote interaction.
The Share button can be enabled by input access alone; the app needs a monitor
selection too, so it can see where it is clicking.
The desktop can still ask again if it did not grant persistence, the permission
was revoked, or the selected monitor is no longer available. This behavior must
be verified on the actual desktop before claiming unattended access works.

- **Turn on AIClickThatShit** starts screen sharing and mouse/keyboard access.
  Approve the operating system's sharing prompt if one appears.
- **Turn off AIClickThatShit** stops the extension's desktop sharing session.
  The Pro chat stays connected for file and command work.
- **Disconnect & stop managed jobs** closes the extension's helper session and stops its
  owned jobs, including desktop sharing.

Pro cannot enable desktop access through a desktop tool request; enabling it
is a panel action. Turning it off blocks subsequent desktop requests through
that relay. This controls the desktop tool, not the scope of shell commands:
commands still run as your OS user.

Screen images are attached to the same connected ChatGPT chat when its image
attachment control is available. Anything visible in those images is shared
with ChatGPT under your account. See [PRIVACY.md](PRIVACY.md).

There is also a standalone AIClickThatShit window with on/off buttons, a screen
preview and a coordinate click control. It is useful for checking local screen
and mouse access. It has its own sharing session, so stop it in that window;
disconnecting the extension does not close a separately opened standalone app.
Opening this window alone does not connect Pro or prove a Pro-directed click.

**Live verification is still outstanding on Linux and macOS.** Windows has
returned screenshots and a visibly completed click and typing task to the same
Pro chat. Clean disconnect still needs confirmation on each computer. Local
tests and a working standalone window do not establish that result.

<details>
<summary>AIClickThatShit setup details for agents</summary>

The native helper supports Linux, macOS and Windows. Include `--allow-desktop`
in the installer's dry run and installation only when desktop access is wanted.
With that local permission enabled, connecting the chat starts AIClickThatShit
by default. The operating system may still require sharing approval. Users can
choose **Turn off AIClickThatShit** without disconnecting file and command tools.

Desktop dependencies are listed in [requirements-ui.txt](requirements-ui.txt).
Linux uses system GI, GStreamer/PipeWire and Pillow on Wayland, or PyAutoGUI on
X11. macOS and Windows use PyAutoGUI and Pillow and may require screen/input
permissions. Packaged builds must be built on the target operating system.

On macOS, Turn on requests missing Accessibility and Screen Recording grants
through the operating system. If macOS requires a change in System Settings,
the app names the setting. `--doctor` reads Screen Recording
and Accessibility for the calling process without prompting; an SSH result does
not establish a separately launched app's grant.

To open the standalone window from this checkout, run
`python3 desktop_companion.py` on Linux/macOS or `python desktop_companion.py`
on Windows after installing the platform dependencies. The existing source
filename is retained for installer compatibility; the app is named AIClickThatShit.

</details>

## Tokens

ChatGPT has a separate usage allowance from Work/Codex. The point is to use the
Pro chat you're already paying for. Pro still has limits.
[OpenAI's usage guide](https://help.openai.com/en/articles/20001354-gpt-6-and-other-models-in-chatgpt).

<details>
<summary>Installer details for agents</summary>

Read [AGENTS.md](AGENTS.md). You'll need Node.js 18.17+ and Git. File and command
tools have no npm runtime dependencies. Run from this checkout:

```sh
node install.js --root project=/absolute/approved/project --allow-write --allow-exec --allow-desktop --dry-run
node install.js --root project=/absolute/approved/project --allow-write --allow-exec --allow-desktop
```

The installer creates private configuration, registers the helper and checks
the local connection. The agent then handles the supported Chrome steps and
runs the one-click Pro quick check.

Repeating the same installation is safe; conflicting configuration is refused.
Use `--config /absolute/private/config.json` for a separate instance, or
`--chrome-user-data-dir /absolute/directory` for a non-default Chrome installation.
Never inspect or copy that profile's login files.

</details>

## Access

File tools stay inside the folders you approve. Shell commands run as your OS
user and can reach outside those folders. Check the permissions before running
a task. **Disconnect & stop managed jobs** closes the helper and stops its
tracked jobs. A command that deliberately starts a detached process can outlive
the bridge; inspect that command separately.
See [SECURITY.md](SECURITY.md) and [TESTING.md](TESTING.md).

Built from the MIT-licensed Direct Chat executor in
[BridgeBrain](https://github.com/uncmatteth/gbrain-bridgebrain/tree/feat/direct-chat-computer-bridge/direct-chat).

### Photo icons

Lulu’s existing photo is the main ChurnThemTokens extension icon. Bob’s existing photo artwork is the AIClickThatShit icon, shown in its desktop window and the extension’s mouse-control section. These reuse the existing pet images.

Opening the standalone AIClickThatShit app shows the control scope before sharing starts. Turn on starts screen and mouse control; Turn off stops it for that open session. OS permission requirements still apply.
