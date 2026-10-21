"""Temporary, user-approved Wayland screen and input session.

This uses the desktop portal, never compositor private APIs or profile data.
The owning UI helper keeps the D-Bus session alive and closes it on stop/exit.
"""

import os
import time
import uuid


PORTAL = "org.freedesktop.portal.Desktop"
PATH = "/org/freedesktop/portal/desktop"
REMOTE = "org.freedesktop.portal.RemoteDesktop"
CAST = "org.freedesktop.portal.ScreenCast"
REQUEST = "org.freedesktop.portal.Request"
SESSION = "org.freedesktop.portal.Session"
BUTTONS = {"left": 272, "right": 273, "middle": 274}
KEYS = {
    "enter": "Return", "return": "Return", "tab": "Tab", "esc": "Escape",
    "escape": "Escape", "backspace": "BackSpace", "delete": "Delete",
    "space": "space", "up": "Up", "down": "Down", "left": "Left",
    "right": "Right", "home": "Home", "end": "End", "pageup": "Page_Up",
    "pagedown": "Page_Down", "ctrl": "Control_L", "control": "Control_L",
    "alt": "Alt_L", "shift": "Shift_L", "super": "Super_L", "win": "Super_L",
}
KEYS.update({f"f{n}": f"F{n}" for n in range(1, 13)})


