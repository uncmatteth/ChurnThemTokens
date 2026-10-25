"""Real private FIFO transport and managed-process tests; no host desktop calls."""
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
THIS = Path(__file__).resolve()


def alive(pid):
    if sys.platform.startswith("linux"):
        try:
            # Keep synthetic workspace snapshots as cheap as NSWorkspace;
            # spawning one ps per PID can consume the whole cancellation budget.
            return (Path("/proc") / str(pid) / "stat").read_text().rsplit(") ", 1)[1][0] != "Z"
        except FileNotFoundError:
            return False
    result = subprocess.run(["ps", "-p", str(pid), "-o", "stat="], capture_output=True, text=True)
    return result.returncode == 0 and not result.stdout.lstrip().startswith("Z")


class URL:
    def __init__(self, path):
        self.value = str(path)

    def path(self):
        return self.value


class Application:
    def __init__(self, pid, app):
        self.pid, self.app = pid, Path(app)

    def processIdentifier(self):
        return self.pid

    def bundleURL(self):
        return URL(self.app)

    def executableURL(self):
        return URL(self.app / "Contents" / "MacOS" / "Desktop")

    def isTerminated(self):
        return not alive(self.pid)

    def terminate(self):
        try:
            os.kill(self.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    def forceTerminate(self):
        try:
            os.kill(self.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


class Workspace:
    def __init__(self, record, app, existing):
        self.record, self.app, self.existing = Path(record), app, existing

    def runningApplications(self):
        entries = self.record.read_text().splitlines() if self.record.exists() else []
        return [Application(pid, self.app) for pid in self.existing + [int(line) for line in entries] if alive(pid)]


def fixture_relay(app, record, behavior, existing):
    from macos_app_relay import relay
    app_args = [str(THIS), "--payload", record, behavior, "--stdio", "--state", str(Path(record).parent / "private state")]
    if behavior == "doctor":
        app_args = app_args[:-3] + ["--doctor"]
    elif behavior == "no-state-probe":
        app_args = app_args[:-2]
    return relay(app, app_args, workspace=Workspace(record, app, existing),
                 open_command=[sys.executable, str(THIS), "--launcher", record])


def launcher(record, arguments):
    # Model /usr/bin/open's descriptor setup and a LaunchServices process group.
    if arguments[:3] != ["-n", "-W", "-a"]:
        return 20
    app = Path(arguments[3])
    if arguments[4] != "--stdin" or arguments[6] != "--stdout" or arguments[8] != "--stderr" or arguments[10] != "--args":
        return 21
    private = Path(arguments[5]).parent
    if private.stat().st_mode & 0o077 or any(Path(arguments[i]).stat().st_mode & 0o077 for i in (5, 7)):
        return 22
    signal.signal(signal.SIGTERM, lambda *_: None)
    with open(arguments[5], "rb", buffering=0) as source, open(arguments[7], "wb", buffering=0) as target, open(arguments[9], "wb") as errors:
        child = subprocess.Popen([str(app / "Contents" / "MacOS" / "Desktop"), *arguments[11:]],
                                 stdin=source, stdout=target, stderr=errors, start_new_session=True)
        return child.wait()


def payload(record, behavior):
    with open(record, "a") as output:
        output.write(str(os.getpid()) + "\n")
    if behavior == "doctor":
        os.write(1, b'{"app_context":true,"prompting":false}\n')
        return 0
    if behavior.endswith("state-probe"):
        state = Path(sys.argv[sys.argv.index("--state") + 1])
        (state / "app-write").write_text("same physical state")
        os.write(1, json.dumps({"state": str(state), "physical": str(state.resolve()), "symlink": state.is_symlink()}).encode() + b"\n")

        def stopped(*_):
            Path(record + ".teardown").write_text(json.dumps({"state_exists": state.is_dir()}))
            sys.exit(0)

        signal.signal(signal.SIGTERM, stopped)
    if behavior == "stubborn-pair":
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        if not os.environ.get("CTT_TEST_PAYLOAD"):
            child = subprocess.Popen([sys.executable, *sys.argv], env={**os.environ, "CTT_TEST_PAYLOAD": "1"})
            return child.wait()
    while True:
        chunk = os.read(0, 65536)
        if not chunk:
            if behavior != "stubborn-pair" and not behavior.endswith("state-probe"):
                return 0
            time.sleep(0.01)
        else:
            os.write(1, chunk)


@unittest.skipIf(os.name == "nt", "macOS relay uses POSIX FIFOs")
class MacAppRelay(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="ctt-macos-relay-test-")
        self.addCleanup(self.directory.cleanup)
        self.temp = Path(self.directory.name)
        self.app = self.temp / "Installed app.app"
        executable = self.app / "Contents" / "MacOS" / "Desktop"
        executable.parent.mkdir(parents=True)
        executable.symlink_to(sys.executable)
        self.record = self.temp / "processes"
        self.state = self.temp / "private state"
        self.state.mkdir(mode=0o700)
        self.existing = []

    def start(self, behavior="echo"):
        expression = f"import sys; sys.path[:0] = [{str(ROOT)!r}, {str(THIS.parent)!r}]; from test_macos_app_relay import fixture_relay; sys.exit(fixture_relay({str(self.app)!r}, {str(self.record)!r}, {behavior!r}, {self.existing!r}))"
        child = subprocess.Popen([sys.executable, "-c", expression], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=ROOT, start_new_session=True)
        self.addCleanup(self.cleanup, child)
        return child

    def cleanup(self, child):
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=3)
        for stream in (child.stdin, child.stdout, child.stderr):
            if stream:
                stream.close()
        for pid in self.pids():
            if alive(pid):
                os.kill(pid, signal.SIGKILL)

    def pids(self):
        return [int(line) for line in self.record.read_text().splitlines()] if self.record.exists() else []

    def wait_pids(self, count):
        deadline = time.monotonic() + 5
        while len(self.pids()) < count and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(len(self.pids()), count)

    def test_fifo_roundtrip_preserves_exact_bytes_and_eof_exits(self):
        child = self.start()
        content = b'{"id":1,"text":"private"}\r\n' + bytes(range(256)) * 4096
        output, errors = child.communicate(content, timeout=8)
        self.assertEqual(child.returncode, 0, errors.decode())
        self.assertEqual(output, content)
        self.assertTrue(self.pids())
        self.assertFalse(any(alive(pid) for pid in self.pids()))

    def test_doctor_uses_app_output_even_when_parent_stdin_is_closed(self):
        child = self.start("doctor")
        output, errors = child.communicate(timeout=8)
        self.assertEqual(child.returncode, 0, errors.decode())
        self.assertEqual(json.loads(output), {"app_context": True, "prompting": False})

    def test_cancellation_reaps_both_owned_processes_and_preserves_existing_gui(self):
        gui = [subprocess.Popen([str(self.app / "Contents" / "MacOS" / "Desktop"), "-c", "import time; time.sleep(30)"], start_new_session=True) for _ in range(2)]
        self.existing = [process.pid for process in gui]
        for process in gui:
            self.addCleanup(lambda process=process: (process.terminate(), process.wait(timeout=3)) if process.poll() is None else None)
        child = self.start("stubborn-pair")
        self.wait_pids(2)
        child.stdin.write(b'{"id":1}\n')
        child.stdin.flush()
        self.assertTrue(select.select([child.stdout], [], [], 3)[0], "relay never returned its FIFO response")
        self.assertEqual(os.read(child.stdout.fileno(), 1024), b'{"id":1}\n')
        started = time.monotonic()
        os.killpg(child.pid, signal.SIGTERM)
        output, errors = child.communicate(timeout=2)
        self.assertLess(time.monotonic() - started, 1.4)
        self.assertEqual(child.returncode, 0, errors.decode())
        self.assertFalse(any(alive(pid) for pid in self.pids()))
        self.assertTrue(all(process.poll() is None for process in gui), "relay terminated a preexisting GUI process")
        self.assertEqual(output, b"")

    def test_stdin_eof_stops_an_unresponsive_owned_pair(self):
        child = self.start("stubborn-pair")
        self.wait_pids(2)
        output, errors = child.communicate(b"final bytes\n", timeout=3)
        self.assertEqual(child.returncode, 0, errors.decode())
        self.assertEqual(output, b"final bytes\n")
        self.assertFalse(any(alive(pid) for pid in self.pids()))

    def test_stopping_one_relay_preserves_a_later_independent_relay(self):
        first = self.start("stubborn-pair")
        self.wait_pids(2)
        first_pids = self.pids()
        second = self.start("stubborn-pair")
        self.wait_pids(4)
        second_pids = [pid for pid in self.pids() if pid not in first_pids]
        first.terminate()
        _, errors = first.communicate(timeout=2)
        self.assertEqual(first.returncode, 0, errors.decode())
        self.assertFalse(any(alive(pid) for pid in first_pids))
        self.assertTrue(all(alive(pid) for pid in second_pids), "first relay stopped an independent later app instance")
        second.stdin.write(b"independent relay still works\n")
        second.stdin.flush()
        self.assertTrue(select.select([second.stdout], [], [], 3)[0])
        self.assertEqual(os.read(second.stdout.fileno(), 1024), b"independent relay still works\n")
        second.terminate()
        _, errors = second.communicate(timeout=2)
        self.assertEqual(second.returncode, 0, errors.decode())
        self.assertFalse(any(alive(pid) for pid in second_pids))

    def test_private_launch_alias_preserves_physical_state_until_app_teardown(self):
        child = self.start("state-probe")
        self.wait_pids(1)
        output, errors = child.communicate(timeout=3)
        self.assertEqual(child.returncode, 0, errors.decode())
        self.assertTrue(output, "app did not receive a usable launch state")
        result = json.loads(output)
        self.assertTrue(result["symlink"])
        self.assertNotEqual(result["state"], str(self.state))
        self.assertEqual(result["physical"], str(self.state))
        self.assertEqual((self.state / "app-write").read_text(), "same physical state")
        self.assertEqual(json.loads(Path(str(self.record) + ".teardown").read_text()), {"state_exists": True})
        self.assertFalse(Path(result["state"]).exists())

    def test_omitted_state_gets_a_private_directory_until_app_teardown(self):
        child = self.start("no-state-probe")
        self.wait_pids(1)
        output, errors = child.communicate(timeout=3)
        self.assertEqual(child.returncode, 0, errors.decode())
        self.assertTrue(output, "app did not receive a usable launch state")
        result = json.loads(output)
        self.assertFalse(result["symlink"])
        self.assertNotEqual(result["physical"], str(self.state))
        self.assertEqual(json.loads(Path(str(self.record) + ".teardown").read_text()), {"state_exists": True})
        self.assertFalse(Path(result["state"]).exists())

    def test_launch_failure_is_reported_without_loose_python_fallback(self):
        from macos_app_relay import relay
        with self.assertRaisesRegex(RuntimeError, "LaunchServices"):
            relay(str(self.app), ["--doctor"], workspace=Workspace(self.record, self.app, []),
                  open_command=[sys.executable, "-c", "import sys; sys.exit(17)"])
        self.assertEqual(self.pids(), [])


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--launcher":
        sys.exit(launcher(sys.argv[2], sys.argv[3:]))
    if len(sys.argv) > 1 and sys.argv[1] == "--payload":
        sys.exit(payload(sys.argv[2], sys.argv[3]))
    unittest.main()
