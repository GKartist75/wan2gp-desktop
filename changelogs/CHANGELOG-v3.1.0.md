# Wan2GP Desktop Launcher v3.1.0

Guided LLM engine setup for Deepy Prime — Claude Code, OpenAI Codex, and OpenCode, with a safe pip box.

## What changed
- **Guided LLM engine cards (Deepy Prime).** The Dashboard now renders data-driven
  engine cards from `services/llm-engines.js` — one catalog line per engine, zero
  per-engine UI/IPC code. Each card shows CLI/pip status and a one-click action:
  - **Claude Code** — one-click `pip install claude-agent-sdk==0.1.40` (pinned on
    purpose; a newer SDK clobbers Wan2GP's MCP/Pydantic deps), a **"How to sign in"**
    button that opens the official Claude Code authentication guide, and an optional
    **Anthropic API key** field (see below).
  - **OpenAI Codex** — npm install button (`@openai/codex`), resolved on Windows via
    the `.cmd` shim so it works from a double-clicked launcher.
  - **OpenCode** — npm install button (`opencode-ai`) + a **Start/Stop server** toggle
    that runs `opencode serve` on `127.0.0.1:4096`.
- **Safe pip-spec validator (replaces the whitelist).** `assertSafePipSpec` accepts
  any PEP 440 package name ± version pin and rejects `--` flags, whitespace, and shell
  metacharacters (`; & | < > $ \` ( ) { } ' "`). New LLMs no longer require a code
  change to be installable — unknown packages go through the Advanced box and pass the
  same validator. No shell-exec bypass (RCE-safe: every install uses argv, never a shell).
- **Advanced pip box: copyable command + full-command paste.** The Advanced section now
  shows a live `pip install <spec>` preview you can copy, and accepts either a bare spec
  (`claude-agent-sdk==0.1.40`) or a full pasted command (`pip install claude-agent-sdk==0.1.40`)
  by stripping the leading `pip install` / `python -m pip install` prefix before validating.
- **Anthropic API key option (connect without Max/Pro).** Settings → "Claude / Anthropic
  API Key" stores a Console `sk-ant-...` key locally and injects `ANTHROPIC_API_KEY` into
  every Wan2GP + Claude Code spawn. Per Claude Code's auth docs, a Console key takes
  precedence over OAuth for CLI sessions, so Claude Code works without a Max/Pro plan.
  The Claude Code card shows a green "API key active" note when set.
- **Windows CLI resolution fixed.** `resolveCmd` locates `.cmd` shims (`npm.cmd`,
  `opencode.cmd`, `claude`) across PATH **and** the nvm4w/Node install dirs, fixing the
  `spawn npm ENOENT` that broke Codex/OpenCode installs when the launcher was
  double-clicked (its environment doesn't inherit nvm's PATH).
- **Claude sign-in reworked.** The previous silent `claude auth login --claudeai` launch
  blocked on Max/Pro with no feedback; the button now opens the official how-to page
  instead, and the API-key route covers the no-Max/Pro case.
- **Tests:** added `tests/pip-spec.test.js`, `tests/llm-engines.test.js`,
  `tests/resolve-cmd.test.js`, `tests/normalize-pip-spec.test.js`. Suite now
  **157 passing** (was 143).

## Upgrade
Install over 3.0.9 (or any 3.0.x). Non-disruptive. The LLM engine cards appear on the
Dashboard's "Remote LLMs / Deepy Prime" section; the Advanced pip box is unchanged in
placement, only gained the copyable preview.

## Note
This release only changes the **launcher's** LLM setup UX. Wan2GP's own
`shared/remote_llm/*` (e.g. the `wangp-codex` temp-dir cleanup traceback on Windows
catalog refresh) is upstream and untouched here.
