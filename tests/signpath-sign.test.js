"use strict";
// Unit tests for scripts/signpath-sign.js — the SignPath.io code-signing hook.
// Runs a local mock SignPath API server, so no real credentials/network are
// needed. Covers: no-token skip, happy-path sign (submit→poll→download→replace),
// and a failed-signing request.

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const hook = require("../scripts/signpath-sign.js");

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const TOKEN = "test-token";

function startMockServer({ failAfterSubmits = 0 } = {}) {
  const seen = { submits: 0, statusPolls: 0 };
  const server = http.createServer((req, res) => {
    const url = req.url || "";
    if (req.method === "POST" && url.includes("/SigningRequests/SubmitWithArtifact")) {
      seen.submits += 1;
      const auth = req.headers.authorization || "";
      if (auth !== `Bearer ${TOKEN}`) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      if (seen.submits <= failAfterSubmits) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "mock server failure" }));
        return;
      }
      // Capture the uploaded artifact bytes for the signed response.
      const chunks = [];
      req.on("data", c => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const fileMatch = raw.match(/name="artifact"; filename="[^"]*"\r\n\r\n([\s\S]*?)\r\n--/);
        const original = fileMatch ? fileMatch[1] : "MOCK-ORIGINAL-BYTES";
        seen.artifactBytes = Buffer.from(`SIGNED-BYTES:${original}`);
        res.writeHead(201, {
          location: `http://127.0.0.1:${server.address().port}/api/v1/${ORG_ID}/SigningRequests/req-123`,
        });
        res.end();
      });
      return;
    }
    if (req.method === "GET" && url.includes("/SigningRequests/req-123")) {
      seen.statusPolls += 1;
      res.writeHead(200, { "content-type": "application/json" });
      if (seen.statusPolls < 2) {
        res.end(JSON.stringify({ isFinalStatus: false, status: "Processing" }));
      } else {
        res.end(
          JSON.stringify({
            isFinalStatus: true,
            status: "Completed",
            workflowStatus: "Completed",
            signedArtifactLink: `http://127.0.0.1:${server.address().port}/signed-artifact`,
          })
        );
      }
      return;
    }
    if (req.method === "GET" && url.includes("/signed-artifact")) {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(seen.artifactBytes);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({ server, seen })));
}

function withEnv(envVars, fn) {
  const saved = {};
  for (const k of Object.keys(envVars)) saved[k] = process.env[k];
  Object.assign(process.env, envVars);
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function makeTempExe(content = "MOCK-EXE-CONTENT") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "signpath-"));
  const file = path.join(dir, "Wan2GP-Test.exe");
  fs.writeFileSync(file, content);
  return file;
}

test("skips signing when SIGNPATH_API_TOKEN is unset (unsigned build stays green)", async () => {
  const file = makeTempExe();
  const original = fs.readFileSync(file);
  const logs = [];
  const origLog = console.log;
  console.log = m => logs.push(String(m));
  try {
    await withEnv(
      { SIGNPATH_API_TOKEN: "", SIGNPATH_ORGANIZATION_ID: "", SIGNPATH_PROJECT_SLUG: "", SIGNPATH_SIGNING_POLICY_SLUG: "" },
      () => hook.sign({ path: file })
    );
  } finally {
    console.log = origLog;
  }
  assert.strictEqual(fs.readFileSync(file).equals(original), true, "file must be untouched");
  assert.ok(logs.some(l => l.includes("skipping signing")), "must log the skip notice");
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test("submits, polls, downloads and replaces the artifact (happy path)", async () => {
  const { server, seen } = await startMockServer();
  const port = server.address().port;
  const file = makeTempExe();
  try {
    const envVars = {
      SIGNPATH_API_TOKEN: TOKEN,
      SIGNPATH_ORGANIZATION_ID: ORG_ID,
      SIGNPATH_PROJECT_SLUG: "wan2gp-desktop",
      SIGNPATH_SIGNING_POLICY_SLUG: "test-signing",
      SIGNPATH_API_BASE: `http://127.0.0.1:${port}/api/v1`,
      SIGNPATH_POLL_INTERVAL_SECONDS: "1",
      SIGNPATH_WAIT_TIMEOUT_SECONDS: "30",
    };
    await withEnv(envVars, () => hook.sign({ path: file }));
    const signed = fs.readFileSync(file, "utf8");
    assert.ok(signed.startsWith("SIGNED-BYTES:"), `file must be replaced with signed bytes, got: ${signed.slice(0, 60)}`);
    assert.strictEqual(seen.submits, 1, "exactly one submit");
    assert.ok(seen.statusPolls >= 2, "must poll at least twice");
  } finally {
    server.close();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

test("throws with a clear error when signing fails", async () => {
  const { server } = await startMockServer({ failAfterSubmits: 1 });
  const port = server.address().port;
  const file = makeTempExe();
  try {
    const envVars = {
      SIGNPATH_API_TOKEN: TOKEN,
      SIGNPATH_ORGANIZATION_ID: ORG_ID,
      SIGNPATH_PROJECT_SLUG: "wan2gp-desktop",
      SIGNPATH_SIGNING_POLICY_SLUG: "test-signing",
      SIGNPATH_API_BASE: `http://127.0.0.1:${port}/api/v1`,
      SIGNPATH_POLL_INTERVAL_SECONDS: "1",
      SIGNPATH_WAIT_TIMEOUT_SECONDS: "30",
    };
    await assert.rejects(() => withEnv(envVars, () => hook.sign({ path: file })), /HTTP 500/);
  } finally {
    server.close();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

test("skips nested signing pass (isNest=true) without touching the file", async () => {
  const file = makeTempExe("ALREADY-SIGNED");
  const before = fs.readFileSync(file);
  const logs = [];
  const origLog = console.log;
  console.log = m => logs.push(String(m));
  try {
    await withEnv(
      {
        SIGNPATH_API_TOKEN: TOKEN,
        SIGNPATH_ORGANIZATION_ID: ORG_ID,
        SIGNPATH_PROJECT_SLUG: "wan2gp-desktop",
        SIGNPATH_SIGNING_POLICY_SLUG: "test-signing",
      },
      () => hook.sign({ path: file, isNest: true })
    );
  } finally {
    console.log = origLog;
  }
  assert.ok(fs.readFileSync(file).equals(before), "file must be untouched");
  assert.ok(logs.some(l => l.includes("skipping, already signed remotely")), "must log the skip");
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test("throws when token set but required org/project/policy env missing", async () => {
  const file = makeTempExe();
  try {
    await assert.rejects(
      () =>
        withEnv(
          { SIGNPATH_API_TOKEN: TOKEN, SIGNPATH_ORGANIZATION_ID: "", SIGNPATH_PROJECT_SLUG: "", SIGNPATH_SIGNING_POLICY_SLUG: "" },
          () => hook.sign({ path: file })
        ),
      /SIGNPATH_ORGANIZATION_ID/
    );
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});
