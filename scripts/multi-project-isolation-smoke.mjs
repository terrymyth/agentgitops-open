#!/usr/bin/env node
import path from "node:path";
import { existsSync } from "node:fs";
import {
  createSmokeRepo,
  freePort,
  localHubEntry,
  makeSmokeRoot,
  requestJson,
  serverEntry,
} from "./smoke-utils.mjs";

const root = makeSmokeRoot("agops-multi-project-smoke-");
const registryDir = path.join(root, "home", ".agentgitops");
const repoA = createSmokeRepo(root, "repo-a", { "README.md": "# repo-a\n" });
const repoB = createSmokeRepo(root, "repo-b", { "README.md": "# repo-b\n" });

const { ConfigLoader, ProjectRegistry, TeamSyncStore, defaultTeamSyncConfig, getRegistryFilePath } =
  await import(localHubEntry);
const { startAgentGitOpsServer } = await import(serverEntry);

await ConfigLoader.init(repoA, "repo-a", { force: true });
await ConfigLoader.init(repoB, "repo-b", { force: true });

const registry = new ProjectRegistry({ registryDir });
const projectA = await registry.add({ path: repoA, name: "Repo A" });
const projectB = await registry.add({ path: repoB, name: "Repo B" });
assert(projectA.id !== projectB.id, "project IDs should be unique");
assert(projectA.path !== projectB.path, "project paths should be unique");
assert(projectA.serverPort !== projectB.serverPort, "project ports should be unique");

let duplicateRejected = false;
try {
  await registry.add({ path: repoA, name: "Repo A again" });
} catch {
  duplicateRejected = true;
}
assert(duplicateRejected, "duplicate project paths should be rejected");

const configA = await ConfigLoader.load(repoA);
configA.team = {
  ...(configA.team ?? {}),
  sync: { ...defaultTeamSyncConfig(), mode: "auto", intervalSeconds: 17, tokenUsage: false },
};
await ConfigLoader.save(repoA, configA);

const storeA = new TeamSyncStore(repoA);
const storeB = new TeamSyncStore(repoB);
try {
  const now = new Date().toISOString();
  storeA.upsertTeamProject({
    teamId: "team_a",
    name: "Team A",
    repoUrl: "local:repo-a",
    syncMode: "local",
    createdAt: now,
    updatedAt: now,
    settings: {
      syncIntervalSeconds: 60,
      contextFeedCompression: "standard",
      conflictDetectionLevel: "file",
      autoSyncOnTaskChange: false,
    },
  });
  storeB.upsertTeamProject({
    teamId: "team_b",
    name: "Team B",
    repoUrl: "local:repo-b",
    syncMode: "local",
    createdAt: now,
    updatedAt: now,
    settings: {
      syncIntervalSeconds: 60,
      contextFeedCompression: "standard",
      conflictDetectionLevel: "file",
      autoSyncOnTaskChange: false,
    },
  });
  assert(
    storeA.getStatusSummary().team?.teamId === "team_a",
    "repo A Team Sync store should be isolated",
  );
  assert(
    storeB.getStatusSummary().team?.teamId === "team_b",
    "repo B Team Sync store should be isolated",
  );
} finally {
  storeA.close();
  storeB.close();
}

const serverA = await startAgentGitOpsServer({
  projectPath: repoA,
  host: "127.0.0.1",
  port: await freePort(),
});
const serverB = await startAgentGitOpsServer({
  projectPath: repoB,
  host: "127.0.0.1",
  port: await freePort(),
});

try {
  const apiA = await requestJson(`${serverA.url}/api/team/sync-config`);
  const apiB = await requestJson(`${serverB.url}/api/team/sync-config`);

  assert(apiA.body.data.config.mode === "auto", "repo A mode should stay auto");
  assert(apiA.body.data.config.intervalSeconds === 17, "repo A interval should stay isolated");
  assert(apiA.body.data.config.tokenUsage === false, "repo A tokenUsage should stay isolated");
  assert(apiB.body.data.config.mode === "manual", "repo B should keep default manual mode");

  console.log(
    JSON.stringify(
      {
        ok: true,
        root,
        registryDir,
        registryCount: (await registry.list()).length,
        projectA,
        projectB,
        registryFileExists: existsSync(getRegistryFilePath({ registryDir })),
        apiA: apiA.body.data.config,
        apiB: apiB.body.data.config,
      },
      null,
      2,
    ),
  );
} finally {
  await Promise.all([serverA.close(), serverB.close()]);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
