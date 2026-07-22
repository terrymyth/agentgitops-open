import { execa } from "execa";

/**
 * 跨平台 shell 工具
 *
 * 统一子进程调用方式，避免在各处硬编码 /bin/sh（Windows 不存在）。
 * - Windows: 使用 cmd.exe 执行命令字符串
 * - Unix: 使用 /bin/sh 执行命令字符串
 * - 直接命令+参数模式：跨平台直接 spawn，不经过 shell
 */

export interface ShellExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  /** 是否通过 shell 执行（命令字符串需 shell 特性时启用） */
  shell?: boolean;
}

export interface ShellExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * 执行命令字符串（通过 shell）
 *
 * 跨平台选择 shell：
 * - Windows: cmd.exe /c "<command>"
 * - Unix: /bin/sh -c "<command>"
 */
export async function execShell(
  command: string,
  options: ShellExecOptions = {},
): Promise<ShellExecResult> {
  const subprocess = spawnShell(command, options);
  const result = await subprocess;
  return {
    exitCode: result.exitCode ?? 0,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
  };
}

/**
 * 执行命令 + 参数（直接 spawn，不经过 shell）
 *
 * 跨平台安全：command 是可执行文件路径或名称（如 process.execPath），
 * args 是参数数组，不依赖任何平台特定 shell。
 */
export async function execCommand(
  command: string,
  args: string[],
  options: ShellExecOptions = {},
): Promise<ShellExecResult> {
  const result = await execa(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    timeout: options.timeout,
    reject: false,
  });
  return {
    exitCode: result.exitCode ?? 0,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
  };
}

/**
 * 获取跨平台 shell 写文件命令
 *
 * 用于 Agent adapter 等场景需要生成"写文件"命令时，
 * 返回 [command, args] 元组，用 execCommand 执行。
 */
export function crossPlatformWriteFileCommand(
  filePath: string,
  content: string,
): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: [
      "-e",
      `require('fs').writeFileSync(${JSON.stringify(filePath)},${JSON.stringify(content)})`,
    ],
  };
}

/**
 * 判断当前是否 Windows
 */
export function isWindows(): boolean {
  return process.platform === "win32";
}

/**
 * 获取当前平台的默认 shell（用于显示/诊断）
 */
export function defaultShell(): string {
  return isWindows() ? "cmd.exe" : "/bin/sh";
}

function spawnShell(command: string, options: ShellExecOptions) {
  if (options.shell === false) {
    // 不通过 shell，直接按空白拆分（兼容旧行为）
    const [cmd, ...args] = command.trim().split(/\s+/).filter(Boolean);
    return execa(cmd, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      timeout: options.timeout,
      reject: false,
    });
  }

  if (isWindows()) {
    return execa("cmd", ["/c", command], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      timeout: options.timeout,
      reject: false,
    });
  }

  return execa("/bin/sh", ["-c", command], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    timeout: options.timeout,
    reject: false,
  });
}
