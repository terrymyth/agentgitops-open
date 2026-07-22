import type {
  ChangePackage,
  ReviewContext,
  TaskContract,
  TeamSyncPullRequestContext,
} from "@agentgitops/core";

export interface GitHubProviderOptions {
  token: string;
  apiBaseUrl?: string;
}

export interface CreatePullRequestParams {
  repo: string;
  title: string;
  body: string;
  headBranch: string;
  baseBranch: string;
  draft?: boolean;
}

export interface PullRequestResult {
  number: number;
  url: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
}

export interface UpsertPullRequestCommentParams {
  repo: string;
  number: number;
  body: string;
  marker?: string;
}

export interface PullRequestCommentResult {
  id: number;
  url?: string;
  action: "created" | "updated";
}

export type PullRequestBodyTemplate = "ce" | "team-sync";

export interface PullRequestBodyOptions {
  template?: PullRequestBodyTemplate;
  teamSync?: TeamSyncPullRequestContext;
}

export type GitHubMergeMethod = "merge" | "squash" | "rebase";

export interface MergePullRequestParams {
  repo: string;
  number: number;
  method?: GitHubMergeMethod;
  commitTitle?: string;
  commitMessage?: string;
}

export interface MergeResult {
  merged: boolean;
  sha?: string;
  message: string;
}

/** CI check 整体状态 */
export type CheckOverallStatus = "none" | "pending" | "passed" | "failed" | "neutral";

/** 单个 check run 状态 */
export interface CheckRunStatus {
  name: string;
  status: GitHubCheckRun["status"];
  conclusion: GitHubCheckRun["conclusion"] | "stale" | null;
  url?: string;
  startedAt?: string;
  completedAt?: string;
}

/** CI check 查询结果 */
export interface CheckStatusResult {
  overall: CheckOverallStatus;
  total: number;
  completed: number;
  passed: number;
  failed: number;
  runs: CheckRunStatus[];
}

export interface GetCommitCheckRunsParams {
  repo: string;
  ref: string;
}

export interface GitHubCheckRun {
  id: number;
  name: string;
  status: "queued" | "in_progress" | "completed" | "requested" | "waiting" | "pending";
  conclusion?:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "skipped"
    | "timed_out"
    | "action_required"
    | "startup_failure";
  url?: string;
  startedAt?: string;
  completedAt?: string;
}

interface GitHubPullRequestResponse {
  number: number;
  html_url: string;
  state: "open" | "closed";
  draft?: boolean;
  merged?: boolean;
}

interface GitHubMergeResponse {
  merged: boolean;
  sha?: string;
  message: string;
}

interface GitHubIssueCommentResponse {
  id: number;
  html_url?: string;
  body?: string;
}

interface GitHubCheckRunsResponse {
  total_count: number;
  check_runs: GitHubCheckRunResponse[];
}

interface GitHubCheckRunResponse {
  id: number;
  name: string;
  status: GitHubCheckRun["status"];
  conclusion?: GitHubCheckRun["conclusion"];
  html_url?: string;
  started_at?: string;
  completed_at?: string;
}

interface GitHubErrorResponse {
  message?: string;
  errors?: unknown[];
}

export const REVIEW_CONTEXT_COMMENT_MARKER = "<!-- agentgitops:review-context -->";

export class GitHubProvider {
  private readonly apiBaseUrl: string;

  constructor(private readonly options: GitHubProviderOptions) {
    if (!options.token) {
      throw new Error("GITHUB_TOKEN or GH_TOKEN is required to create GitHub pull requests.");
    }
    this.apiBaseUrl = options.apiBaseUrl ?? "https://api.github.com";
  }

  async createOrUpdatePullRequest(params: CreatePullRequestParams): Promise<PullRequestResult> {
    const existing = await this.findOpenPullRequest(params);
    if (existing) {
      const updated = await this.request<GitHubPullRequestResponse>(
        "PATCH",
        `/repos/${encodeURIComponentRepo(params.repo)}/pulls/${existing.number}`,
        {
          title: params.title,
          body: params.body,
        },
      );
      return toPullRequestResult(updated);
    }

    try {
      const created = await this.request<GitHubPullRequestResponse>(
        "POST",
        `/repos/${encodeURIComponentRepo(params.repo)}/pulls`,
        {
          title: params.title,
          body: params.body,
          head: params.headBranch,
          base: params.baseBranch,
          draft: params.draft ?? true,
        },
      );
      return toPullRequestResult(created);
    } catch (error) {
      const retryExisting = await this.findOpenPullRequest(params);
      if (retryExisting) return retryExisting;
      throw error;
    }
  }

