import type { AgentNote } from "./agent-note.js";
import type { AuditEvent } from "./audit-event.js";
import type { ChangePackage } from "./change-package.js";
import type { Review } from "./review.js";
import type { TaskContract } from "./task.js";

export interface ReviewContext {
  task: TaskContract;
  changePackage: ChangePackage | null;
  reviews: Review[];
  agentNotes: AgentNote[];
  audit: AuditEvent[];
  checklist: ReviewChecklistItem[];
  summary: {
    riskLevel: string;
    changedFiles: number;
    checksFailed: number;
    checksPassed: number;
    openConflicts: number;
    approvals: number;
    requestedChanges: number;
    latestNoteAt?: string;
    prUrl?: string;
  };
}

export interface ReviewChecklistItem {
  severity: "info" | "warning" | "blocker";
  title: string;
  detail: string;
}
