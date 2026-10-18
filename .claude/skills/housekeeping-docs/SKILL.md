---
name: housekeeping-docs
description: Documentation housekeeping pass. Moves history out of CLAUDE.md, roadmap, decision log, README and other agent-facing docs into an append-only docs/archive/ (verbatim, gated by scripts), slims what agents read every session and every task, and refreshes the graphify graph. No functional change, no code edits. Lead on Opus xhigh, Sonnet workers, Opus max final review. Use when the owner asks to tidy, slim or archive the project docs.
argument-hint: "[no-checkpoint] [resume] [notes for this pass]"
disable-model-invocation: true
model: opus
effort: xhigh
---

# Housekeeping: docs

MODE=docs. Run the procedure in [procedure.md](procedure.md) (read it in full now), skipping
every step marked [full]: no code scan, no code edits, no behaviour snapshot.

Helper scripts: `python3 ${CLAUDE_SKILL_DIR}/hk.py` (this skill's directory is
`${CLAUDE_SKILL_DIR}`; pass absolute paths to subagents).

Arguments for this pass: $ARGUMENTS
