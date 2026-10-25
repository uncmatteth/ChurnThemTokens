#!/usr/bin/env python3
"""Private stdio relay to the installed macOS app's existing privacy context."""
import argparse
from contextlib import ExitStack
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import tempfile
import time


def mac_workspace():
    from AppKit import NSWorkspace
    from Foundation import NSDate, NSRunLoop

    class Workspace:
        def runningApplications(self):
            # Deliver LaunchServices notifications before taking a new snapshot.
            NSRunLoop.currentRunLoop().runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(0.001))
            return NSWorkspace.sharedWorkspace().runningApplications()

    return Workspace()


def snapshot(workspace):
    return {int(app.processIdentifier()): app for app in workspace.runningApplications()}


def owned_apps(workspace, before, bundle, arguments):
    """Require a new same-user app instance and its exact stdio/doctor argv."""
    candidates = {}
    for pid, app in snapshot(workspace).items():
        if pid not in before and app.bundleURL() and not app.isTerminated() and Path(str(app.bundleURL().path())).resolve() == bundle:
            candidates[pid] = app
    if not candidates:
        return {}
    try:
        result = subprocess.run(["/bin/ps", "-ww", "-p", ",".join(map(str, candidates)), "-o", "pid=", "-o", "uid=", "-o", "command="],
                                capture_output=True, text=True, timeout=0.15)
    except (OSError, subprocess.TimeoutExpired):
        return {}
    owned = {}
    for line in result.stdout.splitlines():
        fields = line.strip().split(None, 2)
        if len(fields) != 3 or not fields[0].isdigit() or not fields[1].isdigit():
            continue
        pid, uid = map(int, fields[:2])
        app = candidates.get(pid)
        if app and uid == os.getuid() and app.executableURL():
            expected = str(app.executableURL().path()) + " " + " ".join(arguments)
            if fields[2] == expected:
                owned[pid] = app
    return owned


def stop_apps(workspace, before, bundle, arguments, launcher):
    # core.close sends SIGKILL after 1.5 s. Keep this bounded below that window,
    # including discovery of both PyInstaller bootloader and payload processes.
    started = time.monotonic()
    terminated = set()
    while time.monotonic() - started < 1.05:
        owned = owned_apps(workspace, before, bundle, arguments)
        for pid, app in owned.items():
            if pid not in terminated:
                app.terminate()
                terminated.add(pid)
            if time.monotonic() - started >= 0.35:
                app.forceTerminate()
        if not owned and launcher.poll() is not None:
            break
        time.sleep(0.015)
    if launcher.poll() is None:
        launcher.terminate()
        try:
            launcher.wait(timeout=0.1)
        except subprocess.TimeoutExpired:
            launcher.kill()
            launcher.wait(timeout=0.1)


def launch_arguments(arguments, directory):
    """Give this launch a unique argv identity while preserving physical state."""
    arguments = list(arguments)
    if arguments.count("--state") > 1:
        raise ValueError("Duplicate companion state arguments")
    index = arguments.index("--state") + 1 if "--state" in arguments else None
    if index is not None and index == len(arguments):
        raise ValueError("Missing companion state directory")
    state = Path(directory) / "state"
    if index is not None and "--stdio" in arguments:
        original = Path(arguments[index]).absolute()
        if not original.is_dir():
            raise ValueError("Companion state must be an existing directory")
        state.symlink_to(original, target_is_directory=True)
    else:
        state.mkdir(mode=0o700)
    if index is None:
        arguments.extend(["--state", str(state)])
    else:
        arguments[index] = str(state)
    return arguments


