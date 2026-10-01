#!/usr/bin/env bash
set -euo pipefail

export OPENBOT_CONTROL_PORT="${OPENBOT_CONTROL_PORT:-8787}"
export NOVNC_PORT="${NOVNC_PORT:-6080}"
export OPENBOT_MAX_SCREENS="${OPENBOT_MAX_SCREENS:-4}"
BOX_UID="${OPENBOT_BOX_UID:-1000}"
BROWSER_DIR="${OPENBOT_BROWSER_DIR:-/data/browser}"
STATUS_DIR=/run/openbot
mkdir -p "$STATUS_DIR" /data/home "$BROWSER_DIR"
chmod 755 "$STATUS_DIR"

# A stable device identity: Chrome derives its device id from the machine-id, and sites that
# "remember this device" ask for 2FA again whenever it changes (a new container on every update).
MACHINE_ID_FILE="$BROWSER_DIR/machine-id"
if ! grep -Eqx '[0-9a-f]{32}' "$MACHINE_ID_FILE" 2>/dev/null; then
  tr -d '-' </proc/sys/kernel/random/uuid >"$MACHINE_ID_FILE"
fi
cp "$MACHINE_ID_FILE" /etc/machine-id 2>/dev/null || true
mkdir -p /var/lib/dbus && cp "$MACHINE_ID_FILE" /var/lib/dbus/machine-id 2>/dev/null || true

# The owner's time zone, so pages (bookings, calendars) show the times the owner sees. A direct
# symlink: ICU reads the zone name from the link's path. TZ stays unset so Chrome follows it.
if [ -n "${OPENBOT_TZ:-}" ] && [[ "$OPENBOT_TZ" =~ ^[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)*$ ]] &&
  [ -f "/usr/share/zoneinfo/$OPENBOT_TZ" ]; then
  ln -sfn "/usr/share/zoneinfo/$OPENBOT_TZ" /etc/localtime
  echo "$OPENBOT_TZ" >/etc/timezone
fi
unset TZ

# Files: the bots' home belongs to `box` (older containers wrote it as root). `-h` never follows
# a symlink a command planted. The browser profiles and shared sign-ins stay root-only.
if [ "$(stat -c %u /data/home)" != "$BOX_UID" ] ||
  find /data/home -xdev ! -uid "$BOX_UID" -print -quit 2>/dev/null | grep -q .; then
  chown -hR "$BOX_UID:$BOX_UID" /data/home
fi
chown root:root "$BROWSER_DIR"
chmod 700 "$BROWSER_DIR"

# `box` cannot reach the desktop's own services: the control daemon, noVNC, every screen's VNC
# server and every browser's DevTools port (which would hand out every sign-in).
FIREWALL="unavailable"
if command -v iptables >/dev/null 2>&1; then
  for bin in iptables iptables-legacy; do
    command -v "$bin" >/dev/null 2>&1 || continue
    "$bin" -D OUTPUT -o lo -p tcp -m owner --uid-owner "$BOX_UID" \
      -m multiport --dports "$OPENBOT_CONTROL_PORT,$NOVNC_PORT,5900:5999,9220:9299" \
      -j REJECT --reject-with tcp-reset 2>/dev/null || true
    if "$bin" -A OUTPUT -o lo -p tcp -m owner --uid-owner "$BOX_UID" \
      -m multiport --dports "$OPENBOT_CONTROL_PORT,$NOVNC_PORT,5900:5999,9220:9299" \
      -j REJECT --reject-with tcp-reset 2>/dev/null; then
      FIREWALL="on ($bin)"
      break
    fi
  done
fi
echo "$FIREWALL" >"$STATUS_DIR/firewall"

# The daemon writes short-lived, per-display tokens here. Websockify reloads
# the file on each connection and only accepts a token for an assigned display.
touch /tmp/openbot-vnc-tokens
chmod 600 /tmp/openbot-vnc-tokens
websockify --web /usr/share/novnc --token-plugin TokenFile --token-source /tmp/openbot-vnc-tokens "${NOVNC_PORT}" >/dev/null 2>&1 &

exec node /opt/openbot/desktop-daemon.js
