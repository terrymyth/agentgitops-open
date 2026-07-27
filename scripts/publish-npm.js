#!/usr/bin/env node
/**
 * npm 发布脚本
 *
 * 使用方式：
 *   node scripts/publish-npm.js           # 发布所有公开包
 *   node scripts/publish-npm.js --dry-run # 模拟发布（不实际推送）
 *
 * 前置条件：
 *   1. npm login（已登录 npm 账号）
 *   2. pnpm build（所有包已构建）
 *
 * 发布顺序（按依赖关系）：
 *   1. @agentgitops/core（无依赖）
 *   2. @agentgitops/git（依赖 core）
 *   3. @agentgitops/local-hub（依赖 core + git）
 *   4. @agentgitops/server（依赖 core + git + local-hub）
 *   5. agentgitops（CLI，依赖以上所有）
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dryRun = process.argv.includes("--dry-run");
const npmCacheDir = mkdtempSync(path.join(tmpdir(), "agentgitops-publish-cache-"));
process.on("exit", () => rmSync(npmCacheDir, { recursive: true, force: true }));

const packages = [
  { name: "@agentgitops/core", dir: "packages/core" },
  { name: "@agentgitops/git", dir: "packages/git" },
  { name: "@agentgitops/local-hub", dir: "packages/local-hub" },
  { name: "@agentgitops/server", dir: "apps/server" },
  { name: "agentgitops", dir: "apps/cli" },
];
const packageVersions = packages.map((pkg) => ({
  ...pkg,
  version: JSON.parse(readFileSync(path.join(pkg.dir, "package.json"), "utf8")).version,
}));
const versions = new Set(packageVersions.map((pkg) => pkg.version));
if (versions.size !== 1) {
  throw new Error(
    `All publishable packages must use the same version: ${packageVersions
      .map((pkg) => `${pkg.name}=${pkg.version}`)
      .join(", ")}`,
  );
}
const version = packageVersions[0].version;
const distTag = version.includes("-") ? "next" : "latest";

console.log(
  `\n📦 agentgitops npm 发布脚本 ${dryRun ? "(dry-run)" : ""} version=${version} tag=${distTag}\n`,
);

if (!dryRun) {
  const branch = run("git", ["branch", "--show-current"]).trim();
  const status = run("git", ["status", "--porcelain"]).trim();
  const origin = normalizeRemote(run("git", ["remote", "get-url", "origin"]));
  const tagsAtHead = run("git", ["tag", "--points-at", "HEAD"]).split(/\r?\n/).filter(Boolean);
  if (branch && branch !== "main") {
    throw new Error(`Real npm publishing is only allowed from public main, got ${branch}`);
  }
  if (origin !== "github.com/terrymyth/agentgitops-open") {
    throw new Error(`Real npm publishing requires the public repository, got ${origin}`);
  }
  if (status) throw new Error("Real npm publishing requires a clean worktree");
  if (!tagsAtHead.includes(`v${version}`)) {
    throw new Error(`Real npm publishing requires tag v${version} on HEAD`);
  }
  try {
    run("git", ["merge-base", "--is-ancestor", "HEAD", "origin/main"]);
  } catch {
    throw new Error(
      "Real npm publishing requires the tagged commit to be reachable from origin/main",
    );
  }
  run("npm", ["whoami"], { stdio: "inherit" });
}

// 1. 构建所有包
console.log("🔨 构建所有包...");
try {
  run("pnpm", ["build"], { stdio: "inherit" });
  console.log("✅ 构建成功\n");
} catch {
  console.error("❌ 构建失败，终止发布");
  process.exit(1);
}

// 2. 逐个发布
for (const pkg of packages) {
  console.log(`📦 发布 ${pkg.name}...`);
  const args = dryRun
    ? ["publish", "--dry-run", "--no-git-checks"]
    : [
        "publish",
        "--access",
        "public",
        "--publish-branch",
        "main",
        "--provenance",
        "--tag",
        distTag,
      ];
  try {
    run("pnpm", args, { stdio: "inherit", cwd: pkg.dir });
    console.log(`✅ ${pkg.name} 发布成功\n`);
  } catch {
    console.error(`❌ ${pkg.name} 发布失败`);
    process.exit(1);
  }
}

console.log("🎉 所有包发布完成！");
console.log("\n安装方式：");
console.log("  npm install -g agentgitops          # 全局安装 CLI");
console.log("  npm install @agentgitops/core       # 核心 models");
console.log("  npm install @agentgitops/git        # Git 服务");
console.log("  npm install @agentgitops/local-hub  # Local Hub");
console.log("  npm install @agentgitops/server     # Server");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    env: { ...process.env, npm_config_cache: npmCacheDir },
  });
}

function normalizeRemote(value) {
  return value
    .trim()
    .replace(/^https:\/\/github\.com\//, "github.com/")
    .replace(/^git@github\.com:/, "github.com/")
    .replace(/\.git$/, "");
}
