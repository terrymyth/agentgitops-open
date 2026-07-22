import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { HandoffDocument } from "@agentgitops/core";
import { CONFIG_DIR } from "@agentgitops/core";

/**
 * HandoffDocumentStore — 交接文档本地存储（HD-001）
 *
 * 存储路径：.agentgitops/handoff-docs/<docId>.json + <docId>.md
 *
 * 不依赖 Team Sync，单机场景可用。
 */
export class HandoffDocumentStore {
  constructor(private readonly projectPath: string) {}

  private get docsDir(): string {
    return path.join(this.projectPath, CONFIG_DIR, "handoff-docs");
  }

  async save(doc: HandoffDocument): Promise<{ jsonPath: string; markdownPath: string }> {
    await fs.mkdir(this.docsDir, { recursive: true });
    const jsonPath = path.join(this.docsDir, `${doc.docId}.json`);
    const markdownPath = path.join(this.docsDir, `${doc.docId}.md`);
    await fs.writeFile(jsonPath, JSON.stringify(doc, null, 2), "utf-8");
    await fs.writeFile(markdownPath, doc.markdown, "utf-8");
    return { jsonPath, markdownPath };
  }

  async get(docId: string): Promise<HandoffDocument | null> {
    const jsonPath = path.join(this.docsDir, `${docId}.json`);
    try {
      const content = await fs.readFile(jsonPath, "utf-8");
      return JSON.parse(content) as HandoffDocument;
    } catch {
      return null;
    }
  }

  async getByTask(taskId: string): Promise<HandoffDocument[]> {
    const docs = await this.list();
    return docs.filter((d) => d.taskId === taskId);
  }

  async getLatestByTask(taskId: string): Promise<HandoffDocument | null> {
    const docs = await this.getByTask(taskId);
    if (docs.length === 0) return null;
    return docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  async list(): Promise<HandoffDocument[]> {
    try {
      const files = await fs.readdir(this.docsDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      const docs = await Promise.all(
        jsonFiles.map(async (file) => {
          try {
            const content = await fs.readFile(path.join(this.docsDir, file), "utf-8");
            return JSON.parse(content) as HandoffDocument;
          } catch {
            return null;
          }
        }),
      );
      return docs.filter((d): d is HandoffDocument => d !== null);
    } catch {
      return [];
    }
  }
}

/**
 * 生成交接文档 ID
 */
export function generateHandoffDocId(taskId: string): string {
  return `doc_${taskId}_${randomUUID().slice(0, 8)}`;
}
