import type { InboxItem } from "./github.js";

function clip(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[truncated]`;
}

export function implementIssuePrompt(item: InboxItem): string {
  return clip(`Implement this GitHub issue and open a pull request when the work is ready.

Repository: ${item.repository}
Issue: ${item.htmlUrl}
Title: ${item.title}

${item.body || "(no description)"}

Requirements:
- Stay inside the scope of this issue.
- Match existing code style.
- Open a PR with a clear summary of what changed and how to verify it.
`);
}

export function assessIssuePrompt(item: InboxItem): string {
  return clip(`Assess whether this GitHub issue is worth implementing. Do not write code.

Repository: ${item.repository}
Issue: ${item.htmlUrl}
Title: ${item.title}

${item.body || "(no description)"}

Return a short verdict using this structure:
Verdict: IMPLEMENT | CLOSE | NEEDS_CLARITY
Why: two to five sentences.
Risk if we ignore it:
Recommended next step:
`);
}

export function assessPullPrompt(item: InboxItem): string {
  return clip(`Assess whether this pull request should be merged. Do not push code unless you find a blocking defect you can prove.

Repository: ${item.repository}
Pull request: ${item.htmlUrl}
Title: ${item.title}

${item.body || "(no description)"}

Return a short verdict using this structure:
Verdict: MERGE | REQUEST_CHANGES | CLOSE
Why: two to five sentences.
What would make this safer:
`);
}

export function reviewPullPrompt(item: InboxItem): string {
  return clip(`Review this pull request as a careful senior engineer.

Repository: ${item.repository}
Pull request: ${item.htmlUrl}
Title: ${item.title}

${item.body || "(no description)"}

Leave GitHub review comments on concrete problems. If the change is sound, say so plainly. Do not expand scope.
`);
}

export function implementFromPrompt(repository: string, prompt: string): string {
  return clip(`Work in ${repository}.

${prompt}

Open a pull request when the work is ready, unless the user asked you not to.
`);
}

