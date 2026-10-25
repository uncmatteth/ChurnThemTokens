#!/usr/bin/env python3
"""Build a certificate-signed Mac app without replacing an installed copy."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
NAME = "ChurnThemTokensDesktop"


def verify_signature(app):
    subprocess.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(app)], check=True)
    result = subprocess.run(["/usr/bin/codesign", "-d", "-r-", "-vv", str(app)], capture_output=True, text=True, check=True)
    metadata = result.stdout + result.stderr
    lines = [line.strip().removeprefix("# ") for line in metadata.splitlines()]
    requirement = next((line.removeprefix("designated => ") for line in lines if line.startswith("designated => ")), "")
    team = next((line.partition("=")[2] for line in metadata.splitlines() if line.startswith("TeamIdentifier=")), "")
    if ("Signature=adhoc" in metadata or not team or team == "not set"
            or "anchor apple" not in requirement or "certificate leaf" not in requirement
            or f'identifier "{NAME}"' not in requirement or "cdhash" in requirement
            or not re.search(r'certificate\s+leaf\[subject\.OU\]\s*=\s*"' + re.escape(team) + r'"', requirement)):
        raise ValueError("The app needs a stable Apple-issued signing identity; ad hoc and hash-bound signatures are not installable builds")
    return {"team_identifier": team, "designated_requirement": requirement}


def build(identity, output):
    if sys.platform != "darwin":
        raise ValueError("Build this app on macOS with the installed PyInstaller runtime")
    output = Path(output).absolute()
    if output.name != NAME + ".app":
        raise ValueError("Output must be named ChurnThemTokensDesktop.app")
    if output.exists():
        raise ValueError("Output already exists; preserve it and choose a new build directory")
    if not identity.strip() or identity.strip() == "-":
        raise ValueError("Supply an existing certificate signing identity; ad hoc signing is refused")
    version = json.loads((ROOT / "package.json").read_text())["version"]
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ctt-macos-build-") as directory:
        work = Path(directory)
        spec = work / (NAME + ".spec")
        spec.write_text(f'''# Generated only for this build; no private key is read or exported.
a = Analysis([{str(ROOT / 'desktop_companion.py')!r}], pathex=[{str(ROOT)!r}],
             binaries=[], datas=[({str(ROOT / 'browser-relay' / 'bob128.png')!r}, 'browser-relay')],
             hiddenimports=['pyautogui'], hookspath=[], hooksconfig={{}}, runtime_hooks=[],
             excludes=[], noarchive=False, optimize=0)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name={NAME!r}, console=False,
          debug=False, strip=False, upx=False, argv_emulation=False,
          codesign_identity={identity!r}, entitlements_file=None)
app = BUNDLE(exe, name={NAME + '.app'!r}, icon=None, bundle_identifier={NAME!r},
             info_plist={{'CFBundleDisplayName': 'AIClickThatShit',
                         'CFBundleShortVersionString': {version!r}, 'CFBundleVersion': {version!r}}})
''')
        subprocess.run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--distpath", str(output.parent),
                        "--workpath", str(work / "work"), str(spec)], check=True)
    return {"app": str(output), **verify_signature(output), "installed": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--identity", required=True, help="existing Apple-issued code-signing certificate name or fingerprint")
    parser.add_argument("--output", type=Path, required=True, help="new candidate ChurnThemTokensDesktop.app path")
    args = parser.parse_args()
    print(json.dumps(build(args.identity, args.output)))


if __name__ == "__main__":
    main()
