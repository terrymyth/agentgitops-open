#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const publicMode = process.argv.includes("--public");
const treeishIndex = process.argv.indexOf("--treeish");
const treeish = treeishIndex >= 0 ? process.argv[treeishIndex + 1] : undefined;
if (treeishIndex >= 0 && !treeish) {
  throw new Error("--treeish requires a Git ref");
}
if (!publicMode) {
  console.log("SKIP public release hygiene (pass --public on the public release branch)");
  process.exit(0);
}

const tracked = execFileSync(
  "git",
  treeish ? ["ls-tree", "-r", "--name-only", "-z", treeish] : ["ls-files", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

const forbiddenPaths = [
  /^\.agentgitops\/(?:closeouts|handoffs|packages|sync|tasks|verifications)\//,
  /^docs\/internal\//,
  /^docs\/(?:handoff-|kateagent-|dual-machine-)/,
  /^plans\//,
  /^topdocs\//,
];
// The public repository intentionally uses the maintainer's GitHub account name.
// Only identities that are not part of the public project identity belong here.
const privateUsernames = [["guo", "jian", "qiang"].join("")];
const forbiddenText = [
  {
    name: "private username",
    pattern: new RegExp(`\\b(?:${privateUsernames.join("|")})\\b`, "i"),
  },
  { name: "macOS absolute home path", pattern: /\/Users\/[^/\s]+\// },
  { name: "Windows absolute home path", pattern: /[A-Z]:\\Users\\[^\\\s]+\\/i },
  {
    name: "private key material",
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]{64,}?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  },
];

const violations = [];
for (const file of tracked) {
  if (forbiddenPaths.some((pattern) => pattern.test(file))) {
    violations.push(`${file}: forbidden public-release path`);
    continue;
  }
  if (!/\.(?:md|json|ya?ml|ts|tsx|js|mjs|txt)$/i.test(file)) continue;
  let content;
  try {
    content = treeish
      ? execFileSync("git", ["show", `${treeish}:${file}`], {
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
        })
      : readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const rule of forbiddenText) {
    if (rule.pattern.test(content)) violations.push(`${file}: ${rule.name}`);
  }
}

if (violations.length > 0) {
  console.error("Public release hygiene failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(
  `PASS public release hygiene (${tracked.length} tracked files checked${treeish ? ` at ${treeish}` : ""})`,
);
