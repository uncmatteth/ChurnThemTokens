"""GNOME Wayland fallback when the public desktop portal has no screen sources.

The screen and input sessions belong to this process and close together.
"""

import os
import time
from pathlib import Path

from wayland_portal import BUTTONS, KEYS, unpack


SCREENCAST = "org.gnome.Mutter.ScreenCast"
SCREENCAST_PATH = "/org/gnome/Mutter/ScreenCast"
REMOTE = "org.gnome.Mutter.RemoteDesktop"
REMOTE_PATH = "/org/gnome/Mutter/RemoteDesktop"


class GnomeWaylandDesktop:
    def __init__(self):
        try:
            import gi
            gi.require_version("Gdk", "3.0")
            gi.require_version("Gst", "1.0")
            from gi.repository import Gdk, Gio, GLib, Gst
        except (ImportError, ValueError) as error:
            raise ValueError("GNOME desktop needs system Python GI, GStreamer, Gdk, PipeWire and Pillow") from error
        self.Gdk, self.Gio, self.GLib, self.Gst = Gdk, Gio, GLib, Gst
        self.bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        owners = [self.dbus("GetNameOwner", "(s)", (name,))[0]
                  for name in (SCREENCAST, REMOTE, "org.gnome.Shell")]
        if len(set(owners)) != 1:
            raise ValueError("GNOME screen and input services do not belong to the current desktop")
        self.owner = owners[0]
        pid = self.dbus("GetConnectionUnixProcessID", "(s)", (self.owner,))[0]
        uid = self.dbus("GetConnectionUnixUser", "(s)", (self.owner,))[0]
        executable = Path(os.readlink(f"/proc/{pid}/exe")).resolve()
        if uid != os.getuid() or executable.name != "gnome-shell" or executable.stat().st_uid != 0:
            raise ValueError("GNOME desktop service identity could not be verified")
        self.remote_session = None
        self.screen_session = None
        self.stream = None
        self.stream_size = None
        self.pipeline = None
        self.sink = None
        self.subscriptions = []
        self.closed = False
        self.remote_closed = False
        self.screen_closed = False
        Gst.init(None)

    def dbus(self, method, signature, values):
        return self.bus.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus",
                                  "org.freedesktop.DBus", method,
                                  self.GLib.Variant(signature, values), None,
                                  self.Gio.DBusCallFlags.NONE, 5000, None)

    def owner_is_current(self):
        try:
            return all(self.dbus("GetNameOwner", "(s)", (name,))[0] == self.owner
                       for name in (SCREENCAST, REMOTE, "org.gnome.Shell"))
        except Exception:
            return False

    def call(self, destination, path, interface, method, argument=None):
        return self.bus.call_sync(self.owner, path, interface, method, argument,
                                  None, self.Gio.DBusCallFlags.NONE, 5000, None)

    def bounds(self):
        display = self.Gdk.Display.get_default()
        if display is None or display.get_n_monitors() == 0:
            raise ValueError("No visible GNOME monitor")
        rectangles = [display.get_monitor(index).get_geometry()
                      for index in range(display.get_n_monitors())]
        left = min(rect.x for rect in rectangles)
        top = min(rect.y for rect in rectangles)
        right = max(rect.x + rect.width for rect in rectangles)
        bottom = max(rect.y + rect.height for rect in rectangles)
        if right <= left or bottom <= top:
            raise ValueError("Invalid GNOME monitor layout")
        return left, top, right - left, bottom - top

    def on_remote_closed(self, *_args):
        self.remote_closed = True
        self.closed = True

    def on_screen_closed(self, *_args):
        self.screen_closed = True
        self.closed = True

    def start(self):
        if self.remote_session and self.sink and not self.closed:
            return self.status()
        self.stop()
        if not self.owner_is_current():
            raise ValueError("GNOME desktop service changed; desktop control was not started")
        V = self.GLib.Variant
        try:
            left, top, width, height = self.bounds()
            self.stream_size = (width, height)
            self.remote_session = self.call(REMOTE, REMOTE_PATH, REMOTE, "CreateSession")[0]
            session_id = unpack(self.call(
                REMOTE, self.remote_session, "org.freedesktop.DBus.Properties", "Get",
                V("(ss)", (REMOTE + ".Session", "SessionId"))))[0]
            self.screen_session = self.call(
                SCREENCAST, SCREENCAST_PATH, SCREENCAST, "CreateSession",
                V("(a{sv})", ({"remote-desktop-session-id": V("s", session_id)},)))[0]
            self.stream = self.call(
                SCREENCAST, self.screen_session, SCREENCAST + ".Session", "RecordArea",
                V("(iiiia{sv})", (left, top, width, height,
                                   {"cursor-mode": V("u", 2)})))[0]
            nodes = []
            self.subscriptions.append(self.bus.signal_subscribe(
                self.owner, SCREENCAST + ".Stream", "PipeWireStreamAdded",
                self.stream, None, self.Gio.DBusSignalFlags.NONE,
                lambda _bus, _sender, _path, _interface, _name, params:
                    nodes.append(params.unpack()[0])))
            self.subscriptions.append(self.bus.signal_subscribe(
                self.owner, REMOTE + ".Session", "Closed", self.remote_session,
                None, self.Gio.DBusSignalFlags.NONE, self.on_remote_closed))
            self.subscriptions.append(self.bus.signal_subscribe(
                self.owner, SCREENCAST + ".Session", "Closed", self.screen_session,
                None, self.Gio.DBusSignalFlags.NONE, self.on_screen_closed))
            # Starting the linked remote session starts its screen stream too.
            self.call(REMOTE, self.remote_session, REMOTE + ".Session", "Start")
            context = self.GLib.MainContext.default()
            deadline = time.monotonic() + 5
            while not nodes and time.monotonic() < deadline:
                while context.pending():
                    context.iteration(False)
                time.sleep(0.02)
            if not nodes:
                raise ValueError("GNOME screen stream did not start")
            self.pipeline = self.Gst.parse_launch(
                f"pipewiresrc path={int(nodes[0])} do-timestamp=true ! "
                "videoconvert ! video/x-raw,format=RGB ! "
                "appsink name=shot sync=false max-buffers=1 drop=true")
            self.sink = self.pipeline.get_by_name("shot")
            if self.pipeline.set_state(self.Gst.State.PLAYING) == self.Gst.StateChangeReturn.FAILURE:
                raise ValueError("GNOME screen capture could not start")
            self.screenshot()  # Do not report ready before a real frame arrives.
            return self.status()
        except Exception:
            self.stop()
            raise

    def refresh_closed(self):
        context = self.GLib.MainContext.default()
        while context.pending():
            context.iteration(False)
        if self.closed:
            self.stop()

    def require_active(self, _device=0):
        self.refresh_closed()
        if self.closed or not self.remote_session or not self.sink or not self.owner_is_current():
            raise ValueError("Desktop sharing is stopped. Call desktop start")

    def status(self):
        self.refresh_closed()
        if not self.remote_session or not self.sink or self.closed or not self.owner_is_current():
            return {"active": False, "wayland": True}
        return {"active": True, "wayland": True, "width": self.stream_size[0],
                "height": self.stream_size[1], "primary_display_only": False,
                "selected_monitor_only": False, "backend": "gnome"}

    def screenshot(self):
        self.require_active()
        from PIL import Image
        sample = self.sink.emit("try-pull-sample", 5 * self.Gst.SECOND)
        if sample is None:
            raise ValueError("No frame arrived from the GNOME desktop")
        caps = sample.get_caps().get_structure(0)
        width, height = caps.get_value("width"), caps.get_value("height")
        if width <= 0 or height <= 0 or width * height > 80_000_000:
            raise ValueError("Invalid GNOME frame size")
        buffer = sample.get_buffer()
        data = buffer.extract_dup(0, buffer.get_size())
        stride = len(data) // height
        if stride < width * 3 or len(data) < stride * height:
            raise ValueError("Invalid GNOME frame")
        return Image.frombytes("RGB", (width, height), data, "raw", "RGB", stride, 1)

    def check_point(self, x, y):
        self.require_active(2)
        width, height = self.stream_size
        if not isinstance(x, int) or not isinstance(y, int) or not (0 <= x < width and 0 <= y < height):
            raise ValueError("Coordinates are outside the shared desktop")

    def move(self, x, y):
        self.check_point(x, y)
        self.call(REMOTE, self.remote_session, REMOTE + ".Session",
                  "NotifyPointerMotionAbsolute",
                  self.GLib.Variant("(sdd)", (self.stream, float(x), float(y))))

    def button(self, name, pressed):
        self.require_active(2)
        if name not in BUTTONS:
            raise ValueError("Unsupported mouse button")
        self.call(REMOTE, self.remote_session, REMOTE + ".Session",
                  "NotifyPointerButton",
                  self.GLib.Variant("(ib)", (BUTTONS[name], bool(pressed))))

    def key(self, name, pressed):
        self.require_active(1)
        name = {"\n": "enter", "\r": "enter", "\t": "tab"}.get(name, name)
        if len(name) == 1 and name.isascii() and name.isprintable():
            symbol = self.Gdk.unicode_to_keyval(ord(name))
        else:
            symbol = self.Gdk.keyval_from_name(KEYS.get(name.lower(), ""))
        if not symbol:
            raise ValueError("Unsupported key name")
        self.call(REMOTE, self.remote_session, REMOTE + ".Session",
                  "NotifyKeyboardKeysym", self.GLib.Variant("(ub)", (int(symbol), bool(pressed))))

    def notify(self, method, _signature, values, _device):
        self.require_active(2)
        if method != "NotifyPointerAxisDiscrete":
            raise ValueError("Unsupported pointer action")
        self.call(REMOTE, self.remote_session, REMOTE + ".Session", method,
                  self.GLib.Variant("(ui)", (int(values[0]), int(values[1]))))

    def session_active(self, path, interface):
        if not path:
            return False
        try:
            xml = self.call(REMOTE, path, "org.freedesktop.DBus.Introspectable", "Introspect")[0]
            return f'<interface name="{interface}">' in xml
        except Exception:
            # If the unique GNOME Shell peer vanished, its owned sessions
            # vanished with the bus connection. Other D-Bus errors are not
            # evidence that sharing stopped.
            try:
                return bool(self.dbus("NameHasOwner", "(s)", (self.owner,))[0])
            except Exception:
                return True

    def stop(self):
        if self.pipeline:
            self.pipeline.set_state(self.Gst.State.NULL)
            self.pipeline = self.sink = None
        # A linked ScreenCast session must be stopped through its owning
        # RemoteDesktop session; ScreenCast.Stop rejects that operation.
        if self.remote_session and self.session_active(self.remote_session, REMOTE + ".Session"):
            try:
                self.call(REMOTE, self.remote_session, REMOTE + ".Session", "Stop")
            except Exception:
                pass
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            context = self.GLib.MainContext.default()
            while context.pending():
                context.iteration(False)
            self.remote_closed = not self.session_active(self.remote_session, REMOTE + ".Session")
            self.screen_closed = not self.session_active(self.screen_session, SCREENCAST + ".Session")
            if self.remote_closed and self.screen_closed:
                break
            time.sleep(0.02)
        if not self.remote_closed or not self.screen_closed:
            raise ValueError("GNOME desktop sharing did not confirm it stopped")
        for subscription in self.subscriptions:
            self.bus.signal_unsubscribe(subscription)
        self.subscriptions = []
        self.remote_session = self.screen_session = self.stream = None
        self.closed = self.remote_closed = self.screen_closed = False
