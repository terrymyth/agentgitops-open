#!/usr/bin/env node
import {
  agops,
  createSmokeRepo,
  freePort,
  localHubEntry,
  makeSmokeRoot,
  requestJson,
  run,
  serverEntry,
} from "./smoke-utils.mjs";

const root = makeSmokeRoot("agops-relay-http-smoke-");
const projectPath = createSmokeRepo(root, "relay", {
  "README.md": "# relay smoke\n",
});
const teamSecret = "relay-http-smoke-secret";

run("node", [agops, "init", "--name", "relay-http-smoke", "--force"], { cwd: projectPath });
run(
  "node",
  [
    agops,
    "team",
    "init",
    "--name",
    "Relay HTTP Smoke",
    "--secret",
    teamSecret,
    "--sync-mode",
    "relay",
  ],
  { cwd: projectPath },
);

const status = JSON.parse(
  run("node", [agops, "sync", "status", "--json"], { cwd: projectPath, echo: false }).stdout,
);
const { startAgentGitOpsServer } = await import(serverEntry);
const { RelayClient } = await import(localHubEntry);
const started = await startAgentGitOpsServer({
  projectPath,
  host: "127.0.0.1",
  port: await freePort(),
});

try {
  const clientA = new RelayClient({
    relayUrl: started.url,
    teamId: status.team.teamId,
    hubId: "hub_a",
    teamSecret,
  });
  const clientB = new RelayClient({
    relayUrl: started.url,
    teamId: status.team.teamId,
    hubId: "hub_b",
    teamSecret,
  });

  const event = {
    eventId: "sync_http_001",
    teamId: status.team.teamId,
    hubId: "hub_b",
    actorId: "member_b",
    action: "task.updated",
    resourceType: "task",
    resourceId: "task_http_001",
    idempotencyKey: "task.updated:task_http_001",
    payload: {
      task: {
        id: "task_http_001",
        title: "HTTP smoke",
        status: "reviewing",
        agentId: "codex",
        baseBranch: "main",
        targetBranch: "agent/http",
        changedFiles: ["README.md"],
        riskLevel: "low",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    },
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const pushed = await clientB.push([event]);
  assert(pushed.accepted === 1, "push should accept the event");
  assert(Boolean(pushed.cursor), "push should return a cursor");

  const pulled = await clientA.pull({ limit: 10 });
  assert(
    pulled.events.some((item) => item.eventId === event.eventId),
    "pull should include pushed event",
  );
  assert(Boolean(pulled.cursor), "pull should return a cursor");
  assert(pulled.nextCursor === pulled.cursor, "RelayClient should expose nextCursor compatibility");

  const empty = await clientA.pull({ cursor: pulled.cursor, limit: 10 });
  assert(empty.events.length === 0, "cursor pull should not repeat events");
  assert(empty.cursor === pulled.cursor, "empty pull should preserve cursor");
  assert(empty.nextCursor === pulled.cursor, "empty pull should preserve nextCursor");

  const unsigned = await requestJson(
    `${started.url}/api/sync/pull?teamId=${encodeURIComponent(status.team.teamId)}&hubId=hub_c`,
  );
  assert(unsigned.status === 401, "unsigned request should be unauthorized");
  assert(
    unsigned.body.error?.code === "TEAM_SYNC_UNAUTHORIZED",
    "unsigned request should use TEAM_SYNC_UNAUTHORIZED",
  );

  const bad = await requestJson(
    `${started.url}/api/sync/pull?teamId=${encodeURIComponent(status.team.teamId)}&hubId=hub_c`,
    {
      headers: {
        "x-agentgitops-team-id": status.team.teamId,
        "x-agentgitops-hub-id": "hub_c",
        "x-agentgitops-timestamp": new Date().toISOString(),
        "x-agentgitops-signature": "bad",
      },
    },
  );
  assert(bad.status === 403, "bad signature should be forbidden");
  assert(
    bad.body.error?.code === "TEAM_SYNC_FORBIDDEN",
    "bad signature should use TEAM_SYNC_FORBIDDEN",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        root,
        projectPath,
        url: started.url,
        pushed,
        pulledEvents: pulled.events.length,
        emptyEvents: empty.events.length,
        cursorStable: empty.cursor === pulled.cursor,
        unsigned: unsigned.body.error,
        bad: bad.body.error,
      },
      null,
      2,
    ),
  );
} finally {
  await started.close();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
