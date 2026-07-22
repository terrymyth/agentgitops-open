import { spawn } from "node:child_process";

export interface CrossPlatformCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface CrossPlatformCommandResult {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export async function runCrossPlatformCommand(
  command: string,
  args: string[] = [],
  options: CrossPlatformCommandOptions = {},
): Promise<CrossPlatformCommandResult> {
  const started = Date.now();
  // Windows package-manager shims are .cmd files and require a shell. Native
  // executables such as node.exe, git.exe, and gh.exe must be spawned directly
  // so stdout/stderr remain separate and arguments are not shell-concatenated.
  const usesWindowsScriptShell =
    process.platform === "win32" &&
    (isWindowsScript(command) || isWindowsPackageManagerShim(command));

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: usesWindowsScriptShell,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;

    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, options.timeoutMs);
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      options.onStdout?.(text);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      options.onStderr?.(text);
    });
    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({
        command,
        args,
        exitCode: timedOut ? 124 : (code ?? 0),
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
  });
}

export function parseCommandLine(commandLine: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of commandLine.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if ((char === "'" || char === '"') && quote === null) {
      quote = char;
      continue;
    }
    if (quote === char) {
      quote = null;
      continue;
    }
    if (/\s/.test(char) && quote === null) {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaping) current += "\\";
  if (quote !== null) throw new Error(`Unclosed quote in command: ${commandLine}`);
  if (current.length > 0) parts.push(current);
  return parts;
}

function isWindowsScript(command: string): boolean {
  return /\.(?:cmd|bat)$/i.test(command);
}

function isWindowsPackageManagerShim(command: string): boolean {
  if (/[\\/]/.test(command)) return false;
  return /^(?:npm|npx|pnpm|pnpx|yarn|yarnpkg)$/i.test(command);
}
