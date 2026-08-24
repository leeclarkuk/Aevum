export type ScopeKind = "user" | "org" | "repo";

export type ParsedScope = {
  kind: ScopeKind;
  value: string;
  label: string;
};

export function parseScope(raw: string | undefined, fallbackLogin?: string): ParsedScope {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    if (!fallbackLogin) {
      throw new Error("Scope is required");
    }
    return {
      kind: "user",
      value: fallbackLogin,
      label: `user:${fallbackLogin}`,
    };
  }

  const prefixed = /^(user|org|repo):(.+)$/i.exec(trimmed);
  if (prefixed) {
    const kind = prefixed[1]!.toLowerCase() as ScopeKind;
    const value = prefixed[2]!.trim().replace(/^\/+|\/+$/g, "");
    if (!value) throw new Error("Scope value is empty");
    if (kind === "repo" && !value.includes("/")) {
      throw new Error("repo scope must be owner/name");
    }
    return { kind, value, label: `${kind}:${value}` };
  }

  if (trimmed.includes("/")) {
    return { kind: "repo", value: trimmed, label: `repo:${trimmed}` };
  }

  return { kind: "org", value: trimmed, label: `org:${trimmed}` };
}

export function githubSearchQualifier(scope: ParsedScope): string {
  if (scope.kind === "repo") return `repo:${scope.value}`;
  if (scope.kind === "org") return `org:${scope.value}`;
  return `user:${scope.value}`;
}

export function matchesScope(fullName: string, scope: ParsedScope): boolean {
  if (scope.kind === "repo") return fullName.toLowerCase() === scope.value.toLowerCase();
  const [owner] = fullName.split("/");
  if (scope.kind === "org" || scope.kind === "user") {
    return (owner ?? "").toLowerCase() === scope.value.toLowerCase();
  }
  return false;
}