  async mergePullRequest(params: MergePullRequestParams): Promise<MergeResult> {
    const result = await this.request<GitHubMergeResponse>(
      "PUT",
      `/repos/${encodeURIComponentRepo(params.repo)}/pulls/${params.number}/merge`,
      {
        merge_method: params.method ?? "squash",
        commit_title: params.commitTitle,
        commit_message: params.commitMessage,
      },
    );
    return {
      merged: result.merged,
      sha: result.sha,
      message: result.message,
    };
  }

  /**
   * 查询指定 ref（分支/commit）的 CI check 状态
   *
   * 调用 GitHub Checks API，聚合 check-runs 与 status，
   * 返回整体 CI 状态和各 check 明细。
   */
  async getCheckStatuses(params: { repo: string; ref: string }): Promise<CheckStatusResult> {
    const checkRuns = await this.request<GitHubCheckRunsResponse>(
      "GET",
      `/repos/${encodeURIComponentRepo(params.repo)}/commits/${encodeURIComponent(params.ref)}/check-runs?per_page=100`,
    );

    const runs: CheckRunStatus[] = checkRuns.check_runs.map((run) => ({
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      url: run.html_url,
      startedAt: run.started_at,
      completedAt: run.completed_at,
    }));

    const total = runs.length;
    const completed = runs.filter((r) => r.status === "completed").length;
    const passed = runs.filter((r) => r.conclusion === "success").length;
    const failed = runs.filter(
      (r) =>
        r.conclusion === "failure" || r.conclusion === "cancelled" || r.conclusion === "timed_out",
    ).length;

    let overall: CheckStatusResult["overall"];
    if (total === 0) overall = "none";
    else if (completed < total) overall = "pending";
    else if (failed > 0) overall = "failed";
    else if (passed === total) overall = "passed";
    else overall = "neutral";

    return { overall, total, completed, passed, failed, runs };
  }

  async upsertPullRequestComment(
    params: UpsertPullRequestCommentParams,
  ): Promise<PullRequestCommentResult> {
    const marker = params.marker ?? REVIEW_CONTEXT_COMMENT_MARKER;
    const comments = await this.request<GitHubIssueCommentResponse[]>(
      "GET",
      `/repos/${encodeURIComponentRepo(params.repo)}/issues/${params.number}/comments?per_page=100`,
    );
    const existing = comments.find((comment) => comment.body?.includes(marker));
    if (existing) {
      const updated = await this.request<GitHubIssueCommentResponse>(
        "PATCH",
        `/repos/${encodeURIComponentRepo(params.repo)}/issues/comments/${existing.id}`,
        { body: params.body },
      );
      return { id: updated.id, url: updated.html_url, action: "updated" };
    }

    const created = await this.request<GitHubIssueCommentResponse>(
      "POST",
      `/repos/${encodeURIComponentRepo(params.repo)}/issues/${params.number}/comments`,
      { body: params.body },
    );
    return { id: created.id, url: created.html_url, action: "created" };
  }

  async getCommitCheckRuns(params: GetCommitCheckRunsParams): Promise<GitHubCheckRun[]> {
    const search = new URLSearchParams({ per_page: "100" });
    const response = await this.request<GitHubCheckRunsResponse>(
      "GET",
      `/repos/${encodeURIComponentRepo(params.repo)}/commits/${encodeURIComponent(params.ref)}/check-runs?${search.toString()}`,
    );
    return response.check_runs.map((run) => ({
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      url: run.html_url,
      startedAt: run.started_at,
      completedAt: run.completed_at,
    }));
  }

  private async findOpenPullRequest(
    params: CreatePullRequestParams,
  ): Promise<PullRequestResult | null> {
    const [owner] = params.repo.split("/");
    const search = new URLSearchParams({
      state: "open",
      head: `${owner}:${params.headBranch}`,
      base: params.baseBranch,
    });
    const pulls = await this.request<GitHubPullRequestResponse[]>(
      "GET",
      `/repos/${encodeURIComponentRepo(params.repo)}/pulls?${search.toString()}`,
    );
    const first = pulls[0];
    return first ? toPullRequestResult(first) : null;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.options.token}`,
        "Content-Type": "application/json",
        "User-Agent": "agentgitops/0.1.0",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const errorBody = (await response.json()) as GitHubErrorResponse;
        detail = errorBody.message ?? detail;
      } catch {
        // Keep status text when GitHub does not return JSON.
      }
      throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${detail}`);
    }

    return (await response.json()) as T;
  }
}

