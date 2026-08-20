// Pure helpers for the `get-status` IPC handler. Extracted so they can be
// unit-tested without booting Electron — this is exactly the logic that, when
// it threw (a scoping bug referencing `cfg` outside its try block), blanked the
// entire dashboard versions + kernel-wheels section.

// Parse the `||`-joined `k=v` output of the version helper script.
function parseVersions(out) {
  const versions = {}
  String(out || '').split('||').forEach(p => {
    const idx = p.indexOf('=')
    if (idx === -1) return
    const k = p.slice(0, idx)
    const v = p.slice(idx + 1)
    if (k) versions[k] = v
  })
  return versions
}

// Annotate each resolved wheel with what's actually installed.
// `installedFn(py, pipName)` must return a Promise<string|null>.
async function annotateWheels(wheels, py, installedFn) {
  const list = Array.isArray(wheels) ? wheels : []
  for (const w of list) {
    const have = await installedFn(py, w.pipName).catch(() => null)
    w.installed = have
    w.state = have ? (have === w.configured ? 'ok' : 'mismatch') : 'missing'
  }
  return list
}

module.exports = { parseVersions, annotateWheels }
