import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayClient } from "../src/relay-client.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RelayClient", () => {
  it("signs requests with Team Sync HMAC headers and unwraps API envelopes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          teamId: "team_001",
          hubId: "hub_001",
          accepted: 1,
          duplicated: 0,
          applied: 1,
          cursor: "cursor_001",
          events: [{ eventId: "sync_001", status: "accepted" }],
        },
      }),
    } as Response);

    const client = new RelayClient({
      relayUrl: "https://relay.example.com/",
      teamId: "team_001",
      hubId: "hub_001",
      teamSecretHash: "hashed-secret",
    });

    const result = await client.push([
      {
        eventId: "sync_001",
        teamId: "team_001",
        hubId: "hub_001",
        actorId: "member_001",
        action: "task.updated",
        resourceType: "task",
        resourceId: "task_001",
        idempotencyKey: "task.updated:task_001",
        payload: {},
        status: "pending",
        createdAt: "2026-07-10T00:00:00Z",
        updatedAt: "2026-07-10T00:00:00Z",
      },
    ]);

    expect(result.accepted).toBe(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    const timestamp = headers["x-agentgitops-timestamp"];
    expect(headers["x-agentgitops-signature"]).toBe(
      createHmac("sha256", "hashed-secret").update(`${timestamp}\nteam_001\nhub_001`).digest("hex"),
    );
    expect(headers.authorization).toBeUndefined();
  });
});
