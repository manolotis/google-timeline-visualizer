---
name: housekeeping-full
description: Full housekeeping pass. Everything housekeeping-docs does (history out of CLAUDE.md, roadmap, decision log and other agent-facing docs into an append-only docs/archive/, gated by scripts) plus a dead-code and simplification scan with behaviour snapshots, and a graphify refresh. No functional change. Lead on Opus xhigh, Sonnet workers, Opus xhigh analysts, Opus max final review. Use when the owner asks for a full tidy-up of docs and code.
argument-hint: "[no-checkpoint] [resume] [notes for this pass]"
disable-model-invocation: true
model: opus
effort: xhigh
---

# Housekeeping: docs and code

MODE=full. Run the shared procedure in
[../housekeeping-docs/procedure.md](../housekeeping-docs/procedure.md) (read it in full now),
including every step marked [full]; the code rules are in [code.md](code.md) (read it too).

This skill needs `housekeeping-docs` installed next to it: the procedure and the helper scripts
live there. Helper scripts: `python3 ${CLAUDE_SKILL_DIR}/../housekeeping-docs/hk.py` (pass
absolute paths to subagents).

Arguments for this pass: $ARGUMENTS
