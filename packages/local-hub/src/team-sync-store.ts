import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type {
  BranchAdoption,
  BranchAdoptionStatus,
  ConflictGraphEdge,
  HandoffPackage,
  LocalHubRegistration,
  SyncCursor,
  SyncEvent,
  SyncEventStatus,
  SyncedAgentNote,
  SyncedChangePackage,
  SyncedReviewContext,
  SyncedTask,
  TeamMember,
  TeamProject,
} from "@agentgitops/core";
import { CONFIG_DIR, DB_FILENAME } from "@agentgitops/core";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

interface TeamProjectRow {
  team_id: string;
  name: string;
  repo_url: string;
  relay_url: string | null;
  sync_mode: TeamProject["syncMode"];
  team_secret_hash: string | null;
  settings: string;
  created_at: string;
  updated_at: string;
}

interface TeamMemberRow {
  member_id: string;
  team_id: string;
  display_name: string;
  hub_id: string;
  role: TeamMember["role"];
  joined_at: string;
  last_seen_at: string;
  status: TeamMember["status"];
}

interface LocalHubRegistrationRow {
  hub_id: string;
  team_id: string;
  member_id: string;
  machine_fingerprint: string | null;
  agent_type: string | null;
  agentgitops_version: string;
  registered_at: string;
  last_sync_at: string | null;
  sync_cursor: string | null;
  status: LocalHubRegistration["status"];
}

interface SyncCursorRow {
  cursor: string;
  team_id: string;
  hub_id: string;
  direction: SyncCursor["direction"];
  event_id: string | null;
  updated_at: string;
}

interface SyncEventRow {
  event_id: string;
  team_id: string;
  hub_id: string;
  actor_id: string;
  action: SyncEvent["action"];
  resource_type: string;
  resource_id: string;
  idempotency_key: string;
  payload: string;
  status: SyncEventStatus;
  created_at: string;
  updated_at: string;
  applied_at: string | null;
  error: string | null;
}

interface SyncedTaskRow {
  task_id: string;
  team_id: string;
  project_id: string;
  source_hub_id: string;
  owner_member_id: string | null;
  title: string;
  objective: string;
  status: string;
  agent_id: string;
  base_branch: string;
  target_branch: string;
  risk_level: string;
  risk_domains: string;
  changed_files: string;
  related_tasks: string;
  created_at: string;
  updated_at: string;
}

interface SyncedChangePackageRow {
  package_id: string;
  task_id: string;
  team_id: string;
  source_hub_id: string;
  summary: string;
  changed_files: string;
  risk_level: string;
  risk_domains: string;
  verification_summary: string;
  pr_url: string | null;
  created_at: string;
  updated_at: string;
}

interface SyncedReviewContextRow {
  context_id: string;
  task_id: string;
  team_id: string;
  source_hub_id: string;
  summary: string;
  verdict: string | null;
  key_feedback: string;
  updated_at: string;
}

interface SyncedAgentNoteRow {
  note_id: string;
  task_id: string;
  team_id: string;
  source_hub_id: string;
  author_id: string;
  note_type: SyncedAgentNote["noteType"];
  summary: string;
  files: string;
  created_at: string;
}

interface HandoffPackageRow {
  handoff_id: string;
  type: HandoffPackage["type"];
  team_id: string;
  source_task_id: string;
  target_task_id: string | null;
  source_branch: string;
  target_branch: string | null;
  created_by: string;
  created_at: string;
  summary: string;
  remaining_work: string;
  known_risks: string;
  context_feed_id: string | null;
}

interface BranchAdoptionRow {
  adoption_id: string;
  team_id: string;
  task_id: string;
  source_branch: string;
  adopted_by: string;
  previous_owner: string | null;
  status: BranchAdoptionStatus;
  created_at: string;
  updated_at: string;
}

interface ConflictGraphEdgeRow {
  edge_id: string;
  team_id: string;
  source_task_id: string;
  target_task_id: string;
  type: ConflictGraphEdge["type"];
  severity: ConflictGraphEdge["severity"];
  files: string;
  suggestion: string;
  created_at: string;
}

export interface TeamSyncStatusSummary {
  team?: TeamProject;
  localHub?: LocalHubRegistration;
  member?: TeamMember;
  members: number;
  pendingEvents: number;
  cachedTasks: number;
  cachedChangePackages: number;
  cachedReviewContexts: number;
  cachedAgentNotes: number;
  handoffPackages: number;
  activeAdoptions: number;
  conflictEdges: number;
  lastPushCursor?: SyncCursor;
  lastPullCursor?: SyncCursor;
}

export class TeamSyncStore {
  private db: import("node:sqlite").DatabaseSync;