export function parseGitHubRepository(remoteUrl: string): string {
  const trimmed = remoteUrl.trim();
  const sshMatch = /^git@github\.com:(?<repo>[^/]+\/[^/]+?)(?:\.git)?$/.exec(trimmed);
  if (sshMatch?.groups?.repo) return sshMatch.groups.repo;

  const urlMatch = /^https:\/\/(?:[^@/]+@)?github\.com\/(?<repo>[^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(
    trimmed,
  );
  if (urlMatch?.groups?.repo) return urlMatch.groups.repo;

  throw new Error(`Cannot derive GitHub repository from remote URL: ${redactRemoteUrl(trimmed)}`);
}

export function formatChangePackagePullRequestBody(
  task: TaskContract,
  changePackage: ChangePackage,
  reviewContext?: ReviewContext,
  options: PullRequestBodyOptions = {},
): string {
  const checks = changePackage.checks.length
    ? changePackage.checks
        .map((check) => {
          const summary = check.outputSummary
            ? ` (${check.outputSummary.errors} errors, ${check.outputSummary.warnings} warnings)`
            : "";
          const link = check.externalUrl ? ` [details](${check.externalUrl})` : "";
          return `- ${check.status.toUpperCase()} ${check.name}: \`${check.command}\`${summary}${link}`;
        })
        .join("\n")
    : "- No verification checks recorded.";

  const unverified = changePackage.unverifiedItems.length
    ? changePackage.unverifiedItems.map((item) => `- ${item}`).join("\n")
    : "- None recorded.";

  const files = changePackage.changedFiles.length
    ? changePackage.changedFiles.map((file) => `- \`${file}\``).join("\n")
    : "- No changed files recorded.";

  const conflicts = changePackage.conflicts.length
    ? changePackage.conflicts
        .map((c) => {
          const parts = [
            `- **${c.type}** with \`${c.conflictingTaskId}\``,
            `severity: \`${c.severity}\``,
            `suggestion: \`${c.suggestion}\``,
            `status: \`${c.status}\``,
          ];
          if (c.filePath) parts.splice(1, 0, `file: \`${c.filePath}\``);
          return parts.join(" · ");
        })
        .join("\n")
    : "- No conflicts detected.";

  const evidence = changePackage.evidence
    ? [
        `- Security scan: ${changePackage.evidence.securityScan.status} (${changePackage.evidence.securityScan.findings} findings)`,
        `- Security summary: ${changePackage.evidence.securityScan.summary}`,
        `- Compared packages: ${changePackage.evidence.comparison.comparedPackages}`,
        `- Overlapping files: ${changePackage.evidence.comparison.overlappingFiles.length > 0 ? changePackage.evidence.comparison.overlappingFiles.map((file) => `\`${file}\``).join(", ") : "none"}`,
        `- Insertions delta: ${changePackage.evidence.comparison.insertionDelta}`,
        `- Deletions delta: ${changePackage.evidence.comparison.deletionDelta}`,
      ].join("\n")
    : "- No structured evidence recorded.";

  const sections = [
    "## Agent Change Package",
    "",
    `Task: \`${task.id}\``,
    `Agent: \`${task.agentId}\``,
    `Risk: \`${changePackage.risk.level}\``,
    `Base: \`${task.baseBranch}\``,
    `Head: \`${task.targetBranch}\``,
    "",
    "### Objective",
    task.objective,
    "",
    "### Summary",
    changePackage.summary,
    "",
    "### Changed Files",
    files,
    "",
    "### Stats",
    `- Files: ${changePackage.stats.filesChanged}`,
    `- Insertions: ${changePackage.stats.insertions}`,
    `- Deletions: ${changePackage.stats.deletions}`,
    "",
    "### Verification",
    checks,
    "",
    "### Evidence",
    evidence,
    "",
    "### Conflicts",
    conflicts,
    "",
    "### Unverified Items",
    unverified,
    "",
    "### Merge Recommendation",
    changePackage.mergeRecommendation,
    "",
  ];

  if (reviewContext) {
    sections.push(formatReviewContextSection(reviewContext), "");
  }

  if (options.template === "team-sync") {
    sections.push(formatTeamSyncSections(task, changePackage, options.teamSync), "");
  }

  return [...sections, "<!-- agentgitops:change-package -->"].join("\n");
}

