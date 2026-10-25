"""Installation permission transitions; no real OS prompts or desktop calls."""
import unittest
from unittest.mock import Mock, patch

import desktop_companion as companion


class MacSetup(unittest.TestCase):
    def test_missing_grants_are_requested_once_and_setup_waits(self):
        backend = Mock()
        setup = companion.MacPermissionSetup(backend)
        denied = {"screen_recording": False, "accessibility": False}
        with patch.object(companion, "macos_permissions", return_value=denied), \
                patch.object(companion, "request_macos_accessibility") as accessibility, \
                patch.object(companion, "request_macos_screen_recording") as screen:
            setup.request()
            setup.request()
            self.assertFalse(setup.check()["frame_verified"])
        accessibility.assert_called_once_with()
        screen.assert_called_once_with()
        backend.desktop.assert_not_called()

    def test_existing_grants_skip_requests_and_require_a_real_active_frame(self):
        backend = Mock()
        backend.desktop.side_effect = [{"active": True}, {"stopped": True}]
        setup = companion.MacPermissionSetup(backend)
        allowed = {"screen_recording": True, "accessibility": True}
        with patch.object(companion, "macos_permissions", return_value=allowed), \
                patch.object(companion, "request_macos_accessibility") as accessibility, \
                patch.object(companion, "request_macos_screen_recording") as screen:
            setup.request()
            self.assertTrue(setup.check()["frame_verified"])
            self.assertTrue(setup.check()["frame_verified"])
        accessibility.assert_not_called()
        screen.assert_not_called()
        self.assertEqual(backend.desktop.call_args_list, [unittest.mock.call({"operation": "start"}), unittest.mock.call({"operation": "stop"})])

    def test_capture_failure_is_not_a_successful_setup_and_stops(self):
        backend = Mock()
        backend.desktop.side_effect = [OSError("capture unavailable"), {"stopped": True}]
        setup = companion.MacPermissionSetup(backend)
        with patch.object(companion, "macos_permissions", return_value={"screen_recording": True, "accessibility": True}):
            with self.assertRaisesRegex(OSError, "capture unavailable"):
                setup.check()
        self.assertFalse(setup.frame_verified)
        self.assertEqual(backend.desktop.call_args.args, ({"operation": "stop"},))

    def test_unknown_permission_does_not_prompt_or_claim_success(self):
        backend = Mock()
        setup = companion.MacPermissionSetup(backend)
        with patch.object(companion, "macos_permissions", return_value={"screen_recording": None, "accessibility": True}), \
                patch.object(companion, "request_macos_screen_recording") as screen:
            setup.request()
            self.assertFalse(setup.check()["frame_verified"])
        screen.assert_not_called()
        backend.desktop.assert_not_called()


if __name__ == "__main__":
    unittest.main()
