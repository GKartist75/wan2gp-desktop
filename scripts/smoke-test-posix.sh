#!/usr/bin/env bash
# smoke-test-posix.sh — Functional smoke test for the POSIX external-terminal launch
# script that main.js generates (terminal-mode). Run from git-bash/MSYS on Windows
# or any bash on Linux. Validates: bash syntax, quoting with spaces, PID file,
# HTTP wait-loop, ready path, failure path, wait-on-exit.
#
# MSYS note: when running on Windows, paths passed to native binaries (node,
# python) must be Windows-style — use cygpath -w. On Linux cygpath may not exist;
# there the POSIX paths are already correct.
set -u
PORT=17860
# Repo-local work dir (avoids MSYS /tmp <-> native-node path translation issues)
WORK="$(pwd)/.smoke-test-$$"
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

echo "[1/7] Reconstructing the generated .sh (same logic as main.js POSIX branch)..."
cat > "$WORK/gen.mjs" <<'EOF'
// Faithful copy of the shLines builder from main.js (terminal-mode POSIX branch).
const shq = (s) => "'" + String(s).replace(/'/g, `'\\''`) + "'"
function gen({ py, bootstrap, repo, pidFile, port, share, hfToken, extraArgs }) {
  const argsStr = extraArgs.map(shq).join(' ')
  const shLines = [
    '#!/usr/bin/env bash',
    'export PYTHONIOENCODING=utf-8',
    'export PYTHONUTF8=1',
    'export PYTHONUNBUFFERED=1',
    'export TQDM_MININTERVAL=0',
    'export TQDM_MINITERS=1',
    'export HF_HUB_DISABLE_PROGRESS_BARS=0',
    'export NO_PROXY=localhost,127.0.0.1,::1',
    ...(share ? ['export GRADIO_SHARE=true'] : []),
    ...(hfToken ? ['export HF_TOKEN=' + shq(hfToken), 'export HUGGINGFACE_HUB_TOKEN=' + shq(hfToken)] : []),
    'cd ' + shq(repo),
    'echo "[Wan2GP Desktop Launcher]"',
    'echo "Starting Wan2GP on port ' + port + '..."',
    'echo ""',
    shq(py) + ' -u ' + shq(bootstrap) + ' wgp.py ' + argsStr + ' &',
    'WGP_PID=$!',
    'echo "$WGP_PID" > ' + shq(pidFile),
    'echo ""',
    'echo "Waiting for Wan2GP server on port ' + port + '..."',
    'RETRY=0',
    'while [ $RETRY -lt 60 ]; do',
    '  if ' + shq(py) + ` -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:${port}/config', timeout=2).status==200 else 1)" >/dev/null 2>&1; then`,
    '    break',
    '  fi',
    '  sleep 2',
    '  RETRY=$((RETRY+1))',
    'done',
    'if [ $RETRY -ge 60 ]; then',
    '  echo "Server failed to start within 2 minutes. Check console for errors."',
    '  read -r -p "Press Enter to close..."',
    '  exit 1',
    'fi',
    'echo "Wan2GP is ready! Opening browser..."',
    'xdg-open "http://127.0.0.1:' + port + '" >/dev/null 2>&1 &',
    'echo ""',
    'echo "[Wan2GP] Server is running. Close this window to stop it."',
    'wait $WGP_PID'
  ]
  return shLines.join('\n') + '\n'
}
const [,, json] = process.argv
process.stdout.write(gen(JSON.parse(json)))
EOF

# Fake python "server": listens on $PORT /config -> 200, then sleeps 6s and exits.
# NOTE: main.js calls it as `python -u <bootstrap> wgp.py <extraArgs...>` so argv[1]
# is literally "wgp.py" — the port is NOT passed; the script hardcodes its own.
cat > "$WORK/fake-server.py" <<'EOF'
import http.server, threading, time
port = 17860
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/config':
            self.send_response(200); self.end_headers(); self.wfile.write(b'{}')
        else:
            self.send_response(404); self.end_headers()
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
time.sleep(6)
EOF

# Repo dir with a SPACE to exercise quoting.
REPO="$WORK/repo with space"
mkdir -p "$REPO"
PIDFILE="$WORK/wan2gp-terminal.pid"
PY="$(command -v python3)"

# Native binaries on Windows need Windows-style paths (MSYS mangles /e/... args).
# -m = mixed mode (forward slashes): valid JSON, and Windows accepts E:/... paths.
if command -v cygpath >/dev/null 2>&1; then
  BOOTSTRAP="$(cygpath -m "$WORK/fake-server.py")"
  GEN_WIN="$(cygpath -w "$WORK/gen.mjs")"
  BOOTSTRAP_SED_ESC="$(cygpath -m "$WORK/fake-server.py")"
