/**
 * Review 数据模型
 */
export interface Review {
  id: string;
  changePackageId: string;
  reviewerId: string;
  action: ReviewAction;
  comment?: string;
  createdAt: string;
}

export type ReviewAction =
  | "approve"
  | "reject"
  | "request_changes"
  | "ask_agent_to_fix"
  | "escalate"
  | "mark_high_risk"
  | "add_required_check";
