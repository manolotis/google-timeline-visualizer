# Archive

History moved out of the live docs by housekeeping passes: kept in the repo, not read by default. Read it only to trace why something is the way it is, or when asked. Archived text is verbatim and append-only: each archive file gets one `# Pass <date> (from <sha>)` heading per pass, and every moved block notes the file and lines it came from.

## What lives where

- **LIVE** (needed to do the next task right: rules, gotchas, conventions, commands, the architecture map): `CLAUDE.md`, kept lean because it loads every session.
- **REFERENCE** (still true, needed only by some tasks): live docs under `docs/` (such as [docs/subsystems.md](../subsystems.md)) and the user-facing `README.md`. CLAUDE.md's "Read on demand" section says when to read which.
- **HISTORY** (finished task specs, validation logs, decision context, fixed review findings, run notes): here, verbatim.
- **STALE** (contradicted by the current code or docs): here too, marked "superseded by …".
- Pass records: `passes/<date>.md`, one per housekeeping pass (plan, findings, checks).

## Pass log

| Date | Base | Mode | Files | Size before → after |
| --- | --- | --- | --- | --- |
| 2026-10-18 | `293c757` | full | `CLAUDE.md`, `docs/subsystems.md` (new), `.claude/agents/*.md`, `package.json`, `package-lock.json` | CLAUDE.md 21.4 KB → 15.2 KB; nothing archived ([pass record](passes/2026-10-18.md)) |
