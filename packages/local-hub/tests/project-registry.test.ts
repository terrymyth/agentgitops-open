import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { getRegistryFilePath, ProjectRegistry } from "../src/project-registry.js";

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("ProjectRegistry", () => {
  it("allocates ports, remembers last active project, and rejects duplicate paths", async () => {
    const { registry, root } = await createRegistryFixture();
    const repoA = await createGitRepo(root, "repo-a");
    const repoB = await createGitRepo(root, "repo-b");

    const projectA = await registry.add({ path: repoA, name: "Repo A" });
    const projectB = await registry.add({ path: repoB, name: "Repo B" });

    expect(projectA.id).not.toBe(projectB.id);
    expect(projectA.serverPort).toBe(4789);
    expect(projectB.serverPort).toBe(4790);
    await expect(registry.add({ path: repoA })).rejects.toThrow(/already registered/i);

    expect((await registry.getLastActive())?.id).toBe(projectB.id);
    await registry.setActive(projectA.id);
    expect((await registry.getLastActive())?.id).toBe(projectA.id);
    expect((await registry.get(projectA.id))?.lastActiveAt).toBeTruthy();
  });

  it("keeps tests isolated in a temporary registry directory", async () => {
    const { registry, registryDir, root } = await createRegistryFixture();
    const repo = await createGitRepo(root, "repo");

    await registry.add({ path: repo });

    const registryFile = getRegistryFilePath({ registryDir });
    const content = JSON.parse(await fs.readFile(registryFile, "utf-8")) as {
      projects: Array<{ path: string }>;
    };
    expect(content.projects).toHaveLength(1);
    expect(content.projects[0]?.path).toBe(repo);
    expect(registryFile).toContain(root);
  });

  it("recovers with an empty registry when the registry file is corrupted", async () => {
    const { registryDir } = await createRegistryFixture();
    await fs.mkdir(registryDir, { recursive: true });
    await fs.writeFile(getRegistryFilePath({ registryDir }), "{not valid json", "utf-8");

    const registry = new ProjectRegistry({ registryDir });
    const data = await registry.load();

    expect(data.projects).toEqual([]);
    expect(data.portRange).toEqual({ start: 4789, end: 4899 });
  });

  it("prefers .agentgitops.yml default branch over the current task branch", async () => {
    const { registry, root } = await createRegistryFixture();
    const repo = await createGitRepo(root, "repo-config-branch");
    await fs.writeFile(
      path.join(repo, ".agentgitops.yml"),
      [
        "version: 1",
        "project:",
        "  name: repo-config-branch",
        "  default_branch: main",
        "  worktree_root: ../.agentgitops-worktrees",
        "git:",
        "  provider: github",
        "  remote: origin",
        "agents:",
        "  generic:",
        "    type: generic-cli",
        "    command: echo",
        "    enabled: true",
        "",
      ].join("\n"),
      "utf-8",
    );
    await execFileAsync("git", ["checkout", "-b", "agent/task-1/generic"], { cwd: repo });

    const project = await registry.add({ path: repo });

    expect(project.defaultBranch).toBe("main");
  });
});

async function createRegistryFixture(): Promise<{
  root: string;
  registryDir: string;
  registry: ProjectRegistry;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agops-project-registry-"));
  tempRoots.push(root);
  const registryDir = path.join(root, "home", ".agentgitops");
  return { root, registryDir, registry: new ProjectRegistry({ registryDir }) };
}

async function createGitRepo(root: string, name: string): Promise<string> {
  const repo = path.join(root, name);
  await fs.mkdir(repo, { recursive: true });
  await execFileAsync("git", ["init"], { cwd: repo });
  await execFileAsync("git", ["config", "user.name", "AgentGitOps Test"], { cwd: repo });
  await execFileAsync("git", ["config", "user.email", "agentgitops-test@example.com"], {
    cwd: repo,
  });
  await fs.writeFile(path.join(repo, "README.md"), `# ${name}\n`, "utf-8");
  await execFileAsync("git", ["add", "."], { cwd: repo });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: repo });
  return repo;
}
