import type { FollowupOutcome } from "@/lib/types";
import { Badge } from "./ui";

export const OUTCOME_LABELS: Record<FollowupOutcome, string> = {
  contacted: "Contacted",
  no_answer: "No answer",
  interested: "Interested",
  renewed: "Renewed ✓",
  lost: "Lost / not renewing",
  note: "Note",
};

export function OutcomeBadge({ outcome }: { outcome: FollowupOutcome }) {
  const tone = outcome === "renewed" ? "green" : outcome === "lost" ? "red" : outcome === "interested" ? "blue" : outcome === "no_answer" ? "yellow" : "slate";
  return <Badge tone={tone}>{OUTCOME_LABELS[outcome]}</Badge>;
}
