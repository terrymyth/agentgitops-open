export type TaskWorkflowAction = "start" | "run" | "test" | "package" | "pr";

export interface TaskWorkflowRouteMatch {
  taskId: string;
  action: TaskWorkflowAction;
}

const TASK_WORKFLOW_ROUTE = /^\/api\/tasks\/([^/]+)\/(start|run|test|package|pr)$/;

export function matchTaskWorkflowRoute(pathname: string): TaskWorkflowRouteMatch | null {
  const match = TASK_WORKFLOW_ROUTE.exec(pathname);
  if (!match?.[1] || !match[2]) return null;
  return {
    taskId: decodeURIComponent(match[1]),
    action: match[2] as TaskWorkflowAction,
  };
}