  constructor(projectPath: string) {
    const dbDir = path.join(projectPath, CONFIG_DIR);
    const dbPath = path.join(dbDir, DB_FILENAME);
    fs.mkdirSync(dbDir, { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.init();
  }

  close(): void {
    this.db.close();
  }

  upsertTeamProject(project: TeamProject): TeamProject {
    this.db
      .prepare(
        `
      INSERT INTO team_projects (
        team_id, name, repo_url, relay_url, sync_mode, team_secret_hash, settings, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(team_id) DO UPDATE SET
        name = excluded.name,
        repo_url = excluded.repo_url,
        relay_url = excluded.relay_url,
        sync_mode = excluded.sync_mode,
        team_secret_hash = excluded.team_secret_hash,
        settings = excluded.settings,
        updated_at = excluded.updated_at
    `,
      )
      .run(
        project.teamId,
        project.name,
        project.repoUrl,
        project.relayUrl ?? null,
        project.syncMode,
        project.teamSecretHash ?? null,
        JSON.stringify(project.settings),
        project.createdAt,
        project.updatedAt,
      );
    return this.getTeamProject(project.teamId) ?? project;
  }

  getTeamProject(teamId: string): TeamProject | null {
    const row = this.db.prepare("SELECT * FROM team_projects WHERE team_id = ?").get(teamId) as
      TeamProjectRow | undefined;
    return row ? mapTeamProject(row) : null;
  }

  getDefaultTeamProject(): TeamProject | null {
    const row = this.db
      .prepare("SELECT * FROM team_projects ORDER BY updated_at DESC LIMIT 1")
      .get() as TeamProjectRow | undefined;
    return row ? mapTeamProject(row) : null;
  }

  upsertTeamMember(member: TeamMember): TeamMember {
    this.db
      .prepare(
        `
      INSERT INTO team_members (
        member_id, team_id, display_name, hub_id, role, joined_at, last_seen_at, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(member_id) DO UPDATE SET
        team_id = excluded.team_id,
        display_name = excluded.display_name,
        hub_id = excluded.hub_id,
        role = excluded.role,
        last_seen_at = excluded.last_seen_at,
        status = excluded.status
    `,
      )
      .run(
        member.memberId,
        member.teamId,
        member.displayName,
        member.hubId,
        member.role,
        member.joinedAt,
        member.lastSeenAt,
        member.status,
      );
    return this.getTeamMember(member.memberId) ?? member;
  }

  getTeamMember(memberId: string): TeamMember | null {
    const row = this.db.prepare("SELECT * FROM team_members WHERE member_id = ?").get(memberId) as
      TeamMemberRow | undefined;
    return row ? mapTeamMember(row) : null;
  }

  listTeamMembers(teamId?: string): TeamMember[] {
    const rows = teamId
      ? this.db
          .prepare("SELECT * FROM team_members WHERE team_id = ? ORDER BY display_name")
          .all(teamId)
      : this.db.prepare("SELECT * FROM team_members ORDER BY display_name").all();
    return (rows as unknown as TeamMemberRow[]).map(mapTeamMember);
  }

  upsertLocalHubRegistration(registration: LocalHubRegistration): LocalHubRegistration {
    this.db
      .prepare(
        `
      INSERT INTO local_hub_registrations (
        hub_id, team_id, member_id, machine_fingerprint, agent_type, agentgitops_version,
        registered_at, last_sync_at, sync_cursor, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(hub_id) DO UPDATE SET
        team_id = excluded.team_id,
        member_id = excluded.member_id,
        machine_fingerprint = excluded.machine_fingerprint,
        agent_type = excluded.agent_type,
        agentgitops_version = excluded.agentgitops_version,
        last_sync_at = excluded.last_sync_at,
        sync_cursor = excluded.sync_cursor,
        status = excluded.status
    `,
      )
      .run(
        registration.hubId,
        registration.teamId,
        registration.memberId,
        registration.machineFingerprint ?? null,
        registration.agentType ?? null,
        registration.agentgitopsVersion,
        registration.registeredAt,
        registration.lastSyncAt ?? null,
        registration.syncCursor ?? null,
        registration.status,
      );
    return this.getLocalHub(registration.hubId) ?? registration;
  }

  getLocalHub(hubId: string): LocalHubRegistration | null {
    const row = this.db
      .prepare("SELECT * FROM local_hub_registrations WHERE hub_id = ?")
      .get(hubId) as LocalHubRegistrationRow | undefined;
    return row ? mapLocalHubRegistration(row) : null;
  }

  getDefaultLocalHub(teamId?: string): LocalHubRegistration | null {
    const row = teamId
      ? this.db
          .prepare(
            "SELECT * FROM local_hub_registrations WHERE team_id = ? ORDER BY registered_at DESC LIMIT 1",
          )
          .get(teamId)
      : this.db
          .prepare("SELECT * FROM local_hub_registrations ORDER BY registered_at DESC LIMIT 1")
          .get();
    return row ? mapLocalHubRegistration(row as unknown as LocalHubRegistrationRow) : null;
  }

  setSyncCursor(cursor: SyncCursor): SyncCursor {
    this.db
      .prepare(
        `
      INSERT INTO sync_cursors (team_id, hub_id, direction, cursor, event_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(team_id, hub_id, direction) DO UPDATE SET
        cursor = excluded.cursor,
        event_id = excluded.event_id,
        updated_at = excluded.updated_at
    `,
      )
      .run(
        cursor.teamId,
        cursor.hubId,
        cursor.direction,
        cursor.cursor,
        cursor.eventId ?? null,
        cursor.updatedAt,
      );
    return this.getSyncCursor(cursor.teamId, cursor.hubId, cursor.direction) ?? cursor;
  }

  getSyncCursor(
    teamId: string,
    hubId: string,
    direction: SyncCursor["direction"],
  ): SyncCursor | null {
    const row = this.db
      .prepare("SELECT * FROM sync_cursors WHERE team_id = ? AND hub_id = ? AND direction = ?")
      .get(teamId, hubId, direction) as SyncCursorRow | undefined;
    return row ? mapSyncCursor(row) : null;
  }

  enqueueSyncEvent(event: SyncEvent): SyncEvent {
    this.db
      .prepare(
        `
      INSERT OR IGNORE INTO sync_events (
        event_id, team_id, hub_id, actor_id, action, resource_type, resource_id,
        idempotency_key, payload, status, created_at, updated_at, applied_at, error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        event.eventId,
        event.teamId,
        event.hubId,
        event.actorId,
        event.action,
        event.resourceType,
        event.resourceId,
        event.idempotencyKey,
        JSON.stringify(event.payload),
        event.status,
        event.createdAt,
        event.updatedAt,
        event.appliedAt ?? null,
        event.error ?? null,
      );
    return (
      this.getSyncEvent(event.eventId) ??
      this.getSyncEventByIdempotencyKey(event.idempotencyKey) ??
      event
    );
  }

  getSyncEvent(eventId: string): SyncEvent | null {
    const row = this.db.prepare("SELECT * FROM sync_events WHERE event_id = ?").get(eventId) as
      SyncEventRow | undefined;
    return row ? mapSyncEvent(row) : null;
  }

  getSyncEventByIdempotencyKey(idempotencyKey: string): SyncEvent | null {
    const row = this.db
      .prepare("SELECT * FROM sync_events WHERE idempotency_key = ?")
      .get(idempotencyKey) as SyncEventRow | undefined;
    return row ? mapSyncEvent(row) : null;
  }

  listPendingEvents(teamId?: string): SyncEvent[] {
    const rows = teamId
      ? this.db
          .prepare(
            "SELECT * FROM sync_events WHERE team_id = ? AND status = 'pending' ORDER BY created_at",
          )
          .all(teamId)
      : this.db
          .prepare("SELECT * FROM sync_events WHERE status = 'pending' ORDER BY created_at")
          .all();
    return (rows as unknown as SyncEventRow[]).map(mapSyncEvent);
  }

  listSyncEvents(
    options: {
      teamId?: string;
      afterCreatedAt?: string;
      afterEventId?: string;
      excludeHubId?: string;
      limit?: number;
    } = {},
  ): SyncEvent[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (options.teamId) {
      clauses.push("team_id = ?");
      params.push(options.teamId);
    }
    if (options.afterCreatedAt && options.afterEventId) {
      clauses.push("(created_at > ? OR (created_at = ? AND event_id > ?))");
      params.push(options.afterCreatedAt, options.afterCreatedAt, options.afterEventId);
    }
    if (options.excludeHubId) {
      clauses.push("hub_id != ?");
      params.push(options.excludeHubId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    const rows = this.db
      .prepare(
        `
      SELECT * FROM sync_events
      ${where}
      ORDER BY created_at ASC, event_id ASC
      LIMIT ${limit}
    `,
      )
      .all(...params);
    return (rows as unknown as SyncEventRow[]).map(mapSyncEvent);
  }

  markEventsPushed(eventIds: string[], cursor?: SyncCursor): void {
    if (eventIds.length === 0) return;
    const now = new Date().toISOString();
    const update = this.db.prepare(
      "UPDATE sync_events SET status = 'pushed', updated_at = ? WHERE event_id = ?",
    );
    for (const eventId of eventIds) update.run(now, eventId);
    if (cursor) this.setSyncCursor(cursor);
  }

  upsertSyncedTask(task: SyncedTask): SyncedTask {
    this.db
      .prepare(
        `
      INSERT INTO synced_tasks (
        task_id, team_id, project_id, source_hub_id, owner_member_id, title, objective,
        status, agent_id, base_branch, target_branch, risk_level, risk_domains,
        changed_files, related_tasks, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        team_id = excluded.team_id,
        project_id = excluded.project_id,
        source_hub_id = excluded.source_hub_id,
        owner_member_id = excluded.owner_member_id,
        title = excluded.title,
        objective = excluded.objective,
        status = excluded.status,
        agent_id = excluded.agent_id,
        base_branch = excluded.base_branch,
        target_branch = excluded.target_branch,
        risk_level = excluded.risk_level,
        risk_domains = excluded.risk_domains,
        changed_files = excluded.changed_files,
        related_tasks = excluded.related_tasks,
        updated_at = excluded.updated_at
    `,
      )
      .run(
        task.taskId,
        task.teamId,
        task.projectId,
        task.sourceHubId,
        task.ownerMemberId ?? null,
        task.title,
        task.objective,
        task.status,
        task.agentId,
        task.baseBranch,
        task.targetBranch,
        task.riskLevel,
        JSON.stringify(task.riskDomains),
        JSON.stringify(task.changedFiles),
        JSON.stringify(task.relatedTasks),
        task.createdAt,
        task.updatedAt,
      );
    return this.getSyncedTask(task.taskId) ?? task;
  }

  getSyncedTask(taskId: string): SyncedTask | null {
    const row = this.db.prepare("SELECT * FROM synced_tasks WHERE task_id = ?").get(taskId) as
      SyncedTaskRow | undefined;
    return row ? mapSyncedTask(row) : null;
  }

  listSyncedTasks(teamId?: string): SyncedTask[] {
    const rows = teamId
      ? this.db
          .prepare("SELECT * FROM synced_tasks WHERE team_id = ? ORDER BY updated_at DESC")
          .all(teamId)
      : this.db.prepare("SELECT * FROM synced_tasks ORDER BY updated_at DESC").all();
    return (rows as unknown as SyncedTaskRow[]).map(mapSyncedTask);
  }

  upsertSyncedChangePackage(pkg: SyncedChangePackage): SyncedChangePackage {
    this.db
      .prepare(
        `
      INSERT INTO synced_change_packages (
        package_id, task_id, team_id, source_hub_id, summary, changed_files,
        risk_level, risk_domains, verification_summary, pr_url, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(package_id) DO UPDATE SET
        task_id = excluded.task_id,
        team_id = excluded.team_id,
        source_hub_id = excluded.source_hub_id,
        summary = excluded.summary,
        changed_files = excluded.changed_files,
        risk_level = excluded.risk_level,
        risk_domains = excluded.risk_domains,
        verification_summary = excluded.verification_summary,
        pr_url = excluded.pr_url,
        updated_at = excluded.updated_at
    `,
      )
      .run(
        pkg.packageId,
        pkg.taskId,
        pkg.teamId,
        pkg.sourceHubId,
        pkg.summary,
        JSON.stringify(pkg.changedFiles),
        pkg.riskLevel,
        JSON.stringify(pkg.riskDomains),
        JSON.stringify(pkg.verificationSummary),
        pkg.prUrl ?? null,
        pkg.createdAt,
        pkg.updatedAt,
      );
    return this.getSyncedChangePackage(pkg.packageId) ?? pkg;
  }

  getSyncedChangePackage(packageId: string): SyncedChangePackage | null {
    const row = this.db
      .prepare("SELECT * FROM synced_change_packages WHERE package_id = ?")
      .get(packageId) as SyncedChangePackageRow | undefined;
    return row ? mapSyncedChangePackage(row) : null;
  }

  listSyncedChangePackages(teamId?: string, taskId?: string): SyncedChangePackage[] {
    const rows =
      teamId && taskId
        ? this.db
            .prepare(
              "SELECT * FROM synced_change_packages WHERE team_id = ? AND task_id = ? ORDER BY updated_at DESC",
            )
            .all(teamId, taskId)
        : teamId
          ? this.db
              .prepare(
                "SELECT * FROM synced_change_packages WHERE team_id = ? ORDER BY updated_at DESC",
              )
              .all(teamId)
          : this.db.prepare("SELECT * FROM synced_change_packages ORDER BY updated_at DESC").all();
    return (rows as unknown as SyncedChangePackageRow[]).map(mapSyncedChangePackage);
  }

  upsertSyncedReviewContext(context: SyncedReviewContext): SyncedReviewContext {
    this.db
      .prepare(
        `
      INSERT INTO synced_review_contexts (
        context_id, task_id, team_id, source_hub_id, summary, verdict, key_feedback, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(context_id) DO UPDATE SET
        task_id = excluded.task_id,
        team_id = excluded.team_id,
        source_hub_id = excluded.source_hub_id,
        summary = excluded.summary,
        verdict = excluded.verdict,
        key_feedback = excluded.key_feedback,
        updated_at = excluded.updated_at
    `,
      )
      .run(
        context.contextId,
        context.taskId,
        context.teamId,
        context.sourceHubId,
        context.summary,
        context.verdict ?? null,
        JSON.stringify(context.keyFeedback),
        context.updatedAt,
      );
    return this.getSyncedReviewContext(context.contextId) ?? context;
  }

  getSyncedReviewContext(contextId: string): SyncedReviewContext | null {
    const row = this.db
      .prepare("SELECT * FROM synced_review_contexts WHERE context_id = ?")
      .get(contextId) as SyncedReviewContextRow | undefined;
    return row ? mapSyncedReviewContext(row) : null;
  }

  listSyncedReviewContexts(teamId?: string, taskId?: string): SyncedReviewContext[] {
    const rows =
      teamId && taskId
        ? this.db
            .prepare(
              "SELECT * FROM synced_review_contexts WHERE team_id = ? AND task_id = ? ORDER BY updated_at DESC",
            )
            .all(teamId, taskId)
        : teamId
          ? this.db
              .prepare(
                "SELECT * FROM synced_review_contexts WHERE team_id = ? ORDER BY updated_at DESC",
              )
              .all(teamId)
          : this.db.prepare("SELECT * FROM synced_review_contexts ORDER BY updated_at DESC").all();
    return (rows as unknown as SyncedReviewContextRow[]).map(mapSyncedReviewContext);
  }

  upsertSyncedAgentNote(note: SyncedAgentNote): SyncedAgentNote {
    this.db
      .prepare(
        `
      INSERT INTO synced_agent_notes (
        note_id, task_id, team_id, source_hub_id, author_id, note_type, summary, files, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(note_id) DO UPDATE SET
        task_id = excluded.task_id,
        team_id = excluded.team_id,
        source_hub_id = excluded.source_hub_id,
        author_id = excluded.author_id,
        note_type = excluded.note_type,
        summary = excluded.summary,
        files = excluded.files
    `,
      )
      .run(
        note.noteId,
        note.taskId,
        note.teamId,
        note.sourceHubId,
        note.authorId,
        note.noteType,
        note.summary,
        JSON.stringify(note.files),
        note.createdAt,
      );
    return this.getSyncedAgentNote(note.noteId) ?? note;
  }

  getSyncedAgentNote(noteId: string): SyncedAgentNote | null {
    const row = this.db
      .prepare("SELECT * FROM synced_agent_notes WHERE note_id = ?")
      .get(noteId) as SyncedAgentNoteRow | undefined;
    return row ? mapSyncedAgentNote(row) : null;
  }

  listSyncedAgentNotes(teamId?: string, taskId?: string): SyncedAgentNote[] {
    const rows =
      teamId && taskId
        ? this.db
            .prepare(
              "SELECT * FROM synced_agent_notes WHERE team_id = ? AND task_id = ? ORDER BY created_at DESC",
            )
            .all(teamId, taskId)
        : teamId
          ? this.db
              .prepare(
                "SELECT * FROM synced_agent_notes WHERE team_id = ? ORDER BY created_at DESC",
              )
              .all(teamId)
          : this.db.prepare("SELECT * FROM synced_agent_notes ORDER BY created_at DESC").all();
    return (rows as unknown as SyncedAgentNoteRow[]).map(mapSyncedAgentNote);
  }

  upsertHandoffPackage(pkg: HandoffPackage): HandoffPackage {
    this.db
      .prepare(
        `
      INSERT INTO handoff_packages (
        handoff_id, type, team_id, source_task_id, target_task_id, source_branch,
        target_branch, created_by, created_at, summary, remaining_work, known_risks, context_feed_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(handoff_id) DO UPDATE SET
        type = excluded.type,
        team_id = excluded.team_id,
        source_task_id = excluded.source_task_id,
        target_task_id = excluded.target_task_id,
        source_branch = excluded.source_branch,
        target_branch = excluded.target_branch,
        created_by = excluded.created_by,
        summary = excluded.summary,
        remaining_work = excluded.remaining_work,
        known_risks = excluded.known_risks,
        context_feed_id = excluded.context_feed_id
    `,
      )
      .run(
        pkg.handoffId,
        pkg.type,
        pkg.teamId,
        pkg.sourceTaskId,
        pkg.targetTaskId ?? null,
        pkg.sourceBranch,
        pkg.targetBranch ?? null,
        pkg.createdBy,
        pkg.createdAt,
        pkg.summary,
        JSON.stringify(pkg.remainingWork),
        JSON.stringify(pkg.knownRisks),
        pkg.contextFeedId ?? null,
      );
    return this.getHandoffPackage(pkg.handoffId) ?? pkg;
  }

  getHandoffPackage(handoffId: string): HandoffPackage | null {
    const row = this.db
      .prepare("SELECT * FROM handoff_packages WHERE handoff_id = ?")
      .get(handoffId) as HandoffPackageRow | undefined;
    return row ? mapHandoffPackage(row) : null;
  }

  listHandoffPackages(teamId?: string, sourceTaskId?: string): HandoffPackage[] {
    const rows =
      teamId && sourceTaskId
        ? this.db
            .prepare(
              "SELECT * FROM handoff_packages WHERE team_id = ? AND source_task_id = ? ORDER BY created_at DESC",
            )
            .all(teamId, sourceTaskId)
        : teamId
          ? this.db
              .prepare("SELECT * FROM handoff_packages WHERE team_id = ? ORDER BY created_at DESC")
              .all(teamId)
          : this.db.prepare("SELECT * FROM handoff_packages ORDER BY created_at DESC").all();
    return (rows as unknown as HandoffPackageRow[]).map(mapHandoffPackage);
  }

  upsertBranchAdoption(adoption: BranchAdoption): BranchAdoption {
    this.db
      .prepare(
        `
      INSERT INTO branch_adoptions (
        adoption_id, team_id, task_id, source_branch, adopted_by, previous_owner, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(adoption_id) DO UPDATE SET
        team_id = excluded.team_id,
        task_id = excluded.task_id,
        source_branch = excluded.source_branch,
        adopted_by = excluded.adopted_by,
        previous_owner = excluded.previous_owner,
        status = excluded.status,
        updated_at = excluded.updated_at
    `,
      )
      .run(
        adoption.adoptionId,
        adoption.teamId,
        adoption.taskId,
        adoption.sourceBranch,
        adoption.adoptedBy,
        adoption.previousOwner ?? null,
        adoption.status,
        adoption.createdAt,
        adoption.updatedAt,
      );
    return this.getBranchAdoption(adoption.adoptionId) ?? adoption;
  }

  getBranchAdoption(adoptionId: string): BranchAdoption | null {
    const row = this.db
      .prepare("SELECT * FROM branch_adoptions WHERE adoption_id = ?")
      .get(adoptionId) as BranchAdoptionRow | undefined;
    return row ? mapBranchAdoption(row) : null;
  }

  getActiveBranchAdoption(teamId: string, taskId: string): BranchAdoption | null {
    const row = this.db
      .prepare(
        `
      SELECT * FROM branch_adoptions
      WHERE team_id = ? AND task_id = ? AND status = 'active'
      ORDER BY updated_at DESC LIMIT 1
    `,
      )
      .get(teamId, taskId) as BranchAdoptionRow | undefined;
    return row ? mapBranchAdoption(row) : null;
  }

  listBranchAdoptions(teamId?: string, status?: BranchAdoptionStatus): BranchAdoption[] {
    const rows =
      teamId && status
        ? this.db
            .prepare(
              "SELECT * FROM branch_adoptions WHERE team_id = ? AND status = ? ORDER BY updated_at DESC",
            )
            .all(teamId, status)
        : teamId
          ? this.db
              .prepare("SELECT * FROM branch_adoptions WHERE team_id = ? ORDER BY updated_at DESC")
              .all(teamId)
          : status
            ? this.db
                .prepare("SELECT * FROM branch_adoptions WHERE status = ? ORDER BY updated_at DESC")
                .all(status)
            : this.db.prepare("SELECT * FROM branch_adoptions ORDER BY updated_at DESC").all();
    return (rows as unknown as BranchAdoptionRow[]).map(mapBranchAdoption);
  }

  upsertConflictGraphEdge(edge: ConflictGraphEdge): ConflictGraphEdge {
    this.db
      .prepare(
        `
      INSERT INTO conflict_graph_edges (
        edge_id, team_id, source_task_id, target_task_id, type, severity, files, suggestion, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(edge_id) DO UPDATE SET
        team_id = excluded.team_id,
        source_task_id = excluded.source_task_id,
        target_task_id = excluded.target_task_id,
        type = excluded.type,
        severity = excluded.severity,
        files = excluded.files,
        suggestion = excluded.suggestion,
        created_at = excluded.created_at
    `,
      )
      .run(
        edge.edgeId,
        edge.teamId,
        edge.sourceTaskId,
        edge.targetTaskId,
        edge.type,
        edge.severity,
        JSON.stringify(edge.files),
        edge.suggestion,
        edge.createdAt,
      );
    return this.getConflictGraphEdge(edge.edgeId) ?? edge;
  }

  getConflictGraphEdge(edgeId: string): ConflictGraphEdge | null {
    const row = this.db
      .prepare("SELECT * FROM conflict_graph_edges WHERE edge_id = ?")
      .get(edgeId) as ConflictGraphEdgeRow | undefined;
    return row ? mapConflictGraphEdge(row) : null;
  }

  replaceConflictGraphEdges(teamId: string, edges: ConflictGraphEdge[]): ConflictGraphEdge[] {
    this.db.prepare("DELETE FROM conflict_graph_edges WHERE team_id = ?").run(teamId);
    return edges.map((edge) => this.upsertConflictGraphEdge(edge));
  }

  listConflictGraphEdges(teamId?: string): ConflictGraphEdge[] {
    const rows = teamId
      ? this.db
          .prepare("SELECT * FROM conflict_graph_edges WHERE team_id = ? ORDER BY created_at DESC")
          .all(teamId)
      : this.db.prepare("SELECT * FROM conflict_graph_edges ORDER BY created_at DESC").all();
    return (rows as unknown as ConflictGraphEdgeRow[])
      .map(mapConflictGraphEdge)
      .sort((a, b) => conflictSeverityRank(b.severity) - conflictSeverityRank(a.severity));
  }

  getStatusSummary(teamId?: string): TeamSyncStatusSummary {
    const team = teamId ? this.getTeamProject(teamId) : this.getDefaultTeamProject();
    const localHub = team ? this.getDefaultLocalHub(team.teamId) : this.getDefaultLocalHub();
    const member = localHub ? this.getTeamMember(localHub.memberId) : null;
    const members = team ? this.listTeamMembers(team.teamId).length : this.listTeamMembers().length;
    const pendingEvents = team
      ? this.listPendingEvents(team.teamId).length
      : this.listPendingEvents().length;
    const cachedTasks = team
      ? this.listSyncedTasks(team.teamId).length
      : this.listSyncedTasks().length;
    const cachedChangePackages = team
      ? this.listSyncedChangePackages(team.teamId).length
      : this.listSyncedChangePackages().length;
    const cachedReviewContexts = team
      ? this.listSyncedReviewContexts(team.teamId).length
      : this.listSyncedReviewContexts().length;
    const cachedAgentNotes = team
      ? this.listSyncedAgentNotes(team.teamId).length
      : this.listSyncedAgentNotes().length;
    const handoffPackages = team
      ? this.listHandoffPackages(team.teamId).length
      : this.listHandoffPackages().length;
    const activeAdoptions = team
      ? this.listBranchAdoptions(team.teamId, "active").length
      : this.listBranchAdoptions(undefined, "active").length;
    const conflictEdges = team
      ? this.listConflictGraphEdges(team.teamId).length
      : this.listConflictGraphEdges().length;
    return {
      team: team ?? undefined,
      localHub: localHub ?? undefined,
      member: member ?? undefined,
      members,
      pendingEvents,
      cachedTasks,
      cachedChangePackages,
      cachedReviewContexts,
      cachedAgentNotes,
      handoffPackages,
      activeAdoptions,
      conflictEdges,
      lastPushCursor:
        team && localHub
          ? (this.getSyncCursor(team.teamId, localHub.hubId, "push") ?? undefined)
          : undefined,
      lastPullCursor:
        team && localHub
          ? (this.getSyncCursor(team.teamId, localHub.hubId, "pull") ?? undefined)
          : undefined,
    };
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS team_projects (
        team_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        repo_url TEXT NOT NULL,
        relay_url TEXT,
        sync_mode TEXT NOT NULL,
        team_secret_hash TEXT,
        settings TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS team_members (
        member_id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        hub_id TEXT NOT NULL,
        role TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);

      CREATE TABLE IF NOT EXISTS local_hub_registrations (
        hub_id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        machine_fingerprint TEXT,
        agent_type TEXT,
        agentgitops_version TEXT NOT NULL,
        registered_at TEXT NOT NULL,
        last_sync_at TEXT,
        sync_cursor TEXT,
        status TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_local_hubs_team ON local_hub_registrations(team_id);

      CREATE TABLE IF NOT EXISTS sync_cursors (
        team_id TEXT NOT NULL,
        hub_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        cursor TEXT NOT NULL,
        event_id TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(team_id, hub_id, direction)
      );

      CREATE TABLE IF NOT EXISTS sync_events (
        event_id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        hub_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        applied_at TEXT,
        error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sync_events_pending ON sync_events(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_sync_events_team ON sync_events(team_id, created_at);

      CREATE TABLE IF NOT EXISTS synced_tasks (
        task_id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        source_hub_id TEXT NOT NULL,
        owner_member_id TEXT,
        title TEXT NOT NULL,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        base_branch TEXT NOT NULL,
        target_branch TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        risk_domains TEXT NOT NULL,
        changed_files TEXT NOT NULL,
        related_tasks TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_synced_tasks_team ON synced_tasks(team_id, updated_at);

      CREATE TABLE IF NOT EXISTS synced_change_packages (
        package_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        source_hub_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        changed_files TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        risk_domains TEXT NOT NULL,
        verification_summary TEXT NOT NULL,
        pr_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_synced_change_packages_team ON synced_change_packages(team_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_synced_change_packages_task ON synced_change_packages(task_id, updated_at);

      CREATE TABLE IF NOT EXISTS synced_review_contexts (
        context_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        source_hub_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        verdict TEXT,
        key_feedback TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_synced_review_contexts_team ON synced_review_contexts(team_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_synced_review_contexts_task ON synced_review_contexts(task_id, updated_at);

      CREATE TABLE IF NOT EXISTS synced_agent_notes (
        note_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        source_hub_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        note_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        files TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_synced_agent_notes_team ON synced_agent_notes(team_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_synced_agent_notes_task ON synced_agent_notes(task_id, created_at);

      CREATE TABLE IF NOT EXISTS handoff_packages (
        handoff_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        team_id TEXT NOT NULL,
        source_task_id TEXT NOT NULL,
        target_task_id TEXT,
        source_branch TEXT NOT NULL,
        target_branch TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        summary TEXT NOT NULL,
        remaining_work TEXT NOT NULL,
        known_risks TEXT NOT NULL,
        context_feed_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_handoff_packages_team ON handoff_packages(team_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_handoff_packages_source_task ON handoff_packages(source_task_id, created_at);

      CREATE TABLE IF NOT EXISTS branch_adoptions (
        adoption_id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        source_branch TEXT NOT NULL,
        adopted_by TEXT NOT NULL,
        previous_owner TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_branch_adoptions_team ON branch_adoptions(team_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_branch_adoptions_task_status ON branch_adoptions(team_id, task_id, status);

      CREATE TABLE IF NOT EXISTS conflict_graph_edges (
        edge_id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        source_task_id TEXT NOT NULL,
        target_task_id TEXT NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        files TEXT NOT NULL,
        suggestion TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conflict_graph_edges_team ON conflict_graph_edges(team_id, severity, created_at);
      CREATE INDEX IF NOT EXISTS idx_conflict_graph_edges_tasks ON conflict_graph_edges(source_task_id, target_task_id);
    `);
  }
}

function mapTeamProject(row: TeamProjectRow): TeamProject {
  return {
    teamId: row.team_id,
    name: row.name,
    repoUrl: row.repo_url,
    relayUrl: row.relay_url ?? undefined,
    syncMode: row.sync_mode,
    teamSecretHash: row.team_secret_hash ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    settings: JSON.parse(row.settings) as TeamProject["settings"],
  };
}

function mapTeamMember(row: TeamMemberRow): TeamMember {
  return {
    memberId: row.member_id,
    teamId: row.team_id,
    displayName: row.display_name,
    hubId: row.hub_id,
    role: row.role,
    joinedAt: row.joined_at,
    lastSeenAt: row.last_seen_at,
    status: row.status,
  };
}

function mapLocalHubRegistration(row: LocalHubRegistrationRow): LocalHubRegistration {
  return {
    hubId: row.hub_id,
    teamId: row.team_id,
    memberId: row.member_id,
    machineFingerprint: row.machine_fingerprint ?? undefined,
    agentType: row.agent_type ?? undefined,
    agentgitopsVersion: row.agentgitops_version,
    registeredAt: row.registered_at,
    lastSyncAt: row.last_sync_at ?? undefined,
    syncCursor: row.sync_cursor ?? undefined,
    status: row.status,
  };
}

function mapSyncCursor(row: SyncCursorRow): SyncCursor {
  return {
    cursor: row.cursor,
    teamId: row.team_id,
    hubId: row.hub_id,
    direction: row.direction,
    eventId: row.event_id ?? undefined,
    updatedAt: row.updated_at,
  };
}

function mapSyncEvent(row: SyncEventRow): SyncEvent {
  return {
    eventId: row.event_id,
    teamId: row.team_id,
    hubId: row.hub_id,
    actorId: row.actor_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    idempotencyKey: row.idempotency_key,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appliedAt: row.applied_at ?? undefined,
    error: row.error ?? undefined,
  };
}

function mapSyncedTask(row: SyncedTaskRow): SyncedTask {
  return {
    taskId: row.task_id,
    teamId: row.team_id,
    projectId: row.project_id,
    sourceHubId: row.source_hub_id,
    ownerMemberId: row.owner_member_id ?? undefined,
    title: row.title,
    objective: row.objective,
    status: row.status,
    agentId: row.agent_id,
    baseBranch: row.base_branch,
    targetBranch: row.target_branch,
    riskLevel: row.risk_level,
    riskDomains: JSON.parse(row.risk_domains) as string[],
    changedFiles: JSON.parse(row.changed_files) as string[],
    relatedTasks: JSON.parse(row.related_tasks) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSyncedChangePackage(row: SyncedChangePackageRow): SyncedChangePackage {
  return {
    packageId: row.package_id,
    taskId: row.task_id,
    teamId: row.team_id,
    sourceHubId: row.source_hub_id,
    summary: row.summary,
    changedFiles: JSON.parse(row.changed_files) as string[],
    riskLevel: row.risk_level,
    riskDomains: JSON.parse(row.risk_domains) as string[],
    verificationSummary: JSON.parse(
      row.verification_summary,
    ) as SyncedChangePackage["verificationSummary"],
    prUrl: row.pr_url ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSyncedReviewContext(row: SyncedReviewContextRow): SyncedReviewContext {
  return {
    contextId: row.context_id,
    taskId: row.task_id,
    teamId: row.team_id,
    sourceHubId: row.source_hub_id,
    summary: row.summary,
    verdict: row.verdict ?? undefined,
    keyFeedback: JSON.parse(row.key_feedback) as string[],
    updatedAt: row.updated_at,
  };
}

function mapSyncedAgentNote(row: SyncedAgentNoteRow): SyncedAgentNote {
  return {
    noteId: row.note_id,
    taskId: row.task_id,
    teamId: row.team_id,
    sourceHubId: row.source_hub_id,
    authorId: row.author_id,
    noteType: row.note_type,
    summary: row.summary,
    files: JSON.parse(row.files) as string[],
    createdAt: row.created_at,
  };
}

function mapHandoffPackage(row: HandoffPackageRow): HandoffPackage {
  return {
    handoffId: row.handoff_id,
    type: row.type,
    teamId: row.team_id,
    sourceTaskId: row.source_task_id,
    targetTaskId: row.target_task_id ?? undefined,
    sourceBranch: row.source_branch,
    targetBranch: row.target_branch ?? undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
    summary: row.summary,
    remainingWork: JSON.parse(row.remaining_work) as string[],
    knownRisks: JSON.parse(row.known_risks) as string[],
    contextFeedId: row.context_feed_id ?? undefined,
  };
}

function mapBranchAdoption(row: BranchAdoptionRow): BranchAdoption {
  return {
    adoptionId: row.adoption_id,
    teamId: row.team_id,
    taskId: row.task_id,
    sourceBranch: row.source_branch,
    adoptedBy: row.adopted_by,
    previousOwner: row.previous_owner ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapConflictGraphEdge(row: ConflictGraphEdgeRow): ConflictGraphEdge {
  return {
    edgeId: row.edge_id,
    teamId: row.team_id,
    sourceTaskId: row.source_task_id,
    targetTaskId: row.target_task_id,
    type: row.type,
    severity: row.severity,
    files: JSON.parse(row.files) as string[],
    suggestion: row.suggestion,
    createdAt: row.created_at,
  };
}

function conflictSeverityRank(severity: ConflictGraphEdge["severity"]): number {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}
