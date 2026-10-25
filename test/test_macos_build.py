"""Reject builds that would erase an existing app or change privacy identity."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("mac_build", Path(__file__).resolve().parents[1] / "scripts" / "build-macos.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class MacBuild(unittest.TestCase):
    def metadata(self, text):
        return patch.object(builder.subprocess, "run", side_effect=[subprocess.CompletedProcess([], 0), subprocess.CompletedProcess([], 0, stdout="", stderr=text)])

    def test_certificate_requirement_survives_a_changed_binary_hash(self):
        requirement = 'identifier "ChurnThemTokensDesktop" and anchor apple generic and certificate leaf[subject.OU] = "EXAMPLE123"'
        results = []
        for prefix in ("# ", ""):
            for digest in ("abc", "def"):
                text = f"Identifier=ChurnThemTokensDesktop\nTeamIdentifier=EXAMPLE123\nCDHash={digest}\n{prefix}designated => {requirement}\n"
                with self.metadata(text):
                    results.append(builder.verify_signature(Path("candidate.app")))
        self.assertTrue(all(result == results[0] for result in results))

    def test_ad_hoc_and_weak_identifier_only_requirements_are_rejected(self):
        for text in ('Signature=adhoc\nTeamIdentifier=not set\n# designated => cdhash H"abc"',
                     'TeamIdentifier=EXAMPLE123\n# designated => identifier "ChurnThemTokensDesktop"',
                     'TeamIdentifier=EXAMPLE123\n# designated => identifier "ChurnThemTokensDesktop" and anchor apple generic and certificate leaf[subject.OU] = "DIFFERENTTEAM"'):
            with self.metadata(text), self.assertRaisesRegex(ValueError, "stable"):
                builder.verify_signature(Path("candidate.app"))

    def test_invalid_signature_is_never_accepted(self):
        with patch.object(builder.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "codesign")):
            with self.assertRaises(subprocess.CalledProcessError):
                builder.verify_signature(Path("candidate.app"))

    def test_existing_app_is_preserved_before_any_build_or_signing(self):
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory) / "ChurnThemTokensDesktop.app"
            app.mkdir()
            marker = app / "keep"
            marker.write_text("previous installation")
            with patch.object(builder.sys, "platform", "darwin"), patch.object(builder.subprocess, "run") as run:
                with self.assertRaisesRegex(ValueError, "already exists"):
                    builder.build("existing signing identity", app)
                run.assert_not_called()
            self.assertEqual(marker.read_text(), "previous installation")


if __name__ == "__main__":
    unittest.main()
