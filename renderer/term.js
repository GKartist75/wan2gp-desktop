// Floating-terminal overlay (its own BrowserView, layered above Wan2GP).
// Uses the SAME line-accumulation logic as app.js appendLog() so both views
// produce identical output — handles \r (progress overwrites), \n line splits,
// and accumulates partial lines across chunks.
const body = document.getElementById('ftTermBody')
const search = document.getElementById('logSearch')
let follow = true
let buf = []
let _lastLine = ''
const MAX = 5000

function strip(t) {
  return t.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x08/g, '')
}

// Mirrors app.js appendLog() exactly — same line-accumulation strategy
function appendToBuf(text) {
  if (!text) return
  const parts = text.replace(/\r\n/g, '\n').split(/(\r|\n)/)
  for (const part of parts) {
    if (part === '\r') {
      if (_lastLine && buf.length > 0) buf[buf.length - 1] = _lastLine
      _lastLine = ''
    } else if (part === '\n') {
      if (_lastLine.trim()) buf.push(_lastLine.trim())
      _lastLine = ''
    } else {
      _lastLine += part
    }
  }
  while (buf.length > MAX) buf.shift()
  render()
}

let _renderQueued = false
function render() {
  if (_renderQueued) return
  _renderQueued = true
  requestAnimationFrame(() => {
    _renderQueued = false
    body.textContent = buf.join('\n')
    if (follow) body.scrollTop = body.scrollHeight
  })
}
function setFollow(v) {
  follow = v
  const b = document.getElementById('ftFollowBtn')
  b.classList.toggle('active', follow)
  b.querySelector('.follow-text').textContent = follow ? 'Follow' : 'Paused'
}

// Load existing log history on startup — pipe through appendToBuf for consistency
window.w2gp.getLogHistory().then(entries => {
  for (const entry of entries) {
    appendToBuf(strip(entry.data))
  }
})

window.w2gp.onLaunchLog(t => {
  appendToBuf(strip(t))
})

window.w2gp.onSetupOutput(t => {
  appendToBuf(strip(t))
})

body.addEventListener('scroll', () => {
  const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 30
  if (atBottom !== follow) setFollow(atBottom)
})

document.getElementById('ftFollowBtn').addEventListener('click', () => setFollow(!follow))

document.querySelectorAll('.dock-btn').forEach(b => {
  b.addEventListener('click', () => window.w2gp.setDock(b.dataset.dock))
})
document.getElementById('ftCloseBtn').addEventListener('click', () => window.w2gp.closeTerm())
document.getElementById('logExportBtn').addEventListener('click', () => window.w2gp.exportLogs(buf.join('\n')))

search.addEventListener('input', () => {
  const q = search.value.toLowerCase()
  if (!q) { render(); return }
  body.textContent = buf.filter(l => l.toLowerCase().includes(q)).join('\n')
  body.scrollTop = body.scrollHeight
})
