#!/usr/bin/env bash
# Properly poll the app process under WSLg
LOG=/mnt/c/Users/gjaku/wgp-poll.log
rm -f "$LOG"
/usr/bin/wan2gp-desktop --no-sandbox --in-process-gpu --disable-gpu > "$LOG" 2>&1 &
PID=$!
echo "PID=$PID" >> "$LOG"
for i in $(seq 1 6); do
  sleep 5
  if kill -0 "$PID" 2>/dev/null; then
    echo "t=$((i*5))s ALIVE" >> "$LOG"
  else
    echo "t=$((i*5))s DEAD rc=$(wait $PID 2>/dev/null; echo $?)" >> "$LOG"
    break
  fi
done
echo "POLL_DONE" >> "$LOG"
