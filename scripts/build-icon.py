#!/usr/bin/env python3
"""Render the simple ChurnThemTokens extension mark at 128 pixels."""

from pathlib import Path

from PIL import Image, ImageDraw


SCALE = 8
image = Image.new("RGBA", (128 * SCALE, 128 * SCALE), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)


def points(path):
    return [(round(x * SCALE), round(y * SCALE)) for x, y in path]


draw.rounded_rectangle((16 * SCALE, 16 * SCALE, 112 * SCALE, 112 * SCALE),
                       radius=24 * SCALE, fill="#172538")
# Two directions and one shared line make the local/browser bridge legible at
# toolbar size without borrowing another product's logo.
draw.line(points([(58, 42), (38, 64), (58, 86)]), fill="#E8F3F5",
          width=11 * SCALE, joint="curve")
draw.line(points([(70, 42), (90, 64), (70, 86)]), fill="#6BE3AD",
          width=11 * SCALE, joint="curve")
draw.line(points([(57, 64), (71, 64)]), fill="#68CFFF", width=9 * SCALE)

output = Path(__file__).resolve().parent.parent / "browser-relay" / "icon128.png"
image.resize((128, 128), Image.Resampling.LANCZOS).save(output, optimize=True)
