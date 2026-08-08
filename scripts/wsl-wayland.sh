#!/usr/bin/env bash
# Launch via native Wayland (Ozone) — better WSLg rendering than X11 copy-mode
LOG=/mnt/c/Users/gjaku/wgp-wayland.log
rm -f "$LOG"
export WAYLAND_DISPLAY=wayland-0
export XDG_RUNTIME_DIR=/mnt/wslg/runtime-dir
setsid /usr/bin/wan2gp-desktop --no-sandbox --in-process-gpu --disable-gpu --ozone-platform=wayland > "$LOG" 2>&1 < /dev/null &
echo "launched pid $!"
