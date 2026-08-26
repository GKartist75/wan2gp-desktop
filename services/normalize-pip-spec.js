/**
 * normalize-pip-spec.js — accept either a bare pip spec
 * (claude-agent-sdk==0.1.40) or a full command pasted by a user
 * (pip install claude-agent-sdk==0.1.40 / python -m pip install ...) and strip
 * the leading pip invocation so the preview and the real install handler see the
 * same spec. Pure + offline-testable.
 */
function normalizePipSpec(raw) {
  let s = (raw || '').trim()
  const m = s.match(/^(?:py(?:thon)?\s+-m\s+)?pip\s+install\s+/i)
  if (m) s = s.slice(m[0].length).trim()
  return s
}

module.exports = { normalizePipSpec }
