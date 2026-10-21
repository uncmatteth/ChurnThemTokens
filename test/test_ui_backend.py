"""Unit tests for desktop validation. Never move the host computer's mouse."""
import importlib.util
from pathlib import Path
import os
import unittest
from unittest.mock import Mock, patch
spec = importlib.util.spec_from_file_location("ui_backend", Path(__file__).resolve().parents[1] / "ui_backend.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class DesktopValidation(unittest.TestCase):
    def setUp(self):
        self.backend = module.Backend("unused-state")
        self.gui = Mock()
        self.gui.size.return_value = (1920, 1080)
        self.gui.KEYBOARD_KEYS = ["ctrl", "c", "enter"]
        self.backend.gui = self.gui
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.backend.desktop_started = True
    def tearDown(self):
        self.env.stop()
    def test_click_uses_native_coordinates(self):
        self.backend.desktop({"operation": "click", "x": 100, "y": 200})
        self.gui.click.assert_called_once_with(100, 200, clicks=1, interval=0.1, button="left")
    def test_invalid_coordinates_are_not_executed(self):
        with self.assertRaises(ValueError):
            self.backend.desktop({"operation": "move", "x": 1920, "y": 0})
        self.gui.moveTo.assert_not_called()
    def test_hotkey_validation(self):
        with self.assertRaises(ValueError):
            self.backend.desktop({"operation": "hotkey", "keys": ["made-up"]})
        self.gui.hotkey.assert_not_called()
        self.backend.desktop({"operation": "hotkey", "keys": ["ctrl", "c"]})
        self.gui.hotkey.assert_called_once_with("ctrl", "c")
    def test_unicode_desktop_typing_is_not_faked(self):
        with self.assertRaises(ValueError):
            self.backend.desktop({"operation": "type", "text": "café"})
        self.gui.write.assert_not_called()
    def test_long_ascii_typing_fits_the_helper_time_budget(self):
        text = "a" * 16384
        with patch.object(module.sys, "platform", "linux"):
            self.backend.desktop({"operation": "type", "text": text})
        args, kwargs = self.gui.write.call_args
        self.assertEqual(args[0], text)
        self.assertLessEqual(len(text) * kwargs["interval"], 5)
    def test_macos_long_typing_is_rejected_before_any_keys_are_sent(self):
        self.gui.DARWIN_CATCH_UP_TIME = 0.01
        self.gui.PAUSE = 0.1
        with patch.object(module.sys, "platform", "darwin"):
            for text in ("a" * 16384, "A" * 1000):
                with self.assertRaisesRegex(ValueError, "Split"):
                    self.backend.desktop({"operation": "type", "text": text})
        self.gui.write.assert_not_called()
    def test_macos_typing_budget_includes_shift_events_and_configured_delays(self):
        self.gui.DARWIN_CATCH_UP_TIME = 0.02
        self.gui.PAUSE = 0.2
        with patch.object(module.sys, "platform", "darwin"):
            with self.assertRaisesRegex(ValueError, "Split"):
                self.backend.desktop({"operation": "type", "text": "A" * 300})
            self.backend.desktop({"operation": "type", "text": "A" * 200})
        self.gui.write.assert_called_once_with("A" * 200, interval=0.01)
    def test_wayland_needs_an_active_portal_before_input(self):
        self.backend.portal = Mock()
        self.backend.portal.status.return_value = {"active": False, "wayland": True}
        self.backend.portal.require_active.side_effect = ValueError("Desktop sharing is stopped")
        with patch.dict(os.environ, {"WAYLAND_DISPLAY": "wayland-0"}):
            self.assertFalse(self.backend.desktop({"operation": "status"})["active"])
            with self.assertRaisesRegex(ValueError, "stopped"):
                self.backend.desktop({"operation": "click", "x": 10, "y": 20})
        self.backend.portal.move.assert_not_called()
    def test_wayland_start_click_and_stop_use_owned_portal(self):
        self.backend.portal = Mock()
        self.backend.portal.start.return_value = {"active": True, "wayland": True}
        with patch.dict(os.environ, {"WAYLAND_DISPLAY": "wayland-0"}):
            self.assertTrue(self.backend.desktop({"operation": "start"})["active"])
            self.backend.desktop({"operation": "click", "x": 10, "y": 20})
            self.backend.desktop({"operation": "stop"})
        self.backend.portal.move.assert_called_once_with(10, 20)
        self.assertEqual(self.backend.portal.button.call_args_list, [
            unittest.mock.call("left", True), unittest.mock.call("left", False)])
        self.backend.portal.stop.assert_called_once()
    def test_wayland_drag_releases_button_after_failed_move(self):
        self.backend.portal = Mock()
        self.backend.portal.move.side_effect = ValueError("outside the selected monitor")
        with patch.dict(os.environ, {"WAYLAND_DISPLAY": "wayland-0"}):
            with self.assertRaisesRegex(ValueError, "outside"):
                self.backend.desktop({"operation": "drag", "x": 65535, "y": 1})
        self.assertEqual(self.backend.portal.button.call_args_list, [
            unittest.mock.call("left", True), unittest.mock.call("left", False)])
    def test_status_does_not_claim_multiple_monitors(self):
        self.assertTrue(self.backend.desktop({"operation": "status"})["primary_display_only"])
    def test_start_requires_a_real_frame_before_input(self):
        self.backend.desktop_started = False
        self.assertFalse(self.backend.desktop({"operation": "status"})["active"])
        with self.assertRaisesRegex(ValueError, "stopped"):
            self.backend.desktop({"operation": "click", "x": 10, "y": 20})
        self.gui.screenshot.side_effect = RuntimeError("no frame")
        with self.assertRaises(RuntimeError):
            self.backend.desktop({"operation": "start"})
        self.assertFalse(self.backend.desktop({"operation": "status"})["active"])
        self.gui.screenshot.side_effect = None
        self.assertTrue(self.backend.desktop({"operation": "start"})["active"])


@unittest.skipUnless(os.environ.get("BRIDGEBRAIN_UI_TESTS") == "1", "Optional real Chromium test")
class BrowserFixture(unittest.TestCase):
    def test_real_browser_actions_on_in_memory_fixture(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            backend = module.Backend(directory, os.environ.get("BRIDGEBRAIN_TEST_CHROMIUM"))
            try:
                backend.browser({"operation": "start", "headless": True})
                page = backend.tab()
                page.set_content('''<!doctype html><title>Fixture</title><input id="name"><button id="go" onclick="document.getElementById('out').textContent=document.getElementById('name').value">Go</button><div id="out"></div><input type="file" id="file"><select id="pick"><option value="a">A</option><option value="b">B</option></select><a id="download" download="fixture.txt">Download</a>''')
                page.evaluate("document.getElementById('download').href = URL.createObjectURL(new Blob(['download fixture'], {type:'text/plain'}))")
                backend.browser({"operation": "fill", "selector": "#name", "text": "Unicode works: café"})
                backend.browser({"operation": "click", "selector": "#go"})
                self.assertIn("Unicode works: café", backend.browser({"operation": "snapshot"})["text"])
                backend.browser({"operation": "select", "selector": "#pick", "text": "b"})
                self.assertEqual(page.locator("#pick").input_value(), "b")
                upload = Path(directory) / "upload.txt"
                upload.write_text("upload fixture")
                backend.browser({"operation": "upload", "selector": "#file", "file": str(upload)})
                self.assertEqual(page.locator("#file").evaluate("e => e.files[0].name"), "upload.txt")
                target = Path(directory) / "download.txt"
                backend.browser({"operation": "download", "selector": "#download", "file": str(target), "path": "download.txt"})
                self.assertEqual(target.read_text(), "download fixture")
                with self.assertRaises(ValueError):
                    backend.browser({"operation": "download", "selector": "#download", "file": str(target), "path": "download.txt"})
                shot = backend.browser({"operation": "screenshot"})
                self.assertEqual(shot["native_width"], 1440)
                self.assertTrue(shot["_image"])
            finally:
                backend.close_browser()

if __name__ == "__main__":
    unittest.main()