export function formatTeamSyncSections(
  task: TaskContract,
  changePackage: ChangePackage,
  context: TeamSyncPullRequestContext = {},
): string {
  const relatedTasks = uniq([
    ...(context.relatedTasks ?? []),
    ...changePackage.conflicts.map((conflict) => conflict.conflictingTaskId),
  ]);
  const relatedBranches = uniq([...(context.relatedBranches ?? []), task.targetBranch]);
  const touchedDomains = uniq([...(context.touchedDomains ?? []), ...changePackage.risk.domains]);
  const overlappingFiles = uniq([
    ...(context.overlappingFiles ?? []),
    ...(changePackage.evidence?.comparison.overlappingFiles ?? []),
  ]);
  const conflictSignals = uniq([
    ...(context.conflictSignals ?? []),
    ...changePackage.conflicts.map((conflict) => conflict.type),
  ]);
  const sourceChangePackages = uniq([...(context.sourceChangePackages ?? []), changePackage.id]);

  return [
    "### Team Sync Context",
    "<!-- agentgitops:team-sync -->",
    `- Team Project: ${inlineCode(context.teamProject ?? task.projectId)}`,
    `- Task ID: ${inlineCode(task.id)}`,
    `- Parent / Related Tasks: ${formatInlineList(relatedTasks)}`,
    `- Continuation Of: ${formatOptionalInline(context.continuationOf)}`,
    `- Adopted From: ${formatOptionalInline(context.adoptedFrom)}`,
    `- Agent: ${inlineCode(task.agentId)}`,
    `- Local Hub Instance: ${formatOptionalInline(context.localHubInstance)}`,
    `- Source Branch: ${inlineCode(task.targetBranch)}`,
    `- Base Branch: ${inlineCode(task.baseBranch)}`,
    `- Related Branches: ${formatInlineList(relatedBranches)}`,
    `- Related PRs: ${formatInlineList(context.relatedPullRequests ?? [])}`,
    "",
    "### Collaboration Impact",
    `- Touched Domains: ${formatInlineList(touchedDomains)}`,
    `- Overlapping Files: ${formatInlineList(overlappingFiles)}`,
    `- Potential Conflict Signals: ${formatInlineList(conflictSignals)}`,
    `- Depends On: ${formatInlineList(context.dependsOn ?? [])}`,
    `- Blocks: ${formatInlineList(context.blocks ?? [])}`,
    "",
    "### Agent Context Feed",
    `- Context Feed ID: ${formatOptionalInline(context.contextFeedId)}`,
    `- Generated At: ${formatOptionalInline(context.contextFeedGeneratedAt)}`,
    `- Source Change Packages: ${formatInlineList(sourceChangePackages)}`,
    `- Used By Agent: ${formatBoolean(context.usedByAgent)}`,
    `- Human Confirmation Required: ${formatInlineList(context.humanConfirmationRequired ?? [])}`,
    "",
    "### Sync State",
    `- Sync Status: ${inlineCode(context.syncStatus ?? "local-only")}`,
    `- Last Sync Cursor: ${formatOptionalInline(context.syncCursor)}`,
    `- Team Control Plane: ${inlineCode(context.controlPlane ?? "disabled")}`,
    `- Offline Changes: ${formatBoolean(context.offlineChanges)}`,
  ].join("\n");
}

export function formatReviewContextSection(context: ReviewContext): string {
  const blockers = context.checklist.filter((item) => item.severity === "blocker");
  const warnings = context.checklist.filter((item) => item.severity === "warning");
  const latestNote = context.agentNotes[0];
  const checklist = context.checklist.length
    ? context.checklist
        .map((item) => `- ${item.severity.toUpperCase()} ${item.title}: ${item.detail}`)
        .join("\n")
    : "- No review checklist items.";

  return [
    "### Review Context Summary",
    REVIEW_CONTEXT_COMMENT_MARKER,
    `- Risk: \`${context.summary.riskLevel}\``,
    `- Files: ${context.summary.changedFiles}`,
    `- Checks: ${context.summary.checksPassed} passed / ${context.summary.checksFailed} failed`,
    `- Open conflicts: ${context.summary.openConflicts}`,
    `- Approvals: ${context.summary.approvals}`,
    `- Requested changes: ${context.summary.requestedChanges}`,
    `- Agent notes: ${context.agentNotes.length}`,
    `- Checklist: ${blockers.length} blocker(s), ${warnings.length} warning(s)`,
    latestNote ? `- Latest note: ${latestNote.summary}` : "- Latest note: none recorded",
    "",
    checklist,
  ].join("\n");
}

export function formatReviewContextComment(context: ReviewContext): string {
  return [
    REVIEW_CONTEXT_COMMENT_MARKER,
    "## AgentGitOps Review Context",
    "",
    formatReviewContextSection(context),
  ].join("\n");
}

function uniq(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function formatInlineList(values: string[]): string {
  const normalized = uniq(values);
  return normalized.length ? normalized.map(inlineCode).join(", ") : "`none`";
}

function formatOptionalInline(value?: string): string {
  return value?.trim() ? inlineCode(value) : "`not_recorded`";
}

function formatBoolean(value?: boolean): string {
  return value === undefined ? "`unknown`" : inlineCode(value ? "yes" : "no");
}

function inlineCode(value: string): string {
  return `\`${value.replace(/`/g, "'")}\``;
}

function toPullRequestResult(response: GitHubPullRequestResponse): PullRequestResult {
  return {
    number: response.number,
    url: response.html_url,
    state: response.merged ? "merged" : response.state,
    draft: response.draft ?? false,
  };
}

function encodeURIComponentRepo(repo: string): string {
  return repo.split("/").map(encodeURIComponent).join("/");
}

function redactRemoteUrl(remoteUrl: string): string {
  return remoteUrl.replace(/https:\/\/[^@/]+@/, "https://***@");
}
