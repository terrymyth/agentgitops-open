import { afterEach, describe, expect, it, vi } from "vitest";
import { GitLabProvider, parseGitLabRepository } from "../src/gitlab-provider.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GitLabProvider helpers", () => {
  it("parses GitLab HTTPS and SSH remotes", () => {
    expect(parseGitLabRepository("https://gitlab.com/acme/demo.git")).toBe("acme/demo");
    expect(parseGitLabRepository("git@gitlab.com:acme/platform/demo.git")).toBe(
      "acme/platform/demo",
    );
    expect(parseGitLabRepository("https://token@gitlab.example.com/acme/demo")).toBe("acme/demo");
  });

  it("merges a merge request through the GitLab API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          iid: 7,
          web_url: "https://gitlab.com/acme/demo/-/merge_requests/7",
          state: "merged",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await new GitLabProvider({ token: "token" }).mergePullRequest({
      repo: "acme/demo",
      number: 7,
      squash: true,
    });

    expect(result).toEqual({
      merged: true,
      message: "Merge request merged",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gitlab.com/api/v4/projects/acme%2Fdemo/merge_requests/7/merge",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ squash: true }),
      }),
    );
  });
});
