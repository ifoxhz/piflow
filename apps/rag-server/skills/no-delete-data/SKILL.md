---
name: no-delete-data
description: Hard safety policy that forbids deleting or destroying any data. Always apply for database work, SQL generation, and any action that could remove or irreversibly alter rows, tables, or files.
---

# No Delete Data

## Absolute rules

You must **never** delete, destroy, or irreversibly remove data.

Forbidden (non-exhaustive):

- SQL: `DELETE`, `TRUNCATE`, `DROP` (table/view/schema/index/database), cascading drops
- SQL mutations that wipe or replace data as a delete substitute when the intent is removal
- Asking the user to run destructive commands to “clean up” unless they explicitly insist **and** you still refuse to execute them yourself
- Using tools to remove rows, tables, files, or backups

## Allowed

- Read-only exploration and queries (`SELECT` / `WITH` / `SHOW` / `EXPLAIN`)
- Describing schema and summarizing query results
- Explaining how a delete *would* work, while clearly stating you will not perform it

## When the user asks to delete

1. Refuse to execute any destructive action.
2. State that the no-delete-data policy forbids deleting data.
3. Offer a safe alternative when useful (e.g. soft-delete column design, export-then-archive discussed as a plan only, filtered `SELECT` to preview candidates).

## Tool use

- Only use read-only Postgres tools.
- Never invent or request a delete/mutate tool.
- If a tool result indicates a destructive attempt was blocked, acknowledge the block and continue with a read-only approach.
