/**
 * JiraLinearSync — EE Jira/Linear 双向同步（P2-007）
 *
 * Task Contract 与 Jira/Linear 双向同步。
 */
export interface JiraLinearConfig {
  provider: "jira" | "linear";
  host: string;
  token: string;
  projectKey?: string;
  email?: string;
  statusMapping?: Record<string, string>;
}

export interface ExternalIssue {
  key: string;
  title: string;
  description: string;
  status: string;
  url: string;
  assignee?: string;
  labels: string[];
}

export class JiraLinearSync {
  private config: JiraLinearConfig;

  constructor(config: JiraLinearConfig) {
    this.config = config;
  }

  private getHeaders(): Record<string, string> {
    if (this.config.provider === "jira") {
      const auth = Buffer.from(`${this.config.email}:${this.config.token}`).toString("base64");
      return {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      };
    }
    return { Authorization: `Bearer ${this.config.token}`, "Content-Type": "application/json" };
  }

  async createIssue(task: {
    id: string;
    title: string;
    objective: string;
    status: string;
    riskLevel: string;
    agentId?: string;
  }): Promise<ExternalIssue> {
    if (this.config.provider === "jira") return this.createJiraIssue(task);
    return this.createLinearIssue(task);
  }

  private async createJiraIssue(task: {
    id: string;
    title: string;
    objective: string;
    status: string;
    riskLevel: string;
    agentId?: string;
  }): Promise<ExternalIssue> {
    const url = `${this.config.host}/rest/api/3/issue`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        fields: {
          project: { key: this.config.projectKey ?? "AG" },
          summary: `[${task.id}] ${task.title}`,
          description: {
            type: "doc",
            version: 1,
            content: [{ type: "paragraph", content: [{ type: "text", text: task.objective }] }],
          },
          issuetype: { name: "Task" },
          labels: ["agentgitops", `risk-${task.riskLevel}`, task.agentId ?? "no-agent"].filter(
            Boolean,
          ),
        },
      }),
    });
    if (!response.ok)
      throw new Error(`Jira issue creation failed (${response.status}): ${await response.text()}`);
    const result = (await response.json()) as { key: string };
    return {
      key: result.key,
      title: task.title,
      description: task.objective,
      status: "To Do",
      url: `${this.config.host}/browse/${result.key}`,
      labels: ["agentgitops", `risk-${task.riskLevel}`],
    };
  }

  private async createLinearIssue(task: {
    id: string;
    title: string;
    objective: string;
    status: string;
    riskLevel: string;
    agentId?: string;
  }): Promise<ExternalIssue> {
    const url = `${this.config.host}/api/v1/issues`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        title: `[${task.id}] ${task.title}`,
        description: task.objective,
        teamId: this.config.projectKey,
        labels: ["agentgitops", `risk-${task.riskLevel}`],
      }),
    });
    if (!response.ok)
      throw new Error(
        `Linear issue creation failed (${response.status}): ${await response.text()}`,
      );
    const result = (await response.json()) as { id: string; url: string; state: string };
    return {
      key: result.id,
      title: task.title,
      description: task.objective,
      status: result.state ?? "Backlog",
      url: result.url,
      labels: ["agentgitops", `risk-${task.riskLevel}`],
    };
  }

  async syncStatus(issueKey: string, taskStatus: string): Promise<void> {
    const statusMapping = this.config.statusMapping ?? {
      planning: "To Do",
      running: "In Progress",
      reviewing: "In Review",
      merged: "Done",
      failed: "Blocked",
    };
    const externalStatus = statusMapping[taskStatus];
    if (!externalStatus) return;

    if (this.config.provider === "jira") {
      const transitionsUrl = `${this.config.host}/rest/api/3/issue/${issueKey}/transitions`;
      const transitionsResponse = await fetch(transitionsUrl, { headers: this.getHeaders() });
      if (!transitionsResponse.ok) return;
      const transitions = (await transitionsResponse.json()) as {
        transitions: Array<{ id: string; name: string }>;
      };
      const transition = transitions.transitions.find(
        (t) => t.name.toLowerCase() === externalStatus.toLowerCase(),
      );
      if (!transition) return;
      await fetch(transitionsUrl, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ transition: { id: transition.id } }),
      });
    } else {
      await fetch(`${this.config.host}/api/v1/issues/${issueKey}`, {
        method: "PATCH",
        headers: this.getHeaders(),
        body: JSON.stringify({ state: externalStatus }),
      });
    }
  }

  async getIssue(issueKey: string): Promise<ExternalIssue | null> {
    if (this.config.provider === "jira") {
      const response = await fetch(`${this.config.host}/rest/api/3/issue/${issueKey}`, {
        headers: this.getHeaders(),
      });
      if (!response.ok) return null;
      const result = (await response.json()) as {
        key: string;
        fields: {
          summary: string;
          status: { name: string };
          description?: { content: Array<{ content: Array<{ text: string }> }> };
          assignee?: { displayName: string };
          labels: string[];
        };
      };
      const description =
        result.fields.description?.content
          ?.flatMap((c) => c.content?.map((cc) => cc.text) ?? [])
          .join("") ?? "";
      return {
        key: result.key,
        title: result.fields.summary,
        description,
        status: result.fields.status.name,
        url: `${this.config.host}/browse/${result.key}`,
        assignee: result.fields.assignee?.displayName,
        labels: result.fields.labels,
      };
    }
    const response = await fetch(`${this.config.host}/api/v1/issues/${issueKey}`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) return null;
    const result = (await response.json()) as {
      id: string;
      title: string;
      description: string;
      state: string;
      url: string;
      assignee?: { name: string };
      labels?: Array<{ name: string }>;
    };
    return {
      key: result.id,
      title: result.title,
      description: result.description,
      status: result.state,
      url: result.url,
      assignee: result.assignee?.name,
      labels: result.labels?.map((l) => l.name) ?? [],
    };
  }
}

