import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const agops = path.join(repoRoot, "apps/cli/dist/index.js");
export const serverEntry = pathToFileURL(path.join(repoRoot, "apps/server/dist/index.js")).href;
export const localHubEntry = pathToFileURL(
  path.join(repoRoot, "packages/local-hub/dist/index.js"),
).href;

export function makeSmokeRoot(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.stdout && options.echo !== false) process.stdout.write(result.stdout);
  if (result.stderr && options.echo !== false) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit ${result.status}`);
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function createGitRepo(root, name, files = { "README.md": "# smoke\n" }) {
  const repo = path.join(root, name);
  mkdirSync(repo, { recursive: true });
  run("git", ["init"], { cwd: repo });
  run("git", ["config", "user.name", "AgentGitOps Smoke"], { cwd: repo });
  run("git", ["config", "user.email", "agentgitops-smoke@example.com"], { cwd: repo });
  for (const [relativePath, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, relativePath)), { recursive: true });
    writeFileSync(path.join(repo, relativePath), content);
  }
  run("git", ["add", "."], { cwd: repo });
  run("git", ["commit", "-m", "initial"], { cwd: repo });
  return repo;
}

export function createSmokeRepo(root, name, files = { "README.md": "# smoke\n" }) {
  const sourceRepo = process.env.AGENTGITOPS_SMOKE_SOURCE_REPO;
  if (!sourceRepo) return createGitRepo(root, name, files);

  const repo = path.join(root, name);
  run("git", ["clone", sourceRepo, repo], { cwd: root });
  run("git", ["config", "user.name", "AgentGitOps Smoke"], { cwd: repo });
  run("git", ["config", "user.email", "agentgitops-smoke@example.com"], { cwd: repo });
  return repo;
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address) resolve(address.port);
        else reject(new Error("Could not allocate a free port."));
      });
    });
  });
}

export async function requestJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.json();
  return { status: response.status, body };
}
