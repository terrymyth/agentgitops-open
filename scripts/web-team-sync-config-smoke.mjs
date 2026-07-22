#!/usr/bin/env node
import path from "node:path";
import {
  agops,
  createSmokeRepo,
  freePort,
  makeSmokeRoot,
  requestJson,
  run,
  serverEntry,
} from "./smoke-utils.mjs";

const root = makeSmokeRoot("agops-web-team-sync-smoke-");
const projectPath = createSmokeRepo(root, "project", {
  "src/index.ts": "export const smoke = true;\n",
});

run("node", [agops, "init", "--name", "web-team-sync-smoke", "--force"], { cwd: projectPath });

const { startAgentGitOpsServer } = await import(serverEntry);
const started = await startAgentGitOpsServer({
  projectPath,
  host: "127.0.0.1",
  port: await freePort(),
});

try {
  const initial = await requestJson(`${started.url}/api/team/sync-config`);
  assert(initial.status === 200, "initial config should load");
  assert(initial.body.data.config.mode === "manual", "initial config should default to manual");

  const saved = await requestJson(`${started.url}/api/team/sync-config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "auto", intervalSeconds: 13, tokenUsage: false, handoff: true }),
  });
  assert(saved.status === 200, "valid config should save");
  assert(saved.body.data.config.mode === "auto", "saved mode should be auto");
  assert(saved.body.data.config.intervalSeconds === 13, "saved interval should be persisted");
  assert(saved.body.data.config.tokenUsage === false, "saved tokenUsage should be persisted");

  const loaded = await requestJson(`${started.url}/api/team/sync-config`);
  assert(loaded.body.data.config.mode === "auto", "saved config should be readable");
  assert(loaded.body.data.config.intervalSeconds === 13, "saved interval should be readable");
  assert(loaded.body.data.config.tokenUsage === false, "saved tokenUsage should be readable");

  const badMode = await requestJson(`${started.url}/api/team/sync-config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "fast" }),
  });
  assert(badMode.status === 400, "invalid mode should return 400");
  assert(badMode.body.error?.code === "TEAM_SYNC_ERROR", "invalid mode should use TEAM_SYNC_ERROR");

  const badInterval = await requestJson(`${started.url}/api/team/sync-config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ intervalSeconds: 1 }),
  });
  assert(badInterval.status === 400, "invalid interval should return 400");
  assert(
    String(badInterval.body.error?.message ?? "").includes("intervalSeconds"),
    "invalid interval should explain the field",
  );

  const methodGuard = await requestJson(`${started.url}/api/team/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert(methodGuard.status === 405, "POST /api/team/status should be rejected");
  assert(
    methodGuard.body.error?.code === "METHOD_NOT_ALLOWED",
    "method guard should use METHOD_NOT_ALLOWED",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        root,
        projectPath,
        url: started.url,
        config: loaded.body.data.config,
        badMode: badMode.body.error,
        badInterval: badInterval.body.error,
        methodGuard: methodGuard.body.error,
      },
      null,
      2,
    ),
  );
} finally {
  await started.close();
}

function assert(condition, message) {
  if (!condition) throw new Error(`${message} (${path.basename(projectPath)})`);
}
