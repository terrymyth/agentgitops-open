#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./smoke-utils.mjs";

const artifactArgument = process.argv.slice(2).find((argument) => argument !== "--");
const artifactDirectory = path.resolve(repoRoot, artifactArgument ?? "release-artifacts");
const { version } = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const expectedArchives = new Map([
  [`agentgitops-${version}.tgz`, "package/package.json"],
  [`agentgitops-core-${version}.tgz`, "package/package.json"],
  [`agentgitops-git-${version}.tgz`, "package/package.json"],
  [`agentgitops-local-hub-${version}.tgz`, "package/package.json"],
  [`agentgitops-server-${version}.tgz`, "package/package.json"],
  [`agentgitops-chart-${version}.tgz`, "agentgitops/Chart.yaml"],
]);
const errors = [];

if (!existsSync(artifactDirectory) || !statSync(artifactDirectory).isDirectory()) {
  console.error(`Release artifact validation failed: ${artifactDirectory} is not a directory`);
  process.exit(1);
}

const actualArchives = readdirSync(artifactDirectory)
  .filter((file) => file.endsWith(".tgz"))
  .sort();
const expectedNames = [...expectedArchives.keys()].sort();

for (const expectedName of expectedNames) {
  const archivePath = path.join(artifactDirectory, expectedName);
  if (!existsSync(archivePath) || !statSync(archivePath).isFile()) {
    errors.push(`${expectedName}: missing`);
    continue;
  }

  try {
    const entries = execFileSync("tar", ["-tzf", archivePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).split(/\r?\n/u);
    const requiredEntry = expectedArchives.get(expectedName);
    if (!entries.includes(requiredEntry)) {
      errors.push(`${expectedName}: expected ${requiredEntry}, archive may have been overwritten`);
    }
  } catch (error) {
    errors.push(
      `${expectedName}: unreadable archive (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

for (const unexpectedName of actualArchives.filter((file) => !expectedArchives.has(file))) {
  errors.push(`${unexpectedName}: unexpected release archive`);
}

const sourceSbomPath = path.join(artifactDirectory, "source.spdx.json");
if (!existsSync(sourceSbomPath)) {
  errors.push("source.spdx.json: missing");
} else {
  try {
    const sourceSbom = JSON.parse(readFileSync(sourceSbomPath, "utf8"));
    if (sourceSbom.spdxVersion !== "SPDX-2.3" || !Array.isArray(sourceSbom.packages)) {
      errors.push("source.spdx.json: invalid SPDX 2.3 document");
    }
  } catch (error) {
    errors.push(
      `source.spdx.json: invalid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

if (errors.length > 0) {
  console.error("Release artifact validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `PASS release artifacts (${expectedNames.length} unique archives, CLI and Helm payloads verified)`,
);
