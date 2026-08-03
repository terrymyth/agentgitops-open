#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./smoke-utils.mjs";

const publicRepository = "https://github.com/terrymyth/agentgitops-open.git";
const packagePaths = [
  "packages/core/package.json",
  "packages/git/package.json",
  "packages/local-hub/package.json",
  "apps/server/package.json",
  "apps/cli/package.json",
];
const errors = [];

function read(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    errors.push(`${relativePath}: missing`);
    return "";
  }
  return readFileSync(absolutePath, "utf8");
}

function parseJson(relativePath) {
  const content = read(relativePath);
  if (!content) return {};
  try {
    return JSON.parse(content);
  } catch (error) {
    errors.push(
      `${relativePath}: invalid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
    return {};
  }
}

const rootPackage = parseJson("package.json");
const publishablePackages = packagePaths.map((relativePath) => ({
  relativePath,
  manifest: parseJson(relativePath),
}));
const versions = new Set([
  rootPackage.version,
  ...publishablePackages.map(({ manifest }) => manifest.version),
]);
if (versions.size !== 1 || versions.has(undefined)) {
  errors.push(`package versions are inconsistent: ${[...versions].join(", ")}`);
}

for (const { relativePath, manifest } of publishablePackages) {
  if (manifest.license !== "Apache-2.0") {
    errors.push(`${relativePath}: license must be Apache-2.0`);
  }
  if (manifest.repository?.url !== publicRepository) {
    errors.push(`${relativePath}: repository.url must be ${publicRepository}`);
  }
  if (manifest.publishConfig?.access !== "public") {
    errors.push(`${relativePath}: publishConfig.access must be public`);
  }
}

const version = rootPackage.version;
const chart = read("deploy/helm/Chart.yaml");
const values = read("deploy/helm/values.yaml");
for (const expected of [`version: ${version}`, `appVersion: "${version}"`]) {
  if (!chart.includes(expected)) errors.push(`deploy/helm/Chart.yaml: missing ${expected}`);
}
if (!chart.includes("https://github.com/terrymyth/agentgitops-open")) {
  errors.push("deploy/helm/Chart.yaml: public repository metadata is missing");
}
if (!values.includes(`repository: ghcr.io/terrymyth/agentgitops-open`)) {
  errors.push("deploy/helm/values.yaml: public GHCR image repository is missing");
}
if (!values.includes(`tag: "${version}"`)) {
  errors.push(`deploy/helm/values.yaml: image tag must be ${version}`);
}

const ci = read(".github/workflows/ci.yml");
if (ci.includes("open-source/main")) {
  errors.push(".github/workflows/ci.yml: obsolete open-source/main trigger remains");
}
if (!ci.includes("pnpm validate:release:metadata")) {
  errors.push(".github/workflows/ci.yml: release metadata gate is missing");
}
if (!ci.includes("pnpm audit --audit-level high")) {
  errors.push(".github/workflows/ci.yml: dependency audit gate is missing");
}

const releaseWorkflow = read(".github/workflows/release.yml");
for (const required of [
  "actions/attest@v4",
  "anchore/sbom-action@v0.24.0",
  "docker/build-push-action@v7",
  "pnpm audit --audit-level high",
  "pnpm validate:release:artifacts",
  "pnpm release:npm",
  "agentgitops-chart-${chart_version}.tgz",
]) {
  if (!releaseWorkflow.includes(required)) {
    errors.push(`.github/workflows/release.yml: missing ${required}`);
  }
}

const publishScript = read("scripts/publish-npm.js");
for (const required of [
  "github.com/terrymyth/agentgitops-open",
  '"main"',
  '"--provenance"',
  "`v${version}`",
]) {
  if (!publishScript.includes(required)) {
    errors.push(`scripts/publish-npm.js: missing release guard ${required}`);
  }
}
if (publishScript.includes("open-source/main")) {
  errors.push("scripts/publish-npm.js: obsolete open-source/main guard remains");
}

const releaseStandard = read("docs/v1-release-standard.md");
if (releaseStandard.includes("`open-source/main`")) {
  errors.push("docs/v1-release-standard.md: obsolete public branch name remains");
}
if (!releaseStandard.includes("agentgitops-open")) {
  errors.push("docs/v1-release-standard.md: public repository is not named");
}

const releaseRefIndex = process.argv.indexOf("--release-ref");
if (releaseRefIndex >= 0) {
  const releaseRef = process.argv[releaseRefIndex + 1];
  if (!releaseRef) errors.push("--release-ref requires a value");
  else if (releaseRef.replace(/^refs\/tags\//, "") !== `v${version}`) {
    errors.push(`release ref ${releaseRef} does not match package version v${version}`);
  }
}

if (errors.length > 0) {
  console.error("Release metadata validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `PASS release metadata (version ${version}, ${publishablePackages.length} packages, public repository and release workflow aligned)`,
);
