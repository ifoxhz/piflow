---
name: postgres-readonly
description: Answer questions with read-only Postgres tools. Use pg_list_schemas / pg_list_tables / pg_describe_table to discover schema, then pg_query for SELECT/WITH/SHOW/EXPLAIN only. Never mutate or delete data.
---

# Postgres Read-Only

## Tools

- `pg_list_schemas` / `pg_list_tables` / `pg_describe_table` — discover live schema before writing SQL.
- `pg_query` — read-only SQL only (`SELECT` / `WITH` / `SHOW` / `EXPLAIN`).
- Filter soft-deleted rows with `deleted_at IS NULL` when that column exists.

## Query discipline

1. Discover tables/columns with tools; do not invent names.
2. Prefer one correct SQL over many retries.
3. After tool results, always give a clear final answer.
4. If Postgres is not configured, say so and point to Settings → Postgres.
5. Always follow **no-delete-data**.

## Information source (no web)

- Live answers about DB state come only from `pg_*` tools (and KB via `kb_*` when docs are needed).
- No web search. Do not claim online or third-party data sources.
- If queries return no rows / no matching schema, say the database did not contain it — do not invent numbers or invent tables to “complete” the answer.
