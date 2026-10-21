#!/usr/bin/env python3
"""Install an existing, user-approved 128px photo icon without altering it."""
import argparse
from pathlib import Path
import shutil
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, required=True)
args = parser.parse_args()
with Image.open(args.source) as image:
    if image.format != 'PNG' or image.size != (128, 128):
        raise ValueError('Provide the approved 128 x 128 PNG photo icon')
output = Path(__file__).resolve().parent.parent / 'browser-relay' / 'icon128.png'
if args.source.resolve() != output.resolve():
    shutil.copyfile(args.source, output)
