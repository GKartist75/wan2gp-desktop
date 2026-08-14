"use strict";
/**
 * SignPath.io code-signing hook for electron-builder.
 *
 * This module is referenced from electron-builder.yml as
 *   win.signtoolOptions.sign: ./scripts/signpath-sign.js
 * and is invoked by electron-builder for every Windows executable
 * (unpacked app exe, NSIS installer, ...) DURING the build — before
 * latest.yml sha512 / blockmap are computed — so auto-update hashes
 * stay valid. This is the whole reason we sign via the in-build hook
 * instead of a post-build GitHub Action (which would round-trip the
 * artifact through GitHub and invalidate those hashes).
 *
 * SignPath does a malware scan of every uploaded artifact before
 * signing it, which is what makes Windows Defender stop flagging the
 * shipped binaries.
 *
 * Required environment (CI secrets):
 *   SIGNPATH_API_TOKEN           API token for the SignPath user
 *   SIGNPATH_ORGANIZATION_ID     Organization id (GUID)
 *   SIGNPATH_PROJECT_SLUG        e.g. wan2gp-desktop
 *   SIGNPATH_SIGNING_POLICY_SLUG e.g. test-signing (auto-approve) or
 *                                release-signing (origin-verified)
 * Optional:
 *   SIGNPATH_ARTIFACT_CONFIGURATION_SLUG
 *   SIGNPATH_API_BASE            default https://app.signpath.io/api/v1
 *   SIGNPATH_WAIT_TIMEOUT_SECONDS default 600
 *   SIGNPATH_POLL_INTERVAL_SECONDS default 10
 *
 * If SIGNPATH_API_TOKEN is missing/empty the hook logs a notice and
 * returns WITHOUT signing — the build stays unsigned and CI stays
 * green until the secrets are configured.
 *
 * API reference (official): app.signpath.io/api/swagger
 *   POST {base}/{org}/SigningRequests/SubmitWithArtifact  (multipart)
 *   GET  {base}/{org}/SigningRequests/{id}                (status)
 *   GET  signedArtifactLink                               (binary)
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_BASE = "https://app.signpath.io/api/v1";

const REQUEST_TIMEOUT_MS = 60 * 1000; // per network call (submit, poll, download)
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [2000, 4000, 8000];
// Retryable transient statuses. 500 is deliberately NOT retried on the
// non-idempotent SubmitWithArtifact POST: a 500 can mean the request was
// already processed server-side, and blind re-submission would create a
// duplicate signing request (and burn a signature). Idempotent GETs (polling)
// do retry 500 — a server hiccup mid-signing is transient there.
const RETRYABLE_GET_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_POST_STATUS = new Set([429, 502, 503, 504]);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * fetch with a per-call AbortSignal.timeout and bounded retry-with-backoff for
 * transient failures (retryable HTTP statuses + network/timeout errors).
 * Returns the response of the last attempt (even if its status is still
 * retryable, so the caller can surface the error body).
 */
async function fetchWithRetry(url, options = {}, { retries = MAX_RETRIES, label = "request", retryableStatuses = RETRYABLE_GET_STATUS } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (attempt >= retries || !retryableStatuses.has(res.status)) {
        return res;
      }
      const delay = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)];
      log(`${label} attempt ${attempt + 1} returned HTTP ${res.status} — retrying in ${delay / 1000}s`);
      await sleep(delay);
    } catch (e) {
      if (attempt >= retries) {
        throw e;
      }
      const delay = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)];
      log(`${label} attempt ${attempt + 1} failed (network): ${e.message} — retrying in ${delay / 1000}s`);
      await sleep(delay);
    }
  }
}

function env(name) {
  const v = process.env[name];
  return v == null ? "" : v.trim();
}

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[signpath-sign] ${msg}`);
}

function warn(msg) {
  // eslint-disable-next-line no-console
  console.warn(`[signpath-sign] WARNING: ${msg}`);
}

function error(msg) {
  // eslint-disable-next-line no-console
  console.error(`[signpath-sign] ERROR: ${msg}`);
}

/**
 * GET helper with a 60s timeout and optional bounded retry-with-backoff.
 * The Authorization header is ONLY sent when `token` is provided — presigned
 * artifact URLs (S3/Azure) reject an explicit auth header with 400, so the
 * artifact download must be called WITHOUT a token.
 */
async function httpGet(url, token, { headers = {}, retries = 0, label = "GET" } = {}) {
  const auth = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetchWithRetry(url, { headers: { ...auth, ...headers } }, { retries, label });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} GET ${url}: ${body.slice(0, 500)}`);
  }
  return res;
}

