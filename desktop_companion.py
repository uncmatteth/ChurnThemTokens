#!/usr/bin/env python3
"""AIClickThatShit: one local app for screen, mouse and keyboard.

Run without flags for the standalone window. The Chrome extension launches the
same app with --stdio; there is no listener, background service or login copy.
"""

import argparse
import base64
import io
import json
import os
import sys
import tempfile
import webbrowser
from pathlib import Path

ICON = Path(__file__).resolve().parent / "browser-relay" / "bob128.png"

from ui_backend import Backend, doctor, serve


def gtk_window(backend):
    import gi
    gi.require_version("Gtk", "3.0")
    gi.require_version("GdkPixbuf", "2.0")
    from gi.repository import Gtk, GdkPixbuf, GLib

    GLib.set_application_name("AIClickThatShit")
    backend.approval_timeout = None
    window = Gtk.Window(title="AIClickThatShit")
    window.set_default_size(650, 520)
    if ICON.is_file():
        window.set_icon_from_file(str(ICON))
    panel = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
    panel.set_border_width(16)
    window.add(panel)
    scope = Gtk.Label(label="Screen, mouse and keyboard control for your own computer. On GNOME Wayland, turning this on shares only your primary monitor and enables mouse and keyboard control.", xalign=0)
    scope.set_line_wrap(True)
    panel.pack_start(scope, False, False, 0)
    byline = Gtk.Label(xalign=0)
    byline.set_markup('By Uncle Matt · <a href="https://bttlabs.fun">bttlabs.fun</a>')
    panel.pack_start(byline, False, False, 0)
    if os.environ.get("WAYLAND_DISPLAY"):
        setup_hint = Gtk.Label(label="If a sharing dialog opens, select a monitor, enable Allow Remote Interaction, and keep Remember This Selection checked.", xalign=0)
        setup_hint.set_line_wrap(True)
        panel.pack_start(setup_hint, False, False, 0)
    status = Gtk.Label(label="Stopped", xalign=0)
    status.set_line_wrap(True)
    panel.pack_start(status, False, False, 0)
    row = Gtk.Box(spacing=8)
    panel.pack_start(row, False, False, 0)
    preview = Gtk.Image()
    panel.pack_start(preview, True, True, 0)
    coordinates = Gtk.Box(spacing=8)
    panel.pack_start(coordinates, False, False, 0)
    x = Gtk.Entry(); x.set_placeholder_text("X coordinate")
    y = Gtk.Entry(); y.set_placeholder_text("Y coordinate")
    coordinates.pack_start(x, True, True, 0)
    coordinates.pack_start(y, True, True, 0)

    def run(operation, **extra):
        status.set_text("Starting screen and mouse control…" if operation == "start" else status.get_text())
        while Gtk.events_pending():
            Gtk.main_iteration_do(False)
        try:
            if "x" in extra:
                extra = {"x": int(extra["x"]), "y": int(extra["y"])}
            result = backend.desktop({"operation": operation, **extra})
            status.set_text("Screen and mouse ready" if result.get("active") else "Screen and mouse control is not ready" if operation == "start" else "Stopped" if operation == "stop" else f"{operation} completed")
            if operation == "screenshot":
                loader = GdkPixbuf.PixbufLoader.new_with_type("jpeg")
                loader.write(base64.b64decode(result["_image"]))
                loader.close()
                pixbuf = loader.get_pixbuf()
                width = min(pixbuf.get_width(), 600)
                height = int(width * pixbuf.get_height() / pixbuf.get_width())
                preview.set_from_pixbuf(pixbuf.scale_simple(width, height, GdkPixbuf.InterpType.BILINEAR))
        except Exception as error:
            status.set_text(f"{type(error).__name__}: {error}")

    def button(label, callback):
        control = Gtk.Button(label=label)
        control.connect("clicked", callback)
        row.pack_start(control, True, True, 0)

    button("Turn on AIClickThatShit", lambda *_: run("start"))
    button("Show screen", lambda *_: run("screenshot"))
    button("Turn off AIClickThatShit", lambda *_: run("stop"))
    click = Gtk.Button(label="Click X, Y")
    click.connect("clicked", lambda *_: run("click", x=x.get_text(), y=y.get_text()))
    coordinates.pack_start(click, False, False, 0)
    def close(*_):
        backend.close()
        Gtk.main_quit()
    window.connect("destroy", close)
    window.show_all()
    native_window = window.get_window()
    if hasattr(native_window, "get_xid"):
        backend.parent_window = f"x11:{native_window.get_xid():x}"
    Gtk.main()


