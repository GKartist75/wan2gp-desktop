#!/usr/bin/env bash
# Diagnose why wan2gp-desktop exits ~1s after start under WSLg
LOG=/mnt/c/Users/gjaku/wgp-diag.log
rm -f "$LOG"
/usr/bin/wan2gp-desktop --no-sandbox --in-process-gpu --disable-gpu > "$LOG" 2>&1
RC=$?
echo "EXIT_CODE=$RC" >> "$LOG"
echo "DONE rc=$RC"
