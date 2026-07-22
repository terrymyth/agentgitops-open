/**
 * GiteaProvider — EE Gitea 集成（P2-005）
 *
 * 支持 Gitea 平台 PR 创建和 Webhook。
 *
 * 使用方式：
 *   const provider = new GiteaProvider({ host: "https://gitea.example.com", token: "xxx" });
 *   const pr = await provider.createOrUpdateReviewRequest({ repo, title, body, headBranch, baseBranch });
 */
export interface GiteaConfig {
  host: string;
  token: string;
  apiVersion?: string;
}

export class GiteaProvider {
  private config: GiteaConfig;

  constructor(config: GiteaConfig) {
    this.config = config;
  }

  private getBaseUrl(): string {
    const version = this.config.apiVersion ?? "v1";
    return `${this.config.host}/api/${version}`;
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `token ${this.config.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  /**
   * 创建/更新 PR
   */
  async createOrUpdateReviewRequest(params: {
    repo: string;
    title: string;
    body: string;
    headBranch: string;
    baseBranch: string;
    draft?: boolean;
  }): Promise<{ number: number; url: string; state: string; draft?: boolean }> {
    const url = `${this.getBaseUrl()}/repos/${params.repo}/pulls`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        title: params.title,
        body: params.body,
        head: params.headBranch,
        base: params.baseBranch,
        draft: params.draft ?? false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gitea PR creation failed (${response.status}): ${errorText}`);
    }

    const result = (await response.json()) as {
      number: number;
      html_url: string;
      state: string;
      draft?: boolean;
    };

    return {
      number: result.number,
      url: result.html_url,
      state: result.state,
      draft: result.draft,
    };
  }

  /**
   * 获取 PR 状态
   */
  async getPrStatus(
    repo: string,
    prNumber: number,
  ): Promise<{
    state: string;
    merged: boolean;
    mergeable: boolean;
    title: string;
    url: string;
  }> {
    const url = `${this.getBaseUrl()}/repos/${repo}/pulls/${prNumber}`;
    const response = await fetch(url, { headers: this.getHeaders() });

    if (!response.ok) {
      throw new Error(`Gitea PR status failed (${response.status})`);
    }

    const result = (await response.json()) as {
      state: string;
      merged: boolean;
      mergeable: boolean;
      title: string;
      html_url: string;
    };

    return {
      state: result.state,
      merged: result.merged,
      mergeable: result.mergeable,
      title: result.title,
      url: result.html_url,
    };
  }

  /**
   * 合并 PR
   */
  async mergePr(
    repo: string,
    prNumber: number,
    mergeStyle: "merge" | "rebase" | "squash" = "squash",
  ): Promise<boolean> {
    const url = `${this.getBaseUrl()}/repos/${repo}/pulls/${prNumber}/merge`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ Do: mergeStyle }),
    });

    return response.ok;
  }

  /**
   * 配置 Webhook
   */
  async configureWebhook(repo: string, webhookUrl: string, secret: string): Promise<void> {
    const url = `${this.getBaseUrl()}/repos/${repo}/hooks`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        type: "gitea",
        config: { url: webhookUrl, content_type: "json", secret },
        events: ["push", "pull_request", "issue_comment"],
        active: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Gitea webhook configuration failed (${response.status})`);
    }
  }

  /**
   * 获取 CI 状态
   */
  async getCheckStatus(
    repo: string,
    ref: string,
  ): Promise<{ status: string; conclusion?: string }> {
    const url = `${this.getBaseUrl()}/repos/${repo}/commits/${ref}/statuses`;
    const response = await fetch(url, { headers: this.getHeaders() });

    if (!response.ok) {
      return { status: "unknown" };
    }

    const statuses = (await response.json()) as Array<{ status: string; state: string }>;
    if (statuses.length === 0) return { status: "pending" };

    const latest = statuses[0];
    const stateMap: Record<string, string> = {
      success: "success",
      pending: "pending",
      failure: "failure",
      error: "failure",
      warning: "pending",
    };

    return {
      status: stateMap[latest.state] ?? "unknown",
      conclusion: latest.state,
    };
  }
}

/**
 * CodeownersParser — EE CODEOWNERS 集成（P2-006）
 *
 * 解析 CODEOWNERS 文件，自动匹配 Reviewer。
 *
 * 使用方式：
 *   const parser = new CodeownersParser();
 *   const rules = parser.parse(codeownersContent);
 *   const owners = parser.matchOwners(rules, ["src/auth/login.ts"]);
 */
export interface CodeownersRule {
  pattern: string;
  owners: string[];
  /** 是否为通配符模式 */
  isGlob: boolean;
}

export class CodeownersParser {
  /**
   * 解析 CODEOWNERS 文件内容
   *
   * 格式示例：
   *   # 注释
   *   * @global-owner
   *   src/auth/** @security-team @architect
   *   db/migrations/** @db-team
   *   *.md @docs-team
   */
  parse(content: string): CodeownersRule[] {
    const rules: CodeownersRule[] = [];
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) continue;

      const pattern = parts[0];
      const owners = parts.slice(1).filter((o) => o.startsWith("@") || o.includes("/"));

      rules.push({
        pattern,
        owners,
        isGlob: pattern.includes("*") || pattern.includes("**"),
      });
    }

    return rules;
  }

  /**
   * 匹配文件路径，返回所有匹配的 owners
   *
   * 规则：后定义的规则优先级更高（与 GitHub CODEOWNERS 一致）
   */
  matchOwners(rules: CodeownersRule[], changedFiles: string[]): string[] {
    const ownerSet = new Set<string>();

    for (const file of changedFiles) {
      // 从后往前匹配（后定义的规则优先）
      for (let i = rules.length - 1; i >= 0; i--) {
        const rule = rules[i];
        if (this.matchPattern(file, rule.pattern)) {
          for (const owner of rule.owners) {
            ownerSet.add(owner);
          }
          break; // 每个文件只匹配第一个（最高优先级）规则
        }
      }
    }

    return Array.from(ownerSet);
  }

  /**
   * 匹配文件路径与模式
   */
  private matchPattern(filePath: string, pattern: string): boolean {
    // 将 glob 模式转为正则
    let regex = pattern
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]");

    // 确保匹配路径前缀
    if (!regex.startsWith("^")) regex = "^" + regex;
    if (!regex.endsWith("$") && !regex.endsWith(".*")) {
      // 如果模式以 / 结尾，匹配目录下所有文件
      if (pattern.endsWith("/")) {
        regex = regex + ".*";
      } else {
        regex = regex + "$";
      }
    }

    try {
      return new RegExp(regex).test(filePath);
    } catch {
      return filePath === pattern;
    }
  }

  /**
   * 从文件系统读取 CODEOWNERS
   */
  async loadFromFile(repoPath: string): Promise<CodeownersRule[]> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const possiblePaths = [
      path.join(repoPath, "CODEOWNERS"),
      path.join(repoPath, ".github", "CODEOWNERS"),
      path.join(repoPath, "docs", "CODEOWNERS"),
    ];

    for (const p of possiblePaths) {
      try {
        const content = await fs.readFile(p, "utf8");
        return this.parse(content);
      } catch {
        continue;
      }
    }

    return [];
  }
}
