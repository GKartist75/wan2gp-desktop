# SignPath.io Code Signing (free OSS tier)

Windows Defender deletes the Wan2GP Desktop Launcher because the shipped EXEs are
unsigned (Authenticode status: `NotSigned`). The durable fix is code signing.

SignPath.io offers a **free Open Source Community tier** — their site literally
bills it as "The free Code Signing & Software Integrity solution for Open Source
Projects". Unlike Azure Trusted Signing (now "Artifact Signing"; Basic $9.99/mo —
**no free tier exists** as of 2026-08), SignPath is $0 for OSS GitHub projects.
SignPath also malware-scans every uploaded artifact before signing it, which is
what builds Defender's trust in the result.

## How this repo signs

`electron-builder.yml` wires a custom sign hook:

```yaml
win:
  signtoolOptions:
    sign: ./scripts/signpath-sign.js
```

`scripts/signpath-sign.js` is invoked by electron-builder for every Windows
executable **during** the build — before `latest.yml` sha512/blockmap are
computed — so auto-update hashes stay valid. (A post-build GitHub Action was
rejected: it round-trips the artifact through GitHub and invalidates those
hashes.)

The hook is a **no-op when `SIGNPATH_API_TOKEN` is unset** — builds stay
unsigned-but-green until you configure the secrets below.

## One-time setup (takes ~1–2 days of approval wait)

1. **Sign up** at <https://signpath.io> (GitHub SSO).
2. **Apply for the Open Source Community tier**:
   <https://signpath.io/solutions/open-source-community> — per-project approval,
   free, with daily signature limits. Approved projects are public/visible.
3. **Create the project**: slug `wan2gp-desktop`, repository
   `https://github.com/GKartist75/wan2gp-desktop`.
4. **Artifact configuration**: one for EXE/PE binaries, named e.g. `wan2gp-exe`
   (sets signing parameters; used as `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG`).
5. **Signing policies** (two, like SignPath's own demo):
   - `test-signing` — auto-approved, no origin verification → used in CI for
     anything, including PRs.
   - `release-signing` — origin-verified: only `main` branch / `v*` tags of the
     exact repo above. This is the one that matters for releases.
6. **Create an API token** for your user (or a dedicated CI user) — Settings →
   API tokens.
7. **Add GitHub secrets** to `GKartist75/wan2gp-desktop`:
   | Secret | Value |
   |---|---|
   | `SIGNPATH_API_TOKEN` | API token from step 6 |
   | `SIGNPATH_ORGANIZATION_ID` | your org id (GUID) |
   | `SIGNPATH_PROJECT_SLUG` | `wan2gp-desktop` |
   | `SIGNPATH_RELEASE_POLICY_SLUG` | `release-signing` (origin-verified; used on `v*` tag builds) |
   | `SIGNPATH_TEST_POLICY_SLUG` | `test-signing` (auto-approved; used on `dev`-branch builds) |
   | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | your artifact config slug (e.g. `wan2gp-exe`) |

   Secrets → Actions → New repository secret. Origin data
   (`GITHUB_REPOSITORY`, `GITHUB_REF_NAME`, `GITHUB_SHA`) is passed automatically
   by the hook on GitHub Actions.

   **Branch strategy.** CI builds the Windows installer on `v*` tags **and** on
   `dev`-branch pushes (see `.github/workflows/ci.yml`). Tag builds sign with
   `SIGNPATH_RELEASE_POLICY_SLUG`; dev builds sign with `SIGNPATH_TEST_POLICY_SLUG`
   (the workflow picks the policy by ref). That lets you validate the whole
   signing pipeline on dev — signed artifacts, valid `latest.yml` hashes — before
   any release, without ever burning release signatures on experiments. Dev
   builds never publish (`--publish never`).

8. **Trigger a Windows build** (push a `v*` tag) and verify in the CI log:
   `[signpath-sign] ✔ <file> signed (… bytes)` for each exe. Then verify locally:

   ```powershell
   Get-AuthenticodeSignature dist\Wan2GP-Desktop-Launcher-<ver>-win-x64.exe
   # Status: Valid, SignerCertificate Subject: CN=…SignPath…
   ```

## Local builds

`npm run build:win` / `scripts/release-win.sh` also pick up the signing hook.
Export the same env vars to sign locally (for the policy, use
`SIGNPATH_SIGNING_POLICY_SLUG` directly — locally there is no branch split);
without them, the build is unsigned (no failure, just a log line).

## End-user remediation for previously shipped unsigned builds

Users who already hit the Defender flag should:

1. Windows Security → Virus & threat protection → **Protection history** →
   find the Wan2GP entry → **Restore** (or Actions → Allow).
2. Add an exclusion for the install folder (e.g. `%LOCALAPPDATA%\Programs\wan2gp-desktop\`).
3. Re-download the latest installer from **GitHub releases** (not a forwarded copy).
4. If SmartScreen warns: **More info → Run anyway** (only while releases are
   still unsigned; a signed release removes this).

## Supplementary (free) mitigation

After each release, submit the installer to Microsoft Defender Security
Intelligence: <https://www.microsoft.com/en-us/wdsi/filesubmission>. This clears
the specific false positive for everyone, even for the signed-unsigned builds.

## Notes / limitations

- SignPath OSS daily signature limits apply (plenty for one release per day).
- First release with a brand-new cert may still show a one-time SmartScreen
  "unknown publisher" until Microsoft reputation builds; Defender will not
  delete signed binaries.
- Do NOT use the `signpath/github-action-submit-signing-request` action — it
  signs post-build via GitHub artifacts and breaks `latest.yml` hashes. The
  in-build hook is the correct integration (see above).