/**
 * ImNotifier — EE 飞书/企业微信/钉钉通知（P2-008）
 */
export interface ImConfig {
  provider: "feishu" | "wecom" | "dingtalk" | "slack";
  webhookUrl: string;
  secret?: string;
  mentionAll?: boolean;
  mentionUsers?: string[];
}

export interface ImNotification {
  type:
    | "review_requested"
    | "review_approved"
    | "review_rejected"
    | "merge_approved"
    | "merge_blocked"
    | "conflict_detected"
    | "task_failed"
    | "task_completed";
  title: string;
  message: string;
  taskId?: string;
  projectName?: string;
  agentId?: string;
  riskLevel?: string;
  url?: string;
}

export class ImNotifier {
  private config: ImConfig;

  constructor(config: ImConfig) {
    this.config = config;
  }

  async notify(notification: ImNotification): Promise<{ success: boolean; error?: string }> {
    try {
      const payload = this.formatPayload(notification);
      const response = await fetch(this.config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok)
        return { success: false, error: `HTTP ${response.status}: ${await response.text()}` };
      const result = (await response.json()) as {
        ok?: boolean;
        errcode?: number;
        errmsg?: string;
        code?: number;
        msg?: string;
      };
      if (this.config.provider === "feishu")
        return { success: result.code === 0, error: result.code !== 0 ? result.msg : undefined };
      if (this.config.provider === "dingtalk" || this.config.provider === "wecom")
        return {
          success: result.errcode === 0,
          error: result.errcode !== 0 ? result.errmsg : undefined,
        };
      return { success: result.ok === true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private formatPayload(n: ImNotification): unknown {
    const icon = this.getIcon(n.type);
    const color = this.getColor(n.type);
    const title = `${icon} ${n.title}`;
    const message = this.formatMessage(n);
    switch (this.config.provider) {
      case "feishu":
        return {
          msg_type: "interactive",
          card: {
            header: { title: { tag: "plain_text", content: title } },
            elements: [
              { tag: "div", text: { tag: "lark_md", content: message } },
              ...(n.url
                ? [
                    {
                      tag: "action",
                      actions: [
                        {
                          tag: "button",
                          text: { tag: "plain_text", content: "查看详情" },
                          url: n.url,
                          type: "primary",
                        },
                      ],
                    },
                  ]
                : []),
            ],
          },
        };
      case "wecom":
        return {
          msgtype: "markdown",
          markdown: {
            content: `## ${title}\n\n${message}`,
            mentioned_list: this.config.mentionAll ? ["@all"] : (this.config.mentionUsers ?? []),
          },
        };
      case "dingtalk": {
        const payload: Record<string, unknown> = {
          msgtype: "markdown",
          markdown: { title, text: `## ${title}\n\n${message}` },
          at: {
            isAtAll: this.config.mentionAll ?? false,
            atMobiles: this.config.mentionUsers ?? [],
          },
        };
        if (this.config.secret) {
          const ts = Date.now();
          payload.timestamp = ts;
          payload.sign = this.sign(ts, this.config.secret);
        }
        return payload;
      }
      case "slack":
        return {
          attachments: [
            {
              color,
              title,
              text: message,
              actions: n.url ? [{ type: "button", text: "查看详情", url: n.url }] : undefined,
            },
          ],
        };
      default:
        return { text: `${title}\n${message}` };
    }
  }

  private formatMessage(n: ImNotification): string {
    const lines = [n.message];
    if (n.projectName) lines.push(`📁 项目: ${n.projectName}`);
    if (n.taskId) lines.push(`📋 任务: ${n.taskId}`);
    if (n.agentId) lines.push(`🤖 Agent: ${n.agentId}`);
    if (n.riskLevel) lines.push(`⚠️ 风险: ${n.riskLevel}`);
    if (n.url) lines.push(`🔗 链接: ${n.url}`);
    return lines.join("\n");
  }

  private getIcon(type: ImNotification["type"]): string {
    const icons: Record<ImNotification["type"], string> = {
      review_requested: "👀",
      review_approved: "✅",
      review_rejected: "❌",
      merge_approved: "🔀",
      merge_blocked: "🚫",
      conflict_detected: "⚠️",
      task_failed: "💥",
      task_completed: "🎉",
    };
    return icons[type] ?? "📢";
  }

  private getColor(type: ImNotification["type"]): string {
    const colors: Record<ImNotification["type"], string> = {
      review_requested: "#36a64f",
      review_approved: "#36a64f",
      review_rejected: "#ff0000",
      merge_approved: "#36a64f",
      merge_blocked: "#ff0000",
      conflict_detected: "#ff9900",
      task_failed: "#ff0000",
      task_completed: "#36a64f",
    };
    return colors[type] ?? "#0099ff";
  }

  private sign(timestamp: number, secret: string): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require("node:crypto") as {
      createHmac: (
        alg: string,
        key: string,
      ) => { update: (data: string) => { digest: (enc: string) => string } };
    };
    return crypto.createHmac("sha256", secret).update(`${timestamp}\n${secret}`).digest("base64");
  }
}