def tk_window(backend):
    import tkinter as tk
    from tkinter import ttk
    from PIL import Image, ImageTk

    window = tk.Tk()
    window.title("AIClickThatShit")
    window.geometry("650x520")
    if ICON.is_file():
        # System Tk 8.5 on macOS cannot decode PNG files itself.
        with Image.open(ICON) as picture:
            icon = ImageTk.PhotoImage(picture, master=window)
        window.iconphoto(True, icon)
    panel = ttk.Frame(window, padding=16)
    panel.pack(fill="both", expand=True)
    ttk.Label(panel, text="Screen, mouse and keyboard control for your own computer", wraplength=600).pack(anchor="w")
    byline = ttk.Frame(panel)
    byline.pack(anchor="w", pady=(6, 0))
    ttk.Label(byline, text="By Uncle Matt · ").pack(side="left")
    ttk.Button(byline, text="bttlabs.fun", command=lambda: webbrowser.open("https://bttlabs.fun")).pack(side="left")
    status = tk.StringVar(value="Stopped")
    ttk.Label(panel, textvariable=status, wraplength=600).pack(anchor="w", pady=10)
    row = ttk.Frame(panel); row.pack(fill="x")
    preview = ttk.Label(panel); preview.pack(fill="both", expand=True)
    coordinates = ttk.Frame(panel); coordinates.pack(fill="x")
    x = ttk.Entry(coordinates); y = ttk.Entry(coordinates)
    x.pack(side="left", fill="x", expand=True); y.pack(side="left", fill="x", expand=True)

    def run(operation, **extra):
        status.set("Starting screen and mouse control…" if operation == "start" else status.get())
        window.update_idletasks()
        try:
            if "x" in extra:
                extra = {"x": int(extra["x"]), "y": int(extra["y"])}
            result = backend.desktop({"operation": operation, **extra})
            status.set("Screen and mouse ready" if result.get("active") else "Screen and mouse control is not ready" if operation == "start" else "Stopped" if operation == "stop" else f"{operation} completed")
            if operation == "screenshot":
                picture = Image.open(io.BytesIO(base64.b64decode(result["_image"])))
                picture.thumbnail((600, 390))
                preview.image = ImageTk.PhotoImage(picture)
                preview.configure(image=preview.image)
        except Exception as error:
            status.set(f"{type(error).__name__}: {error}")

    for label, action in (("Turn on AIClickThatShit", "start"), ("Show screen", "screenshot"), ("Turn off AIClickThatShit", "stop")):
        ttk.Button(row, text=label, command=lambda op=action: run(op)).pack(side="left", fill="x", expand=True)
    ttk.Button(coordinates, text="Click X, Y", command=lambda: run("click", x=x.get(), y=y.get())).pack(side="left")

    def close():
        backend.close()
        window.destroy()
    window.protocol("WM_DELETE_WINDOW", close)
    window.mainloop()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stdio", action="store_true", help="use the extension's private native transport")
    parser.add_argument("--doctor", action="store_true", help="report installed capabilities without opening a screen")
    parser.add_argument("--state", default=os.path.join(tempfile.gettempdir(), "churn-desktop-companion"))
    parser.add_argument("--chromium-executable")
    args = parser.parse_args(argv)
    if args.doctor:
        print(json.dumps({"platform": sys.platform, **doctor()}))
        return
    backend = Backend(args.state, args.chromium_executable)
    if args.stdio:
        serve(backend)
    elif sys.platform == "linux":
        gtk_window(backend)
    else:
        tk_window(backend)


if __name__ == "__main__":
    main()
