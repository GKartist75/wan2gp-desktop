#!/usr/bin/env bash
# Fully-detached launch + marker + poll via separate calls
MARK=/mnt/c/Users/gjaku/wgp-marker.txt
LOG=/mnt/c/Users/gjaku/wgp-detached.log
rm -f "$MARK" "$LOG"
setsid /usr/bin/wan2gp-desktop --no-sandbox --in-process-gpu --disable-gpu > "$LOG" 2>&1 < /dev/null &
echo "launched, script continuing" > "$MARK"
sleep 2
echo "after 2s: $(pgrep -fc wan2gp-desktop) procs" >> "$MARK"
