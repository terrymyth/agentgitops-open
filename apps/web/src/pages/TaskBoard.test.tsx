import { MemoryRouter } from "react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskContract } from "@agentgitops/core";
import { ActorProvider } from "../actor.js";
import { I18nProvider } from "../i18n.js";
import { TaskBoard } from "./TaskBoard.js";

const api = vi.hoisted(() => ({
  createTask: vi.fn(),
  getChangePackages: vi.fn(),
  getProject: vi.fn(),
  getTaskSnapshotDrift: vi.fn(),
  getTasks: vi.fn(),
  runTaskWorkflowAction: vi.fn(),
}));

vi.mock("../api.js", () => api);

const task: TaskContract = {
  id: "task-001",
  projectId: "project-1",
  title: "Secure merge gate",
  objective: "Prevent unsafe merge",
  baseBranch: "main",
  targetBranch: "agent/task-001/codex",
  agentId: "codex",
  allowedPaths: ["apps/**"],
  forbiddenPaths: [],
  requiredChecks: ["pnpm test"],
  riskLevel: "medium",
  approval: { required: true, reviewers: ["reviewer-one"] },
  merge: { strategy: "manual" },
  status: "created",
  createdAt: "2026-07-21T00:00:00.000Z",
  updatedAt: "2026-07-21T00:00:00.000Z",
};

function renderBoard() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <ActorProvider>
          <TaskBoard />
        </ActorProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getTasks.mockResolvedValue([]);
  api.getChangePackages.mockResolvedValue([]);
  api.getTaskSnapshotDrift.mockResolvedValue([]);
  api.getProject.mockResolvedValue({ agents: ["codex"], taskTemplates: ["safe-change"] });
  api.createTask.mockReset();
  api.runTaskWorkflowAction.mockReset();
});

describe("TaskBoard", () => {
  it("shows the empty state after loading", async () => {
    renderBoard();
    expect(await screen.findByText("暂无任务")).toBeInTheDocument();
  });

  it("creates a task with normalized form data and current actor", async () => {
    localStorage.setItem("agentgitops.actorId", "owner-one");
    api.createTask.mockResolvedValue({ task, message: "Task created" });
    const user = userEvent.setup();
    renderBoard();

    await screen.findByText("暂无任务");
    fireEvent.change(screen.getByPlaceholderText("任务标题"), {
      target: { value: "  Secure merge gate  " },
    });
    fireEvent.change(screen.getByPlaceholderText("目标说明"), {
      target: { value: "Prevent unsafe merge" },
    });
    fireEvent.change(screen.getByPlaceholderText("验证命令，逗号分隔"), {
      target: { value: "pnpm lint, pnpm test" },
    });
    await user.click(screen.getByRole("button", { name: "新建任务" }));

    await waitFor(() =>
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Secure merge gate",
          objective: "Prevent unsafe merge",
          agentId: "codex",
          actorId: "owner-one",
          requiredChecks: ["pnpm lint", "pnpm test"],
        }),
      ),
    );
    expect(await screen.findByText("Task created")).toBeInTheDocument();
    expect(screen.getByText("Secure merge gate")).toBeInTheDocument();
  });

  it("surfaces API failures and recovers on retry", async () => {
    api.getTasks
      .mockRejectedValueOnce(new Error("service unavailable"))
      .mockResolvedValueOnce([task]);
    const user = userEvent.setup();
    renderBoard();

    expect(await screen.findByText("service unavailable")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("Secure merge gate")).toBeInTheDocument();
    expect(screen.queryByText("service unavailable")).not.toBeInTheDocument();
  });

  it("runs a workflow action and reloads the board", async () => {
    api.getTasks.mockResolvedValue([task]);
    api.runTaskWorkflowAction.mockResolvedValue({ task, message: "Workspace created" });
    const user = userEvent.setup();
    renderBoard();

    await screen.findByText("Secure merge gate");
    await user.click(screen.getByRole("button", { name: "工作区" }));

    await waitFor(() =>
      expect(api.runTaskWorkflowAction).toHaveBeenCalledWith(
        "task-001",
        "start",
        expect.objectContaining({ actorId: "local-user", draft: true, reviewContextComment: true }),
      ),
    );
    expect(await screen.findByText("Workspace created")).toBeInTheDocument();
    expect(api.getTasks).toHaveBeenCalledTimes(2);
  });
});
