"""Portal permission lifecycle tests; no real desktop approval or input."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location("wayland_portal", Path(__file__).resolve().parents[1] / "wayland_portal.py")
portal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(portal)


class PortalRestore(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.p = portal.WaylandPortal.__new__(portal.WaylandPortal)
        self.p.state_directory = Path(self.directory.name) / "permission"
        self.p.GLib = Mock()
        self.p.GLib.Variant.side_effect = lambda signature, value: value
        self.p.Gio = Mock()
        self.p.bus = Mock()
        self.p.session = self.p.sink = None
        self.p.closed = False
        self.p.parent_window = "x11:123"
        self.p.approval_timeout = None
        self.p.stop = Mock(side_effect=self.clear_session)
        self.p.portal_version = Mock(return_value=2)
        self.p.open_capture = Mock(side_effect=lambda: setattr(self.p, "sink", object()))
        self.p.screenshot = Mock()
        self.p.status = Mock(return_value={"active": True})
        self.reply = {"devices": 3, "streams": [(42, {"size": (800, 600)})], "restore_token": "fixture-grant-first"}
        self.requests = []
        def request(interface, method, signature, values, **kwargs):
            self.requests.append((method, values))
            return {"session_handle": "/fixture/session"} if method == "CreateSession" else self.reply if method == "Start" else {}
        self.p.request_call = Mock(side_effect=request)

    def clear_session(self):
        self.p.session = self.p.sink = None

    def selected(self):
        return [values[1] for method, values in self.requests if method == "SelectDevices"][-1]

    def test_permission_is_requested_once_then_rotated_on_restart(self):
        self.p.start()
        started = [values for method, values in self.requests if method == "Start"][-1]
        self.assertEqual(started[1], "x11:123")
        self.assertEqual(self.selected()["persist_mode"], 2)
        self.assertNotIn("restore_token", self.selected())
        self.assertEqual(self.p.read_permission(), "fixture-grant-first")
        file = self.p.permission_file()
        self.assertEqual(file.stat().st_mode & 0o777, 0o600)
        count = len(self.requests)
        self.p.start()
        self.assertEqual(len(self.requests), count, "an already active session opened another request")
        self.clear_session()
        self.reply["restore_token"] = "fixture-grant-replacement"
        self.p.start()
        self.assertEqual(self.selected()["restore_token"], "fixture-grant-first")
        self.assertEqual(self.p.read_permission(), "fixture-grant-replacement")

    def test_capture_failure_preserves_new_single_use_grant(self):
        self.p.screenshot.side_effect = ValueError("frame unavailable")
        with self.assertRaisesRegex(ValueError, "frame unavailable"):
            self.p.start()
        self.assertEqual(self.p.read_permission(), "fixture-grant-first")
        self.assertIsNone(self.p.session)

    def test_no_restore_grant_does_not_claim_remembered_permission(self):
        self.p.save_permission("fixture-expired")
        del self.reply["restore_token"]
        self.p.start()
        self.assertFalse(self.p.permission_remembered)
        self.assertIsNone(self.p.read_permission())

    def test_old_portal_does_not_receive_unsupported_options(self):
        self.p.portal_version.return_value = 1
        del self.reply["restore_token"]
        self.p.start()
        self.assertNotIn("persist_mode", self.selected())
        self.assertNotIn("restore_token", self.selected())

    def test_second_pending_request_does_not_open_another_dialog(self):
        import fcntl
        file = self.p.permission_file().with_name("restore-lock")
        fd = os.open(file, os.O_CREAT | os.O_RDWR, 0o600)
        with os.fdopen(fd, "r+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            with self.assertRaisesRegex(ValueError, "already in progress"):
                self.p.start()
        self.p.request_call.assert_not_called()

    def test_insecure_or_redirected_state_is_rejected_before_request(self):
        self.p.save_permission("fixture-private")
        self.p.permission_file().chmod(0o644)
        with self.assertRaisesRegex(ValueError, "private regular"):
            self.p.start()
        self.p.request_call.assert_not_called()
        self.p.permission_file().unlink()
        self.p.permission_file().symlink_to(Path(self.directory.name) / "outside")
        with self.assertRaises(OSError):
            self.p.start()
        self.p.request_call.assert_not_called()

    def test_pending_standalone_setup_wait_can_be_stopped_without_timeout(self):
        self.p.call = Mock(return_value=("/fixture/request",))
        context = self.p.GLib.MainContext.default.return_value
        context.pending.side_effect = [True, False]
        context.iteration.side_effect = lambda *args: setattr(self.p, "request", None)
        self.p.request = None
        with self.assertRaisesRegex(ValueError, "sharing was stopped"):
            portal.WaylandPortal.request_call(self.p, portal.REMOTE, "Start", "(osa{sv})", (), timeout=None)
        self.p.bus.signal_unsubscribe.assert_called_once()
