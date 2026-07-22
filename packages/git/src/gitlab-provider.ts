import type { ChangePackage, ReviewContext, TaskContract } from "@agentgitops/core";
import type {
  CreatePullRequestParams,
  MergeResult,
  PullRequestBodyOptions,
  PullRequestCommentResult,
  PullRequestResult,
  UpsertPullRequestCommentParams,
} from "./github-provider.js";
import { formatChangePackagePullRequestBody } from "./github-provider.js";

export interface GitLabProviderOptions {
  token: string;
  host?: string;
}

interface GitLabMergeRequestResponse {
  iid: number;
  web_url: string;
  state: "opened" | "closed" | "merged" | "locked";
  draft?: boolean;
  work_in_progress?: boolean;
}

interface GitLabErrorResponse {
  message?: string | Record<string, string[]>;
  error?: string;
}

interface GitLabNoteResponse {
  id: number;
  body?: string;
  web_url?: string;
}

export class GitLabProvider {
  private readonly host: string;

  constructor(private readonly options: GitLabProviderOptions) {
    if (!options.token) {
      throw new Error("GITLAB_TOKEN is required to create GitLab merge requests.");
    }
    this.host = (options.host ?? "https://gitlab.com").replace(/\/$/, "");
  }

  async createOrUpdatePullRequest(params: CreatePullRequestParams): Promise<PullRequestResult> {
    const existing = await this.findOpenMergeRequest(params);
    if (existing) {
      const updated = await this.request<GitLabMergeRequestResponse>(
        "PUT",
        `/api/v4/projects/${encodeURIComponent(params.repo)}/merge_requests/${existing.number}`,
        {
          title: params.title,
          description: params.body,
        },
      );
      return toPullRequestResult(updated);
    }

    const created = await this.request<GitLabMergeRequestResponse>(
      "POST",
      `/api/v4/projects/${encodeURIComponent(params.repo)}/merge_requests`,
      {
        title: params.title,
        description: params.body,
        source_branch: params.headBranch,
        target_branch: params.baseBranch,
      },
    );
    return toPullRequestResult(created);
  }

  async mergePullRequest(params: {
    repo: string;
    number: number;
    squash?: boolean;
  }): Promise<MergeResult> {
    const result = await this.request<GitLabMergeRequestResponse>(
      "PUT",
      `/api/v4/projects/${encodeURIComponent(params.repo)}/merge_requests/${params.number}/merge`,
      {
        squash: params.squash ?? true,
      },
    );
    return {
      merged: result.state === "merged",
      message:
        result.state === "merged" ? "Merge request merged" : `Merge request state: ${result.state}`,
    };
  }

  async upsertPullRequestComment(
    params: UpsertPullRequestCommentParams,
  ): Promise<PullRequestCommentResult> {
    const marker = params.marker ?? "<!-- agentgitops:review-context -->";
    const notes = await this.request<GitLabNoteResponse[]>(
      "GET",
      `/api/v4/projects/${encodeURIComponent(params.repo)}/merge_requests/${params.number}/notes?per_page=100`,
    );
    const existing = notes.find((note) => note.body?.includes(marker));
    if (existing) {
      const updated = await this.request<GitLabNoteResponse>(
        "PUT",
        `/api/v4/projects/${encodeURIComponent(params.repo)}/merge_requests/${params.number}/notes/${existing.id}`,
        { body: params.body },
      );
      return { id: updated.id, url: updated.web_url, action: "updated" };
    }

    const created = await this.request<GitLabNoteResponse>(
      "POST",
      `/api/v4/projects/${encodeURIComponent(params.repo)}/merge_requests/${params.number}/notes`,
      { body: params.body },
    );
    return { id: created.id, url: created.web_url, action: "created" };
  }

  private async findOpenMergeRequest(
    params: CreatePullRequestParams,
  ): Promise<PullRequestResult | null> {
    const search = new URLSearchParams({
      state: "opened",
      source_branch: params.headBranch,
      target_branch: params.baseBranch,
    });
    const requests = await this.request<GitLabMergeRequestResponse[]>(
      "GET",
      `/api/v4/projects/${encodeURIComponent(params.repo)}/merge_requests?${search.toString()}`,
    );
    const first = requests[0];
    return first ? toPullRequestResult(first) : null;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.host}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Private-Token": this.options.token,
        "User-Agent": "agentgitops/0.1.0",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const errorBody = (await response.json()) as GitLabErrorResponse;
        detail = stringifyGitLabError(errorBody) ?? detail;
      } catch {
        // Keep status text when GitLab does not return JSON.
      }
      throw new Error(`GitLab API ${method} ${path} failed (${response.status}): ${detail}`);
    }

    return (await response.json()) as T;
  }
}

export function parseGitLabRepository(remoteUrl: string): string {
  const trimmed = remoteUrl.trim();
  const sshMatch = /^git@[^:]+:(?<repo>[^/]+\/.+?)(?:\.git)?$/.exec(trimmed);
  if (sshMatch?.groups?.repo) return sshMatch.groups.repo;

  const urlMatch = /^https:\/\/(?:[^@/]+@)?[^/]+\/(?<repo>[^/]+\/.+?)(?:\.git)?\/?$/.exec(trimmed);
  if (urlMatch?.groups?.repo) return urlMatch.groups.repo;

  throw new Error(`Cannot derive GitLab project from remote URL: ${redactRemoteUrl(trimmed)}`);
}

export function formatMergeRequestBody(
  task: TaskContract,
  changePackage: ChangePackage,
  reviewContext?: ReviewContext,
  options?: PullRequestBodyOptions,
): string {
  return formatChangePackagePullRequestBody(task, changePackage, reviewContext, options);
}

function toPullRequestResult(response: GitLabMergeRequestResponse): PullRequestResult {
  return {
    number: response.iid,
    url: response.web_url,
    state: response.state === "merged" ? "merged" : response.state === "opened" ? "open" : "closed",
    draft: response.draft ?? response.work_in_progress ?? false,
  };
}

function stringifyGitLabError(errorBody: GitLabErrorResponse): string | undefined {
  if (typeof errorBody.message === "string") return errorBody.message;
  if (errorBody.message) return JSON.stringify(errorBody.message);
  return errorBody.error;
}

function redactRemoteUrl(remoteUrl: string): string {
  return remoteUrl.replace(/https:\/\/[^@/]+@/, "https://***@");
}
