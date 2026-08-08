#!/usr/bin/env bash
# Clean relaunch — never pkill from the same shell that launches
LOG=/mnt/c/Users/gjaku/wgp-test4.log
rm -f "$LOG"
setsid /usr/bin/wan2gp-desktop --no-sandbox --in-process-gpu --disable-gpu > "$LOG" 2>&1 < /dev/null &
echo "launched pid $!"
