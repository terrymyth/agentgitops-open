import fs from "node:fs/promises";
import path from "node:path";
import type { VerificationRun } from "@agentgitops/core";
import { CONFIG_DIR } from "@agentgitops/core";

export class VerificationStore {
  constructor(private readonly projectPath: string) {}

  async save(taskId: string, runs: VerificationRun[]): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.pathFor(taskId), JSON.stringify(runs, null, 2), "utf-8");
  }

  async load(taskId: string): Promise<VerificationRun[]> {
    try {
      const content = await fs.readFile(this.pathFor(taskId), "utf-8");
      return JSON.parse(content) as VerificationRun[];
    } catch {
      return [];
    }
  }

  private get dir(): string {
    return path.join(this.projectPath, CONFIG_DIR, "verifications");
  }

  private pathFor(taskId: string): string {
    return path.join(this.dir, `${taskId}.json`);
  }
}
