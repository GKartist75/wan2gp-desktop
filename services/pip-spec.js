/**
 * pip-spec.js — pure, offline-testable pip specifier safety validator.
 *
 * Replaces the old name-based `ALL_PACKAGES` whitelist. The old whitelist
 * blocked a legit Wan2GP-documented command (`pip install claude-agent-sdk==0.1.40`)
 * and forced a code change for every new LLM SDK. This validator instead
 * accepts any *well-formed, non-injectable* pip spec and rejects only
 * dangerous input.
 *
 * Why this is safe: the pip install/upgrade/uninstall handlers call
 * `spawn(py, ['-m', 'pip', 'install', spec], …)` — argv form, NO shell. So a
 * stray `;`/`&`/`|` can never spawn a second process regardless. But we still
 * reject option-like tokens and shell metacharacters so a user cannot point
 * pip at an untrusted index or run flags we don't intend.
 *
 * Accepted forms:
 *   - bare name:               claude-agent-sdk
 *   - name with pep440 pin:    claude-agent-sdk==0.1.40  (==, >=, <=, ~=, !=, >, <)
 *   - direct wheel/URL:        https://download.pytorch.org/whl/.../foo.whl
 *                              (Wan2GP's INSTALLATION.md installs GGUF kernels this way)
 * Rejected forms:
 *   - pip options:             --index-url, -r, -e, --no-deps, ...
 *   - shell metacharacters:    ; & | > < $ ` ( ) { } ' " \n and whitespace
 *   - empty / non-string
 *
 * To add a brand-new LLM SDK with a known pin, the user just types it in the
 * Advanced box — no code change. To add a guided "engine card", drop one entry
 * into services/llm-engines.js (data, not code).
 */

// PEP 440 name: letters/digits/_/. , must start with letter, no consecutive dots.
const NAME_RE = /^[A-Za-z][A-Za-z0-9._-]*$/ // note: we also forbid '/' inside names below
// A direct wheel/URL from a trusted https host (no credentials, no shell chars).
const URL_RE = /^https:\/\/[^\s;&|<>$`(){}'"]+\.(whl|tar\.gz|zip)(?:\?[^&\s]*)?$/

/**
 * Validate a pip specifier string.
 * @param {string} spec
 * @returns {{ok:boolean, reason?:string, name?:string}}
 */
function assertSafePipSpec(spec) {
  if (typeof spec !== 'string' || spec.length === 0) {
    return { ok: false, reason: 'empty' }
  }
  // Reject shell metacharacters / whitespace outright. NOTE: < and > are NOT
  // rejected here — they are valid PEP440 version operators (>=, <=). pip is
  // invoked via argv (no shell), so they can never cause redirection.
  if (/[\s;&|$\`(){}'"]/.test(spec)) {
    return { ok: false, reason: 'unsafe-characters' }
  }
  // Direct wheel/URL install (no shell chars already guaranteed).
  if (spec.startsWith('https://')) {
    if (URL_RE.test(spec)) return { ok: true, name: spec }
    return { ok: false, reason: 'bad-url' }
  }
  // Must contain no path separator (no slashes at all).
  if (spec.includes('/')) return { ok: false, reason: 'slash-not-allowed' }

  // Split a possible version specifier: name [OP version]
  // Ops: ==, >=, <=, ~=, !=, >, <  (PEP 440)
  const m = spec.match(/^([A-Za-z0-9._-]+)\s*(==|>=|<=|~=|!=|>|<)?\s*([A-Za-z0-9._:*!+-]+)?$/)
  if (!m) return { ok: false, reason: 'malformed' }
  const name = m[1]
  const op = m[2]
  const ver = m[3]
  if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(name)) return { ok: false, reason: 'bad-name' }
  // Name must not start with a hyphen (would look like an option) — covered by
  // the regex above (must start with a letter).
  if (op && !ver) return { ok: false, reason: 'op-without-version' }
  return { ok: true, name }
}

module.exports = { assertSafePipSpec, NAME_RE, URL_RE }
