#!/usr/bin/env node
import path from "node:path";
import {
  agops,
  createSmokeRepo,
  freePort,
  makeSmokeRoot,
  repoRoot,
  run,
  serverEntry,
} from "./smoke-utils.mjs";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.log(
    JSON.stringify(
      {
        ok: false,
        skipped: true,
        reason: "Playwright is not installed. Install it to run the real Web UI browser smoke.",
        command: "pnpm add -D playwright",
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

const root = makeSmokeRoot("agops-web-ui-browser-smoke-");
const home = path.join(root, "home");
process.env.HOME = home;

const projectPath = createSmokeRepo(root, "project", {
  "src/index.ts": "export const browserSmoke = true;\n",
});
const linkedRepoPath = createSmokeRepo(root, "linked-repo", {
  "README.md": "# linked repo\n",
});

run("node", [agops, "init", "--name", "web-ui-browser-smoke", "--force"], { cwd: projectPath });

const { startAgentGitOpsServer } = await import(serverEntry);
const started = await startAgentGitOpsServer({
  projectPath,
  staticDir: path.join(repoRoot, "apps/web/dist"),
  host: "127.0.0.1",
  port: await freePort(),
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

try {
  await page.goto(`${started.url}/team-sync`, { waitUntil: "networkidle" });
  await expectVisible(page.getByRole("heading", { name: /Team Sync/i }), "Team Sync heading");

  await page.getByLabel(/同步间隔|Sync interval/i).fill("1");
  await page.getByRole("button", { name: /保存|Save/i }).click();
  await expectVisible(
    page.getByText(/intervalSeconds must be a number greater than or equal to 5/i),
    "invalid interval error",
  );

  await page.getByLabel(/同步间隔|Sync interval/i).fill("13");
  await page.getByRole("combobox").selectOption("auto");
  await page.getByRole("button", { name: /保存|Save/i }).click();
  await expectVisible(page.getByText(/配置已保存|configuration saved/i), "saved message");

  await page.goto(`${started.url}/projects`, { waitUntil: "networkidle" });
  await expectVisible(
    page.getByRole("button", { name: /添加项目|Add Project/i }),
    "add project button",
  );
  await page.getByRole("button", { name: /添加项目|Add Project/i }).click();
  await page.locator("input").nth(0).fill(linkedRepoPath);
  await page.locator("input").nth(1).fill("Linked Repo");
  await expectChecked(page.locator("input[type='checkbox']"), "initialize checkbox");
  await page.getByRole("button", { name: /关联|Link/i }).click();
  await expectVisible(page.getByText("Linked Repo"), "linked repo card");

  console.log(
    JSON.stringify(
      {
        ok: true,
        root,
        home,
        url: started.url,
        verified: [
          "team-sync settings invalid interval error",
          "team-sync settings save state",
          "project selector add form",
          "project selector initialize checkbox",
          "project selector added project card",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await started.close();
}

async function expectVisible(locator, label) {
  await locator.waitFor({ state: "visible", timeout: 10_000 }).catch((error) => {
    throw new Error(
      `${label} was not visible: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}

async function expectChecked(locator, label) {
  const checked = await locator.isChecked();
  if (!checked) throw new Error(`${label} should be checked`);
}
