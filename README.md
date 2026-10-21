# ChurnThemTokens

I already pay for ChatGPT Pro. I want it to work on my computer the way Codex
does: read files, make changes and run commands. Sometimes the job also needs
someone to look at the screen and click something. That part is called
**AIClickThatShit**, and it is an optional part of ChurnThemTokens.

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
3. Check the computer and folders shown. **AIClickThatShit** starts by default when desktop access is enabled locally. Turn it off if you only want file and command work.
4. Enter the task and click **Allow tools & run task**.
5. Click **Disconnect & stop** when you're finished.

You can ask your agent to handle these steps too.

## Tools

- Read, search and edit files, with hashes and backups.
- Run commands and report their output and exit status.
- Inspect Git and create separate worktrees.
- Optional browser and desktop tools ([requirements](requirements-ui.txt)).

## AIClickThatShit: the optional mouse app

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
| Local helper | Runs the approved file, command and optional UI tools. |
| AIClickThatShit | Starts by default and supplies screen images and mouse/keyboard actions. |

**It is on by default when desktop access is enabled in the local helper.**
Connecting the Pro chat starts the desktop sharing request. You can turn it off
and continue using ChurnThemTokens for files and commands. If the local helper has desktop
access enabled, the extension shows these controls:

On Wayland portals supporting permission restoration, AIClickThatShit requests
permission until explicitly revoked and saves the desktop's returned grant
privately. Reopening restores that grant; an already active session is reused.
The desktop can still ask again if it did not grant persistence, the permission
was revoked, or the selected monitor is no longer available. This behavior must
be verified on the actual desktop before claiming unattended access works.

- **Turn on AIClickThatShit** starts screen sharing and mouse/keyboard access.
  Approve the operating system's sharing prompt if one appears.
- **Turn off AIClickThatShit** stops the extension's desktop sharing session.
  The Pro chat stays connected for file and command work.
- **Disconnect & stop** closes the extension's helper session and stops its
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

**Live verification is still outstanding:** a real Pro chat must request a
harmless click, receive the result in that same chat, and disconnect cleanly.
Local tests and a working standalone window do not establish that result.

<details>
<summary>AIClickThatShit setup details for agents</summary>

The native helper supports Linux, macOS and Windows. Include `--allow-desktop`
in the installer's dry run and installation only when desktop access is wanted.
With that local permission enabled, connecting the chat starts AIClickThatShit
by default. The operating system may still require sharing approval. Users can
choose **Turn off AIClickThatShit** without disconnecting file and command tools.

The optional dependencies are listed in [requirements-ui.txt](requirements-ui.txt).
Linux uses system GI, GStreamer/PipeWire and Pillow on Wayland, or PyAutoGUI on
X11. macOS and Windows use PyAutoGUI and Pillow and may require screen/input
permissions. Packaged builds must be built on the target operating system.

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

### Photo icons

Lulu’s existing photo is the main ChurnThemTokens extension icon. Bob’s existing photo artwork is the AIClickThatShit icon, shown in its desktop window and the extension’s mouse-control section. These reuse the existing pet images.

Opening the standalone AIClickThatShit app automatically starts screen and mouse control. No initial Turn on click is required. Turn off stops control for that open session; Turn on lets you resume it. OS permission requirements still apply.