def unpack(value):
    """Unwrap D-Bus variants without persisting portal response metadata."""
    if hasattr(value, "unpack"):
        return unpack(value.unpack())
    if isinstance(value, dict):
        return {key: unpack(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return type(value)(unpack(item) for item in value)
    return value


class WaylandPortal:
    def __init__(self):
        try:
            import gi
            gi.require_version("Gst", "1.0")
            gi.require_version("Gdk", "3.0")
            from gi.repository import Gio, GLib, Gst, Gdk
        except (ImportError, ValueError) as error:
            raise ValueError("Wayland desktop needs system Python GI, GStreamer, Gdk, PipeWire and Pillow") from error
        self.Gio, self.GLib, self.Gst, self.Gdk = Gio, GLib, Gst, Gdk
        self.bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        self.session = None
        self.request = None
        self.stream = None
        self.stream_size = None
        self.devices = 0
        self.pipeline = None
        self.sink = None
        self.pipe_fd = None
        self.closed = False
        self.closed_subscription = None
        Gst.init(None)

    def call(self, interface, method, signature, values, timeout=5000):
        return self.bus.call_sync(
            PORTAL, PATH, interface, method, self.GLib.Variant(signature, values),
            None, self.Gio.DBusCallFlags.NONE, timeout, None,
        )

    def request_call(self, interface, method, signature, values, timeout=35000):
        """Subscribe before calling: quick responses must not race the listener."""
        replies = {}

        def received(_bus, _sender, path, _interface, _signal, params):
            replies[path] = unpack(params)

        subscription = self.bus.signal_subscribe(
            PORTAL, REQUEST, "Response", None, None,
            self.Gio.DBusSignalFlags.NONE, received,
        )
        handle = None
        try:
            handle = self.call(interface, method, signature, values)[0]
            self.request = handle
            deadline = time.monotonic() + timeout / 1000
            context = self.GLib.MainContext.default()
            while handle not in replies and time.monotonic() < deadline:
                while context.pending():
                    context.iteration(False)
                if handle not in replies:
                    time.sleep(0.02)
            if handle not in replies:
                raise ValueError("Desktop permission timed out; no screen or input grant was accepted")
            code, result = replies[handle]
            if code != 0:
                raise ValueError("Desktop permission was cancelled or denied")
            return result
        finally:
            if handle and handle not in replies:
                try:
                    self.bus.call_sync(PORTAL, handle, REQUEST, "Close", None, None,
                                       self.Gio.DBusCallFlags.NONE, 2000, None)
                except Exception:
                    pass
            self.request = None
            self.bus.signal_unsubscribe(subscription)

    def on_closed(self, *_args):
        self.closed = True

    def start(self):
        if self.session and not self.closed:
            return self.status()
        self.stop()
        V = self.GLib.Variant

        def token():
            return "ctt_" + uuid.uuid4().hex

        try:
            created = self.request_call(REMOTE, "CreateSession", "(a{sv})", ({
                "handle_token": V("s", token()), "session_handle_token": V("s", token()),
            },))
            self.session = created["session_handle"]
            self.closed_subscription = self.bus.signal_subscribe(
                PORTAL, SESSION, "Closed", self.session, None,
                self.Gio.DBusSignalFlags.NONE, self.on_closed,
            )
            self.request_call(REMOTE, "SelectDevices", "(oa{sv})", (self.session, {
                "handle_token": V("s", token()), "types": V("u", 3),
            }))
            self.request_call(CAST, "SelectSources", "(oa{sv})", (self.session, {
                "handle_token": V("s", token()), "types": V("u", 1),
                "multiple": V("b", False), "cursor_mode": V("u", 2),
            }))
            granted = self.request_call(REMOTE, "Start", "(osa{sv})", (self.session, "", {
                "handle_token": V("s", token()),
            }), timeout=35000)
            self.devices = int(granted.get("devices", 0))
            streams = granted.get("streams", [])
            if self.devices != 3 or len(streams) != 1:
                raise ValueError("Share one monitor and both keyboard and pointer in the OS dialog")
            node, properties = streams[0]
            self.stream = int(node)
            # The portal uses logical coordinates for absolute input. The frame
            # can have a different pixel size under display scaling.
            size = properties.get("size")
            if not size or min(size) <= 0:
                raise ValueError("Portal did not provide a usable monitor size")
            self.stream_size = tuple(map(int, size))
            self.open_capture()
            # Do not claim a usable desktop until a real frame has arrived.
            self.screenshot()
            return self.status()
        except Exception:
            self.stop()
            raise

    def open_capture(self):
        params = self.GLib.Variant("(oa{sv})", (self.session, {}))
        reply, fds = self.bus.call_with_unix_fd_list_sync(
            PORTAL, PATH, CAST, "OpenPipeWireRemote", params, None,
            self.Gio.DBusCallFlags.NONE, 5000, None, None,
        )
        self.pipe_fd = fds.get(reply[0])
        # The node comes only from the granted portal stream, not from caller input.
        self.pipeline = self.Gst.parse_launch(
            f"pipewiresrc fd={self.pipe_fd} path={self.stream} do-timestamp=true ! "
            "videoconvert ! video/x-raw,format=RGB ! "
            "appsink name=shot sync=false max-buffers=1 drop=true"
        )
        self.sink = self.pipeline.get_by_name("shot")
        if self.pipeline.set_state(self.Gst.State.PLAYING) == self.Gst.StateChangeReturn.FAILURE:
            raise ValueError("PipeWire screen capture could not start")

    def screenshot(self):
        self.require_active()
        from PIL import Image
        sample = self.sink.emit("try-pull-sample", 5 * self.Gst.SECOND)
        if sample is None:
            raise ValueError("No frame arrived from the shared monitor")
        caps = sample.get_caps().get_structure(0)
        width, height = caps.get_value("width"), caps.get_value("height")
        if width <= 0 or height <= 0 or width * height > 80_000_000:
            raise ValueError("Invalid shared monitor frame size")
        buffer = sample.get_buffer()
        data = buffer.extract_dup(0, buffer.get_size())
        stride = len(data) // height
        if stride < width * 3 or len(data) < stride * height:
            raise ValueError("Invalid shared monitor frame")
        return Image.frombytes("RGB", (width, height), data, "raw", "RGB", stride, 1)

    def refresh_closed(self):
        context = self.GLib.MainContext.default()
        while context.pending():
            context.iteration(False)
        if self.closed:
            self.stop()

    def require_active(self, device=0):
        self.refresh_closed()
        if not self.session or not self.sink or (device and not (self.devices & device)):
            raise ValueError("Desktop sharing is stopped. Call desktop start and approve the OS dialog")

    def status(self):
        self.refresh_closed()
        if not self.session or not self.sink:
            return {"active": False, "wayland": True, "consent": "start requires OS approval"}
        return {"active": True, "wayland": True, "width": self.stream_size[0],
                "height": self.stream_size[1], "primary_display_only": False,
                "selected_monitor_only": True, "temporary": True}

    def notify(self, method, signature, values, device):
        self.require_active(device)
        self.call(REMOTE, method, signature, (self.session, {}, *values))

    def move(self, x, y):
        self.require_active(2)
        self.check_point(x, y)
        self.notify("NotifyPointerMotionAbsolute", "(oa{sv}udd)",
                    (self.stream, float(x), float(y)), 2)

    def check_point(self, x, y):
        self.require_active(2)
        width, height = self.stream_size
        if not (0 <= x < width and 0 <= y < height):
            raise ValueError("Coordinates are outside the selected monitor")

    def button(self, name, pressed):
        if name not in BUTTONS:
            raise ValueError("Unsupported mouse button")
        self.notify("NotifyPointerButton", "(oa{sv}iu)",
                    (BUTTONS[name], int(pressed)), 2)

    def key(self, name, pressed):
        self.require_active(1)
        name = {"\n": "enter", "\r": "enter", "\t": "tab"}.get(name, name)
        if len(name) == 1 and name.isascii() and name.isprintable():
            symbol = self.Gdk.unicode_to_keyval(ord(name))
        else:
            symbol = self.Gdk.keyval_from_name(KEYS.get(name.lower(), ""))
        if not symbol:
            raise ValueError("Unsupported key name")
        self.notify("NotifyKeyboardKeysym", "(oa{sv}iu)", (int(symbol), int(pressed)), 1)

    def stop(self):
        if self.pipeline:
            try:
                self.pipeline.set_state(self.Gst.State.NULL)
            except Exception:
                pass
        self.pipeline = self.sink = None
        if self.pipe_fd is not None:
            try:
                os.close(self.pipe_fd)
            except OSError:
                pass
            self.pipe_fd = None
        if self.request:
            try:
                self.bus.call_sync(PORTAL, self.request, REQUEST, "Close", None, None,
                                   self.Gio.DBusCallFlags.NONE, 2000, None)
            except Exception:
                pass
            self.request = None
        if self.session:
            try:
                self.bus.call_sync(PORTAL, self.session, SESSION, "Close", None, None,
                                   self.Gio.DBusCallFlags.NONE, 2000, None)
            except Exception:
                pass
        if self.closed_subscription:
            self.bus.signal_unsubscribe(self.closed_subscription)
            self.closed_subscription = None
        self.session = self.stream = self.stream_size = None
        self.devices = 0
        self.closed = False