def relay(app, arguments, workspace=None, open_command=None):
    """Forward protocol bytes without decoding, storing, or logging their content."""
    if ("--stdio" in arguments) == ("--doctor" in arguments):
        raise ValueError("Select exactly one companion transport mode")
    bundle = Path(app).resolve()
    workspace = workspace if workspace is not None else mac_workspace()
    before = snapshot(workspace)
    cancelled = False

    def cancel(*_):
        nonlocal cancelled
        cancelled = True

    handlers = {sig: signal.signal(sig, cancel) for sig in (signal.SIGTERM, signal.SIGINT)}
    descriptors = set()
    launcher = None
    stdout_blocking = os.get_blocking(1)
    os.set_blocking(1, False)

    def close_launch():
        for descriptor in descriptors:
            os.close(descriptor)
        if launcher is not None:
            stop_apps(workspace, before, bundle, arguments, launcher)

    try:
        with tempfile.TemporaryDirectory(prefix="ctt-macos-") as directory, ExitStack() as teardown:
            # The private alias and FIFOs outlive every owned app process.
            teardown.callback(close_launch)
            os.chmod(directory, 0o700)
            arguments = launch_arguments(arguments, directory)
            source, target = (str(Path(directory) / name) for name in ("stdin", "stdout"))
            for fifo in (source, target):
                os.mkfifo(fifo, 0o600)
            incoming = os.open(source, os.O_RDWR | os.O_NONBLOCK)
            outgoing = os.open(target, os.O_RDONLY | os.O_NONBLOCK)
            keepalive = os.open(target, os.O_WRONLY | os.O_NONBLOCK)
            descriptors.update((incoming, outgoing, keepalive))
            launcher = subprocess.Popen([*(open_command or ["/usr/bin/open"]), "-n", "-W", "-a", str(bundle),
                                         "--stdin", source, "--stdout", target, "--stderr", os.devnull,
                                         "--args", *arguments], stdin=subprocess.DEVNULL,
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            pending_input, pending_output = bytearray(), bytearray()
            input_open = "--stdio" in arguments
            output_open = True
            eof_at = None
            started = time.monotonic()
            while not cancelled:
                owned = owned_apps(workspace, before, bundle, arguments)
                if cancelled:
                    break
                status = launcher.poll()
                if status is not None and status != 0:
                    raise RuntimeError("Installed macOS companion LaunchServices launch failed")
                if keepalive is not None and (owned or status is not None):
                    os.close(keepalive)
                    descriptors.remove(keepalive)
                    keepalive = None
                if status is not None and not output_open and not pending_output:
                    return 0
                if not input_open and not pending_input and incoming is not None and "--stdio" in arguments:
                    os.close(incoming)
                    descriptors.remove(incoming)
                    incoming = None
                    eof_at = time.monotonic()
                if eof_at is not None and time.monotonic() - eof_at > 0.4:
                    break
                if not owned and keepalive is not None and time.monotonic() - started > 8:
                    raise RuntimeError("Installed macOS companion LaunchServices startup timed out")
                readers = ([0] if input_open and len(pending_input) < 1024 * 1024 else [])
                if output_open and len(pending_output) < 1024 * 1024:
                    readers.append(outgoing)
                writers = ([incoming] if incoming is not None and pending_input else []) + ([1] if pending_output else [])
                readable, writable, _ = select.select(readers, writers, [], 0.02)
                if cancelled:
                    break
                if 0 in readable:
                    chunk = os.read(0, 65536)
                    pending_input.extend(chunk)
                    input_open = bool(chunk)
                if outgoing in readable:
                    chunk = os.read(outgoing, 65536)
                    pending_output.extend(chunk)
                    output_open = bool(chunk)
                if incoming in writable:
                    del pending_input[:os.write(incoming, pending_input[:65536])]
                if 1 in writable:
                    del pending_output[:os.write(1, pending_output[:65536])]
            return 0
    finally:
        for sig, handler in handlers.items():
            signal.signal(sig, handler)
        os.set_blocking(1, stdout_blocking)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", required=True)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--stdio", action="store_true")
    modes.add_argument("--doctor", action="store_true")
    parser.add_argument("--state")
    parser.add_argument("--chromium-executable")
    options = parser.parse_args()
    arguments = ["--doctor" if options.doctor else "--stdio"]
    for name in ("state", "chromium_executable"):
        if getattr(options, name) is not None:
            arguments.extend(["--" + name.replace("_", "-"), getattr(options, name)])
    try:
        return relay(options.app, arguments)
    except Exception:
        # Never print request, image, typed input, command output, or app stderr.
        print("Installed macOS companion LaunchServices transport failed; inspect its installation and permissions. No alternate companion was launched.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
