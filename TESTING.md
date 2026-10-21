# Testing

From the repository root:

```sh
npm run check
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s test -p 'test_*.py'
npm run package:guard
npm pack --dry-run --json --ignore-scripts
```

To exercise the extension's composer and popup against local HTML fixtures in
an isolated real Chrome process:

```sh
BRIDGEBRAIN_RELAY_CHROME=/path/to/google-chrome npm run check
```

Optional Python browser tests use the pinned requirements in
`requirements-ui.txt`, `BRIDGEBRAIN_UI_TESTS=1` and optionally
`BRIDGEBRAIN_TEST_CHROMIUM=/path/to/chromium`. Missing optional dependencies
produce explicit skips. Desktop validation tests use mocks, not a real mouse.
Wayland portal tests do not approve a real OS sharing dialog.

The native tests execute actual file operations and child commands and check
their hashes and exit status. Installer tests use temporary private directories
and never change the user's Chrome registration. Tests cover denied permissions,
unexpected origins, stale runs, replay, model changes and incomplete jobs.

A live acceptance check is separate: the actual selected Pro model must request
file create/read/delete and a harmless command; matching real receipts and the
command's exit status must return to that same chat. Do not infer this from a
local doctor, native handshake, test fixture or extension icon.
For desktop acceptance, also observe a real shared frame, an image attachment
in that same chat, and an intended mouse/keyboard action on a harmless target.