/** Extract the signing request id from a Location header (any shape). */
function requestIdFromLocation(location) {
  if (!location) {
    throw new Error("SignPath submit response had no Location header");
  }
  const clean = location.replace(/\/+$/, "");
  const seg = clean.split("/").pop();
  if (!seg) {
    throw new Error(`Cannot parse signing request id from Location: ${location}`);
  }
  return seg;
}

/**
 * Submit, poll, and download one signed artifact, replacing the file
 * at `config.path` in place.
 */
async function signPathSign(config) {
  // electron-builder invokes the hook once per signing hash (default
  // ['sha1','sha256']); the second call is the "nested" pass meant to add
  // another signtool signature on top. Our remote signing returns one fully
  // signed artifact, so nested calls must be skipped — re-signing an
  // already-signed file would burn a second SignPath signature for nothing.
  if (config.isNest === true) {
    log(`Nested signing pass (sha256 on top of signed ${path.basename(config.path)}) — skipping, already signed remotely.`);
    return;
  }

  const token = env("SIGNPATH_API_TOKEN");
  if (!token) {
    log("SIGNPATH_API_TOKEN not set — skipping signing (build stays unsigned).");
    log("Add the SIGNPATH_* secrets to enable code signing. See docs/SIGNPATH_SIGNING.md");
    return;
  }

  const orgId = env("SIGNPATH_ORGANIZATION_ID");
  const projectSlug = env("SIGNPATH_PROJECT_SLUG");
  const policySlug = env("SIGNPATH_SIGNING_POLICY_SLUG");
  if (!orgId || !projectSlug || !policySlug) {
    throw new Error(
      "SignPath signing is enabled (SIGNPATH_API_TOKEN set) but required env is missing: " +
        `SIGNPATH_ORGANIZATION_ID=${orgId || "<empty>"}, SIGNPATH_PROJECT_SLUG=${projectSlug || "<empty>"}, ` +
        `SIGNPATH_SIGNING_POLICY_SLUG=${policySlug || "<empty>"}. ` +
        "See docs/SIGNPATH_SIGNING.md"
    );
  }

  const base = (env("SIGNPATH_API_BASE") || DEFAULT_BASE).replace(/\/+$/, "");
  const artifactConfigSlug = env("SIGNPATH_ARTIFACT_CONFIGURATION_SLUG");
  const timeoutMs = (parseInt(env("SIGNPATH_WAIT_TIMEOUT_SECONDS"), 10) || 600) * 1000;
  const pollMs = (parseInt(env("SIGNPATH_POLL_INTERVAL_SECONDS"), 10) || 10) * 1000;

  const filePath = config.path;
  const fileName = path.basename(filePath);
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (e) {
    throw new Error(`SignPath cannot sign ${fileName}: input executable not found at ${filePath} (${e.code || e.message})`);
  }
  log(`Submitting ${fileName} (${stat.size} bytes) for signing...`);

  const submitUrl = `${base}/${orgId}/SigningRequests/SubmitWithArtifact`;
  const fileBytes = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("projectSlug", projectSlug);
  form.append("signingPolicySlug", policySlug);
  if (artifactConfigSlug) {
    form.append("artifactConfigurationSlug", artifactConfigSlug);
  }
  form.append("artifact", new Blob([fileBytes]), fileName);
  const description = env("SIGNPATH_DESCRIPTION") || `${process.env.npm_package_name || ""} ${process.env.npm_package_version || ""}`.trim();
  if (description) {
    form.append("description", description);
  }
  // Origin data — required by origin-verified (release) policies. Populated
  // automatically on GitHub Actions; harmless when absent (test policies).
  if (process.env.GITHUB_REPOSITORY) {
    form.append("origin.repositoryData.sourceControlManagementType", "GitHub");
    form.append("origin.repositoryData.url", `https://github.com/${process.env.GITHUB_REPOSITORY}`);
    form.append("origin.repositoryData.isPublicRepository", "true");
    if (process.env.GITHUB_REF_NAME) form.append("origin.repositoryData.branchName", process.env.GITHUB_REF_NAME);
    if (process.env.GITHUB_SHA) form.append("origin.repositoryData.commitId", process.env.GITHUB_SHA);
  }

  let submitRes;
  try {
    // Non-idempotent POST: retry only clearly-transient statuses (429/502/503/504),
    // never 500 — a 500 may mean the request was already accepted server-side,
    // and a blind re-submit would duplicate the signing request.
    submitRes = await fetchWithRetry(submitUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }, { retries: MAX_RETRIES, label: "submit", retryableStatuses: RETRYABLE_POST_STATUS });
  } catch (e) {
    throw new Error(`SignPath submit request failed (network): ${e.message}`);
  }
  if (submitRes.status !== 201) {
    const body = await submitRes.text().catch(() => "");
    throw new Error(`SignPath submit returned HTTP ${submitRes.status}: ${body.slice(0, 500)}`);
  }
  const requestId = requestIdFromLocation(submitRes.headers.get("location"));
  log(`Signing request ${requestId} created. Polling for completion...`);

  const statusUrl = `${base}/${orgId}/SigningRequests/${requestId}`;
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";
  let warnedApproval = false;
  for (;;) {
    const res = await httpGet(statusUrl, token, { retries: MAX_RETRIES, label: "signing status" });
    const data = await res.json();
    lastStatus = data.status || data.workflowStatus || "unknown";
    if (data.isFinalStatus === true) {
      if (data.status === "Completed") {
        break; // signed
      }
      const reason = data.cancellationReason || data.workflowStatus || data.status;
      throw new Error(`SignPath signing FAILED for ${fileName}: status=${data.status} (${reason}). ` +
        (data.webLink ? `See ${data.webLink}` : ""));
    }
    if (data.status === "WaitingForApproval") {
      // Warn only on the FIRST transition into this state, not every poll.
      if (!warnedApproval) {
        warnedApproval = true;
        warn(`${fileName}: waiting for manual approval in the SignPath portal ` +
          `(use an auto-approve test-signing policy in CI) — ${data.webLink || statusUrl}`);
      }
    } else {
      warnedApproval = false; // status changed; re-arm the once-only warning
    }
    if (Date.now() > deadline) {
      throw new Error(`SignPath signing timed out after ${timeoutMs / 1000}s for ${fileName} (last status: ${lastStatus}). ` +
        (data.webLink ? `Check ${data.webLink}` : `Check ${statusUrl}`));
    }
    await new Promise(r => setTimeout(r, pollMs));
  }

  const signedLink = (await httpGet(statusUrl, token, { retries: MAX_RETRIES, label: "final status" }).then(r => r.json())).signedArtifactLink;
  if (!signedLink) {
    throw new Error(`SignPath completed but response had no signedArtifactLink for ${fileName}`);
  }
  // NO token here: signedArtifactLink is a presigned S3/Azure URL that REJECTS
  // an explicit Authorization header (HTTP 400) — signpath's own docs say to
  // fetch it unauthenticated. Passing the Bearer token here previously failed
  // every signed download. Retried, because a 5xx mid-download is transient.
  const artifactRes = await httpGet(signedLink, undefined, { retries: MAX_RETRIES, label: "artifact download" });
  const signedBuf = Buffer.from(await artifactRes.arrayBuffer());

  // Validate the bytes before replacing the exe: a 200 HTML error page (or a
  // proxy redirect page) must never overwrite the artifact. PE files start
  // with 'MZ' (0x4D 0x5A).
  if (signedBuf.length === 0) {
    throw new Error(`SignPath artifact download for ${fileName} was EMPTY (${artifactRes.status} ${artifactRes.statusText}) — refusing to replace the executable`);
  }
  if (signedBuf[0] !== 0x4D || signedBuf[1] !== 0x5A) {
    const head = signedBuf.slice(0, 64).toString("utf8").replace(/[\x00-\x1f]/g, ".");
    throw new Error(`SignPath artifact download for ${fileName} is not a valid PE executable (first bytes: ${head}) — refusing to replace the executable`);
  }
  log(`✔ Downloaded signed artifact (${signedBuf.length} bytes, valid PE header)`);

  // Atomic-ish replace: write temp next to target, then rename over it.
  const tmpPath = `${filePath}.signed.tmp`;
  fs.writeFileSync(tmpPath, signedBuf);
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    // Windows rename over existing can be flaky under AV; fall back to copy.
    fs.copyFileSync(tmpPath, filePath);
    fs.unlinkSync(tmpPath);
  }
  log(`✔ ${fileName} signed (${signedBuf.length} bytes) — request ${requestId}`);
}

module.exports = { sign: signPathSign };
