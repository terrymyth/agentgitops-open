export type TeamRouteAction = "status" | "tasks" | "conflicts" | "sync-config";

export interface TeamRouteMatch {
  action: TeamRouteAction;
}

const TEAM_ROUTE = /^\/api\/team\/(status|tasks|conflicts|sync-config)$/;

export function matchTeamRoute(pathname: string): TeamRouteMatch | null {
  const match = TEAM_ROUTE.exec(pathname);
  if (!match?.[1]) return null;
  return { action: match[1] as TeamRouteAction };
}
