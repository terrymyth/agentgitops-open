#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const root = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "agentgitops-npm-install-"));
const packDir = join(tempRoot, "packs");
const installDir = join(tempRoot, "install");
mkdirSync(packDir);
mkdirSync(installDir);

const packageDirs = [
  "packages/core",
  "packages/git",
  "packages/local-hub",
  "apps/server",
  "apps/cli",
];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    env: { ...process.env, npm_config_update_notifier: "false" },
  });
}

try {
  if (!process.argv.includes("--skip-build")) run("pnpm", ["build"], { stdio: "inherit" });

  const tarballs = [];
  for (const packageDir of packageDirs) {
    const output = run("pnpm", ["pack", "--pack-destination", packDir], {
      cwd: resolve(root, packageDir),
    });
    const tarballName = output.trim().split(/\r?\n/).at(-1);
    if (!tarballName?.endsWith(".tgz"))
      throw new Error(`Unable to resolve tarball for ${packageDir}: ${output}`);
    tarballs.push(resolve(packDir, basename(tarballName)));
  }

  const packageNames = [
    "@agentgitops/core",
    "@agentgitops/git",
    "@agentgitops/local-hub",
    "@agentgitops/server",
    "agentgitops",
  ];
  const localPackages = Object.fromEntries(
    packageNames.map((name, index) => [name, `file:${tarballs[index]}`]),
  );
  writeFileSync(
    join(installDir, "package.json"),
    JSON.stringify(
      {
        name: "agentgitops-install-smoke",
        private: true,
        dependencies: localPackages,
        pnpm: { overrides: localPackages },
      },
      null,
      2,
    ),
  );
  run("pnpm", ["install", "--prefer-offline"], { cwd: installDir, stdio: "inherit" });

  const cliPath = join(
    installDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "agentgitops.CMD" : "agentgitops",
  );
  const help = run(cliPath, ["--help"], { cwd: installDir });
  const version = run(cliPath, ["--version"], { cwd: installDir }).trim();
  if (!help.includes("Agent-native GitOps") || version !== "0.1.0") {
    throw new Error(`Installed CLI verification failed (version=${version})`);
  }

  const cliPackage = JSON.parse(
    readFileSync(join(installDir, "node_modules", "agentgitops", "package.json"), "utf8"),
  );
  for (const [name, value] of Object.entries(cliPackage.dependencies ?? {})) {
    if (String(value).startsWith("workspace:"))
      throw new Error(`Unresolved workspace dependency in packed CLI: ${name}=${value}`);
  }

  console.log(`PASS npm install smoke (${tarballs.length} local tarballs, CLI ${version})`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
