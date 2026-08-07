---
name: local-fs
description: Work within a configured local workspace using read/bash/edit/write. Stay inside the workspace root; prefer read before write; never delete files unless the user explicitly insists and policy still blocks destructive deletes.
---

# Local Filesystem

## Scope

- Working directory is the configured **workspace root** only.
- Prefer `read` for inspecting files; use `bash` for listing/search (`ls`, `rg`, `find`) when needed.
- Use `edit` / `write` only to create or modify files **inside** the workspace.
- Never use paths that escape the workspace (no `..` traversal outside root, no absolute paths elsewhere).

## Safety

- Follow **no-delete-data**: do not delete, truncate, or destroy files/directories.
- Forbidden bash patterns: `rm`, `del`, `rd`, `rmdir`, `Remove-Item`, format/disk tools, rewriting secrets outside the task.
- If a write is ambiguous, ask or propose a diff first; keep changes minimal.

## Workflow

1. Confirm the target path under the workspace.
2. Read existing content before editing.
3. Apply the smallest change that satisfies the request.
4. Summarize which files were read/changed.