else
  BOOTSTRAP="$WORK/fake-server.py"
  GEN_WIN="$WORK/gen.mjs"
  BOOTSTRAP_SED_ESC="$WORK/fake-server.py"
fi

PARAMS="{\"py\":\"$PY\",\"bootstrap\":\"$BOOTSTRAP\",\"repo\":\"$REPO\",\"pidFile\":\"$PIDFILE\",\"port\":$PORT,\"share\":true,\"hfToken\":\"tok-en-123\",\"extraArgs\":[\"--hello\",\"it's a test\"]}"
node "$GEN_WIN" "$PARAMS" > "$WORK/wan2gp-terminal.sh"
chmod +x "$WORK/wan2gp-terminal.sh"

echo "[2/7] bash -n syntax check..."
bash -n "$WORK/wan2gp-terminal.sh" && echo "  syntax OK"
echo "  --- generated script (launch + wait-loop core) ---"
sed -n '1,30p' "$WORK/wan2gp-terminal.sh"

echo "[3/7] Quoting spot-check (space in repo, quote in arg, hfToken)..."
grep -q "cd '$REPO'" "$WORK/wan2gp-terminal.sh" && echo "  cd path quoted OK" || echo "  FAIL cd quoting"
grep -q "HF_TOKEN='tok-en-123'" "$WORK/wan2gp-terminal.sh" && echo "  hfToken quoted OK" || echo "  FAIL hfToken quoting"
grep -q "it'\\\\''s a test" "$WORK/wan2gp-terminal.sh" && echo "  single-quote arg escaped OK" || echo "  FAIL single-quote arg"
grep -q -- "--server-port" "$WORK/wan2gp-terminal.sh" && echo "  WARN: unexpected --server-port" || echo "  no --server-port (matches main.js) OK"

echo "[4/7] Running generated script against fake server (ready path)..."
start=$(date +%s)
OUT="$(bash "$WORK/wan2gp-terminal.sh" 2>&1)"
rc=$?
end=$(date +%s)
echo "$OUT" | sed 's/^/  | /'
echo "  exit=$rc elapsed=$((end-start))s (expect ~6s: wait-for-server + 6s fake server)"
if [ -f "$PIDFILE" ]; then echo "  pidfile written: $(cat "$PIDFILE")"; else echo "  FAIL: pidfile missing"; fi
grep -q "Wan2GP is ready" <<<"$OUT" && echo "  READY PATH OK" || echo "  FAIL: ready message missing"

echo "[5/7] Failure path (server never starts) — retry cap 60->3 via sed for speed..."
# fake server that dies immediately without ever serving
cat > "$WORK/fake-fail.py" <<'EOF'
import sys
sys.exit(0)
EOF
if command -v cygpath >/dev/null 2>&1; then
  FAIL_BOOTSTRAP="$(cygpath -m "$WORK/fake-fail.py")"
else
  FAIL_BOOTSTRAP="$WORK/fake-fail.py"
fi
# Generate the fail variant fresh via node (no path substitution in sed — MSYS
# argument conversion mangles native-sed expressions containing E:/... paths).
PARAMS_FAIL="{\"py\":\"$PY\",\"bootstrap\":\"$FAIL_BOOTSTRAP\",\"repo\":\"$REPO\",\"pidFile\":\"$PIDFILE\",\"port\":$PORT,\"share\":true,\"hfToken\":\"tok-en-123\",\"extraArgs\":[\"--hello\",\"it's a test\"]}"
node "$GEN_WIN" "$PARAMS_FAIL" > "$WORK/fail-gen.sh"
# Only the retry cap is lowered (no paths in this sed — safe from MSYS mangling)
sed 's/-lt 60/-lt 3/; s/-ge 60/-ge 3/' "$WORK/fail-gen.sh" > "$WORK/fail2.sh"
start=$(date +%s)
OUT2="$(printf '\n' | bash "$WORK/fail2.sh" 2>&1)"
rc2=$?
end=$(date +%s)
echo "$OUT2" | sed 's/^/  | /'
echo "  exit=$rc2 elapsed=$((end-start))s (expect ~6-8s)"
[ "$rc2" -eq 1 ] && echo "  FAILURE PATH OK (exit 1)" || echo "  FAILURE PATH UNEXPECTED rc=$rc2"
grep -q "Server failed to start" <<<"$OUT2" && echo "  failure message OK" || echo "  FAIL: failure message missing"

echo "[6/7] cleanup..."
echo "[7/7] DONE"
