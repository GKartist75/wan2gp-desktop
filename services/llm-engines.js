/**
 * llm-engines.js — DATA catalog of remote LLM engines Deepy/Prompt Enhancer
 * can use (per Wan2GP docs/REMOTE_LLMS.md).
 *
 * This is DATA, not branching UI code. The guided "LLM Engine" panel renders
 * ONE generic card per entry below. To support a new engine (e.g. a future
 * "Gemini CLI"), add ONE entry here — no IPC change, no new renderer branch.
 *
 * Detection model:
 *   - `cli`:  executable name to probe on PATH (executable card shows ✓/✗).
 *             null if the engine has no CLI (pure-pip SDK).
 *   - `pipPackage`: python package to detect in the active env (shows ✓/✗).
 *             null if the engine is external only (Codex/OpenCode need no pip).
 *   - `install`: { mode:'pip', spec:'claude-agent-sdk==0.1.40' }  → guided
 *             one-click installer runs `python -m pip install <spec>` in the
 *             active env (Wan2GP's documented pinned command for Claude Code).
 *             null for external CLIs — those get a manual install hint instead.
 *   - `external`: true → not pip-installed into Wan2GP; the card shows the
 *             external install steps and a "Start server" affordance.
 *
 * Pinned versions come straight from Wan2GP's REMOTE_LLMS.md (Claude Code:
 * `pip install claude-agent-sdk==0.1.40`; "Do not install an unpinned newer
 * SDK because it can replace WanGP's MCP/Pydantic dependencies").
 */

const LLM_ENGINES = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    desc: 'Anthropic Claude Code CLI + Python bridge, for Deepy Prime.',
    docs: 'https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/REMOTE_LLMS.md#claude-code',
    cli: 'claude',
    pipPackage: 'claude_agent_sdk',
    install: { mode: 'pip', spec: 'claude-agent-sdk==0.1.40' },
    external: false,
    authHint: 'After install, run `claude auth login --claudeai` once in a terminal.',
    notes: 'Pinned to 0.1.40 on purpose — a newer SDK can clobber Wan2GP’s MCP/Pydantic deps.'
  },
  {
    id: 'codex',
    label: 'OpenAI Codex',
    desc: 'OpenAI Codex CLI. Installed via npm (standalone binary) — not pip.',
    docs: 'https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/REMOTE_LLMS.md#codex',
    cli: 'codex',
    pipPackage: null,
    install: { mode: 'npm', spec: '@openai/codex', global: true },
    external: true,
    authHint: 'Sign in via a Deepy request in Wan2GP (secure link shown in chat).',
    notes: 'Wan2GP detects the `codex` executable on PATH automatically.'
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    desc: 'Universal-provider agent (OpenAI, DeepSeek, OpenRouter, local). Talks to Wan2GP over HTTP.',
    docs: 'https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/REMOTE_LLMS.md#opencode',
    cli: 'opencode',
    pipPackage: null,
    install: { mode: 'npm', spec: 'opencode-ai', global: true },
    external: true,
    serve: { cmd: 'opencode', args: ['serve', '--hostname', '127.0.0.1', '--port', '4096'] },
    serverUrl: 'http://127.0.0.1:4096',
    authHint: 'In the OpenCode UI run `/connect`, pick a provider, follow auth. Wan2GP auto-starts `opencode serve`.',
    notes: 'Install OUTSIDE Wan2GP (npm i -g opencode-ai), then it connects to Llama.cpp / LM Studio, etc.'
  }
]

/**
 * Normalize a python import name to its importable module (PEP 503 normalized).
 * `claude_agent_sdk` → `claude_agent_sdk`. Kept simple; our entries are already
 * import-safe. Returns null for non-pip engines.
 */
function pipModuleFor(engine) {
  if (!engine || !engine.pipPackage) return null
  return engine.pipPackage.replace(/-/g, '_')
}

/**
 * npm package name for an engine's `npm install` step (global flag honored by
 * the installer). Returns null if the engine has no npm installer.
 */
function npmPackageFor(engine) {
  if (!engine || !engine.install || engine.install.mode !== 'npm') return null
  return engine.install.spec
}

module.exports = { LLM_ENGINES, pipModuleFor, npmPackageFor }

