export type WorkflowJobAction = "cancel" | "retry";

export interface WorkflowJobRouteMatch {
  jobId: string;
  action: WorkflowJobAction;
}

const WORKFLOW_JOB_ROUTE = /^\/api\/workflow-jobs\/([^/]+)\/(cancel|retry)$/;

export function matchWorkflowJobRoute(pathname: string): WorkflowJobRouteMatch | null {
  const match = WORKFLOW_JOB_ROUTE.exec(pathname);
  if (!match?.[1] || !match[2]) return null;
  return {
    jobId: decodeURIComponent(match[1]),
    action: match[2] as WorkflowJobAction,
  };
}
