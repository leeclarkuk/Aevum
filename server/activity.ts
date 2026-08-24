export type ActivityKind =
  | "close_issue"
  | "close_pull"
  | "merge_pull"
  | "auto_merge_pull"
  | "comment"
  | "launch_implement"
  | "launch_assess"
  | "launch_review"
  | "skip";

export type ActivityAction = {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  repository?: string;
  htmlUrl?: string;
  agentId?: string;
  agentUrl?: string;
  createdAt: string;
};

export function recordAction(
  existing: ActivityAction[],
  action: Omit<ActivityAction, "id" | "createdAt"> & { id?: string; createdAt?: string },
): ActivityAction[] {
  const next: ActivityAction = {
    id: action.id ?? `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: action.createdAt ?? new Date().toISOString(),
    kind: action.kind,
    title: action.title,
    detail: action.detail,
    repository: action.repository,
    htmlUrl: action.htmlUrl,
    agentId: action.agentId,
    agentUrl: action.agentUrl,
  };
  return [next, ...existing].slice(0, 40);
}
