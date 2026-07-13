// Floating-terminal overlay (its own BrowserView, layered above Wan2GP).
const body = document.getElementById('ftTermBody')
const search = document.getElementById('logSearch')
let follow = true
let buf = []
const MAX = 5000

function strip(t) {
  return t.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x08/g, '')
}
function render() {
  body.textContent = buf.join('\n')
  if (follow) body.scrollTop = body.scrollHeight
}
function setFollow(v) {
  follow = v
  const b = document.getElementById('ftFollowBtn')
  b.classList.toggle('active', follow)
  b.querySelector('.follow-text').textContent = follow ? 'Follow' : 'Paused'
}

window.w2gp.onLaunchLog(t => {
  const s = strip(t)
  if (!s) return
  buf.push(s)
  while (buf.length > MAX) buf.shift()
  render()
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
