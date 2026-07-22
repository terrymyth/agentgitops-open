import { describe, expect, it } from "vitest";
import type { AgentContextFeed, HandoffPackage, SyncEvent, TeamProject } from "../src/index.js";

describe("Team Sync core models", () => {
  it("defines stable team project, sync event, context feed, and handoff contracts", () => {
    const project: TeamProject = {
      teamId: "team_platform",
      name: "Platform Team",
      repoUrl: "https://github.com/example/repo.git",
      syncMode: "local",
      createdAt: "2026-07-09T00:00:00Z",
      updatedAt: "2026-07-09T00:00:00Z",
      settings: {
        syncIntervalSeconds: 60,
        contextFeedCompression: "standard",
        conflictDetectionLevel: "file",
        autoSyncOnTaskChange: false,
      },
    };

    const event: SyncEvent = {
      eventId: "sync_001",
      teamId: project.teamId,
      hubId: "hub_001",
      actorId: "member_001",
      action: "task.created",
      resourceType: "task",
      resourceId: "task-20260709-001",
      idempotencyKey: "task.created:task-20260709-001",
      payload: { title: "Add Team Sync models" },
      status: "pending",
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };

    const feed: AgentContextFeed = {
      feedId: "feed_001",
      taskId: event.resourceId,
      teamId: project.teamId,
      agentType: "codex",
      compression: "standard",
      generatedAt: project.updatedAt,
      tokenEstimate: 120,
      items: [
        {
          id: "item_001",
          layer: "survival",
          title: "Current task",
          content: "Implement Team Sync data contracts",
          source: { type: "task", id: event.resourceId, hubId: event.hubId },
          freshness: "current",
          confidence: "verified",
          createdAt: project.createdAt,
        },
      ],
      redactions: [{ kind: "token", count: 1 }],
    };

    const handoff: HandoffPackage = {
      handoffId: "handoff_001",
      type: "continue",
      teamId: project.teamId,
      sourceTaskId: event.resourceId,
      sourceBranch: "agent/task/team-sync",
      createdBy: event.actorId,
      createdAt: project.createdAt,
      summary: "Models are ready for local storage.",
      remainingWork: ["Wire Local Team Sync Store"],
      knownRisks: ["Relay transport is not implemented yet"],
      contextFeedId: feed.feedId,
    };

    expect(project.settings.contextFeedCompression).toBe("standard");
    expect(event.payload.title).toBe("Add Team Sync models");
    expect(feed.items[0].layer).toBe("survival");
    expect(handoff.contextFeedId).toBe(feed.feedId);
  });
});
