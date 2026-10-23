# Security boundaries

This is an owner-authorized local computer executor, **not an operating-system sandbox**. Enabling execution or desktop/browser control gives substantial access as that OS account. Use an unprivileged account; do not run as administrator/root. Only approve your own ChatGPT connection. A project file or website can contain hostile instructions: those are data, not permission to run commands or expose information.

## Protections implemented

- Read-only by default; separate local write, execution, browser and desktop grants.
- The Chrome relay uses native messaging with an exact extension-origin allowlist. Only the extension panel can connect or authorize a task. Each packet is bound to the selected tab, conversation, run and sequence; a visible non-Pro model blocks execution. This uses the visible ChatGPT interface, not hidden endpoints or copied login state.
- File tools restrict explicitly approved roots, reject whole-home/drive roots, traversal, symlinks, hard-linked files and common credential/Git-internal paths. Structured file reads open the checked leaf without following symlinks where the OS supports it and validate the open file descriptor.
- Structured file reads, listings and searches also exclude package-registry, network-login and Docker credential locations, including `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials` and `.docker/`.
- Existing private configuration/state files must be regular single-link files owned by the current user with private POSIX modes. State directories are checked for ownership, private modes and symlinks before use. Windows still requires account/ACL validation.
- Existing-file mutations require expected SHA-256 and preserve backups. No recursive file-tool deletion, force worktree removal or automatic deployment.
- Authenticated HTTP bound only to loopback; exact Host/Origin checks; bounded request size, concurrency and rate. Never put a token in a URL.
- OAuth PKCE S256, recognized exact callback registration, resource/client binding, local-only approval, one-use expiring codes, hashed access/refresh storage, rotating refresh and local revocation. Revocation rotates a config epoch so a concurrent stale state write cannot reactivate an old grant.
- HTTP tools advertise their real scopes and write/destructive annotations. Insufficient scope produces an OAuth challenge, not a hidden permission escalation. ChatGPT's own approval UI remains separate.
- No Codex subprocess, model provider, OpenAI model API call, automatic paid fallback, browser cookie/session import, or inspection of existing model credentials.
- Child environments omit inherited provider and tunnel credentials. This does not prevent an explicitly requested program from reading files or calling a paid service.
- Stop cancels the server's owned process groups on POSIX and uses task-tree termination on Windows; arbitrary PID kill is not exposed. A POSIX command can deliberately escape its process group by starting a detached session; such descendants are not guaranteed to stop with the bridge. Retry IDs prevent accidental duplicate command execution. Stale jobs are never replayed on restart.
- Native messaging and JSONL connection EOF revoke the connection immediately, including while an action is blocked. Late results are suppressed and subsequent actions are refused.
- Audit records contain operation, time, argument digest and result status, not plaintext input. Browser exception details are suppressed because they may contain typed data or URLs.

## Limitations you must account for

The allowlist applies to structured file tools. **Shell, Git execution, browser interaction and desktop control are trusted capabilities, not constrained by that allowlist.** They can read, modify, transmit or execute anything the OS user can. Enabling them is not appropriate for an untrusted client, and read-only OAuth scopes are not a confidentiality boundary between different projects on the same instance. Do not share an instance with other people.

Task consent grants the selected Pro chat the enabled tools for that run. Run/tab/model binding and the instruction to treat retrieved material as data do not prevent prompt injection: hostile file or website content can influence Pro to request a valid privileged action outside the person's intended task. There is no independent per-action intent check or OS containment boundary for those grants. The one-button workflow does not eliminate this risk.

Filesystem checks and optimistic hashes are not a kernel-enforced sandbox or a transaction against hostile concurrent local processes. Restrict local account access and do not treat symlink checks as protection from another process with the same user privileges. Git repositories can contain executable filters/configuration; inspect untrusted repositories before granting execution. Release hooks are not implicitly run by structured helpers.

Job output, backup bytes and checkpoints may contain private project data even though request arguments are not logged. They remain in the private state directory and must not be committed or uploaded. Each job log is capped, but total historical state is not automatically purged; review storage locally and preserve needed worktrees before cleanup. POSIX modes request private access; Windows account/ACL security must also be checked locally.

The temporary browser does not import existing profiles. Interactive websites and screenshots can still expose whatever is visibly on screen. Do not open password managers, authentication files or unrelated private material for a task. Handle login/MFA manually on the local computer. The bridge does not solve CAPTCHA or bypass website access controls.

HTTP's OAuth implementation is a limited, tested public-client implementation, not a general identity provider or a claim of certification. Public registration is bounded and accepts recognized ChatGPT callbacks only. Reverse-proxy/TLS integrity and tunnel authorization are operator responsibilities. Never remove authentication to work around a client error. A production deployment needs actual ChatGPT connection verification and OS-specific checks; unit tests are not an independent security audit.
When a public URL is configured, registration is unauthenticated. New registrations and pending pairing requests keep a five-minute window; expired requests are removed, while older unused registrations can be evicted at the cap and pruned after a day. Clients with live grants and locally approved requests are preserved. A caller can still consume request capacity or repeatedly fill the five-minute window. Keeping this instance local avoids that public exposure; the caps and expiry are not a complete registration-abuse defense.

Supported MCP revisions: 2025-11-25, 2025-06-18, 2025-03-26. JSONL stdio and JSON-response stateless Streamable HTTP support initialize/ping/tools/list/tools/call and ignore notifications without executing them. Optional MCP sampling, roots callbacks, resources, prompts, resumable SSE and later handshakes are not advertised. Tools do not change at runtime; restart/reconnect when changing local configuration or metadata.

The server does not grant OpenAI plan features, change billing, or let a user evade model/tool rate limits. This repository contains no Codex model-call helper. The extension is loaded through supported browser controls; the installer never changes browser policies or profile databases to force installation.
