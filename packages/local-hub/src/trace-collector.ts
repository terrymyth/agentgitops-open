import fs from "node:fs/promises";
import path from "node:path";

export interface TraceEntry {
  timestamp: string;
  stream: "stdout" | "stderr";
  data: string;
}

/**
 * TraceCollector - 采集 Agent 执行过程日志
 */
export class TraceCollector {
  private entries: TraceEntry[] = [];

  constructor(private readonly logDir: string) {}

  /** 记录一条日志 */
  append(stream: "stdout" | "stderr", data: string): void {
    this.entries.push({
      timestamp: new Date().toISOString(),
      stream,
      data,
    });
  }

  /** 获取所有日志 */
  getEntries(): TraceEntry[] {
    return [...this.entries];
  }

  /** 持久化日志到文件 */
  async flush(): Promise<{ stdoutPath: string; stderrPath: string }> {
    await fs.mkdir(this.logDir, { recursive: true });

    const stdoutPath = path.join(this.logDir, "agent-stdout.log");
    const stderrPath = path.join(this.logDir, "agent-stderr.log");

    const stdout = this.entries
      .filter((e) => e.stream === "stdout")
      .map((e) => `[${e.timestamp}] ${e.data}`)
      .join("\n");
    const stderr = this.entries
      .filter((e) => e.stream === "stderr")
      .map((e) => `[${e.timestamp}] ${e.data}`)
      .join("\n");

    await fs.writeFile(stdoutPath, stdout, "utf-8");
    await fs.writeFile(stderrPath, stderr, "utf-8");

    return { stdoutPath, stderrPath };
  }
}
