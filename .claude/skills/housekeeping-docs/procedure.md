# Housekeeping procedure

Shared by `/housekeeping-docs` (MODE=docs) and `/housekeeping-full` (MODE=full). Steps marked
**[full]** run only in full mode; the code rules are in `housekeeping-full/code.md`.

Goal: make the repository cheaper and clearer for coding agents to work in **without changing
what it does**. Instruction and planning docs keep only what the next task needs; history moves
verbatim to `docs/archive/`, kept in the repo but not read by default. [full] Dead or redundant
code goes, with identical behaviour. The code graph (graphify), if used, reflects the result.

No-functional-change pass: nothing user-reachable is added, removed or altered (feature,
command or flag, route or response field, UI element, setting, data, computed value, test
expectation or tolerance). If unsure whether something is functionality, it is: report it,
leave it.

## Roles and models

You are the **lead**, on Opus at xhigh (set by the skill). Delegate by role; a role's agent is
the project's `.claude/agents/<name>.md` when that file exists, otherwise `general-purpose` with
the Agent tool's `model` and `effort` parameters set as shown (this skill explicitly asks for
them).

| Role | Agent | Fallback | Does |
| --- | --- | --- | --- |
| lead | you | | preflight, plan, approval, CLAUDE.md, small docs, moves, gates, commits, review fixes, report |
| worker | `sonnet-high` | sonnet / high | baseline, reference fixes, graph refresh; [full] code-scan tool runs and evidence, SAFE deletions |
| analyst | `opus-xhigh` | opus / xhigh | one large doc (> ~60 KB): classification, move spec, condensed index; [full] SIMPLIFY changes |
| reviewer | `opus-max` | opus / max | final review of the whole branch, in a fresh context |

Every brief gives: the repo root, this file's absolute path (and `code.md`'s in full mode),
`hk.py`'s absolute path, the work dir, the base commit, the
branch, the exact files to handle and the output file to write; tells the agent to read only
what the brief names (not whole roadmaps or decision logs "for context"); and asks for a final
message of at most 15 lines. Launch independent agents in one message so they run in parallel.

Keep the whole run in **one turn**: ask with AskUserQuestion and never end the turn to wait. The
skill's model and effort apply only to the current turn; a new prompt from the user reverts to
the session model.

## Ground rules

- Read every in-scope CLAUDE.md and obey it; this procedure overrides it only where it says so.
  Never read secrets (`.env*` other than examples and templates).
- Don't fetch or sync external data during the pass: the behaviour snapshot needs frozen inputs.
- **Move, don't rewrite.** Move text with `hk.py move` / `hk.py mvfile`, never by retyping it.
  Archived text is verbatim (only relative link targets are rebased, by the tool). New prose is
  limited to stubs in live docs, the condensed indexes and the archive README.
- Never renumber or rename what other text cites: decision and task IDs, review file names,
  headings used as anchors. Keep the next free IDs recorded in the live docs.
- The archive is append-only across passes. If the project already has an archive convention
  (an archive file, a legacy or reviews folder), extend it instead of starting a parallel one
  (list such files under `no_pass_heading` in the move spec when they have their own structure).
- Proportionality: when the in-scope docs are already lean (CLAUDE.md files ≲ 8 KB together,
  every-task docs ≲ 40 KB, little history), say so and skip the docs phases. No scaffolding for
  its own sake; if nothing else remains, switch back and delete the empty branch.
- Genuine ambiguity: one AskUserQuestion round, recommended option first.

## Scope

In scope (agent-facing docs): every CLAUDE.md (root, `.claude/CLAUDE.md`, nested,
CLAUDE.local.md) and the files they tell agents to read; planning and status docs whatever their
name (roadmap, plan, tasks, status, implementation plan, per-phase task files, progress notes);
decision logs; review, audit and run notes; kickoff prompts; developer reference docs; README;
CHANGELOG; `.claude/agents`; `.claude/skills`; the project's auto-memory directory.

Out of scope (never edit, archive or flag as dead): product content (site content, datasets,
research corpora, the deliverable itself), licences and notices, generated files, lockfiles
(except when removing an unused dependency), vendored or verbatim copies of other code or
projects, folders kept for provenance, database migrations of any kind, raw data, recorded
fixture payloads.

## Tools

`HK=python3 <skill dir of housekeeping-docs>/hk.py`, run from the repo root (`$HK -h` for
details):
- `outline FILE` heading tree with line ranges, sizes and anchors; classify big files with it
  and read only the sections you need.
- `measure PATH...` bytes, lines, ≈tokens.
- `move SPEC.json [--dry-run]` moves line ranges (original line numbers) into archive files
  under `# Pass <date> (from <sha>)`, replacing each range with its `stub` (may be empty; `{link}`
  becomes a relative link to the moved text). Spec:
  `{"pass": "YYYY-MM-DD", "base": "<sha>", "no_pass_heading": [], "moves": [{"src": "ROADMAP.md",
  "lines": [152, 421], "dest": "docs/archive/ROADMAP.md", "stub": "- [x] T0.1 … [archive]({link})"}]}`.
  One spec per file is easiest; never mix specs built from different versions of a file.
  A missing destination is created as an archive (an "append-only" header comment); to move
  REFERENCE text into a new live doc, create that doc first (title, purpose, contents list) and
  list it under `no_pass_heading`.
- `mvfile SRC DEST` moves a whole file (git mv) and rebases its links.
- Neither ever writes a file Claude Code loads as instructions, nor over the archive's index: a
  destination named `CLAUDE.md` or `CLAUDE.local.md` becomes `claude-md.md` /
  `claude-local-md.md` in the same folder, and `docs/archive/README.md` becomes
  `docs/archive/readme-md.md` (`--archive DIR` if the archive lives elsewhere). They print a
  note for each renamed destination; links and stubs use the new name.
- Gates: `preserve --base SHA`, `links --baseline <work>/links-base.json`,
  `ids --base SHA --pattern <regex> [--pattern <regex>]...` (one flag per pattern for the
  project's IDs, e.g. `D-\d{3}`, `\bT\d+\.\d+\b`). Use `--exclude <glob>` for out-of-scope markdown (corpora, site content).

## Phase 0 — Preflight and baseline

Lead, before anything else:
1. `git status --porcelain` not empty → AskUserQuestion: stop (recommended) so the owner can
   commit or stash. Never stash, commit or discard work you didn't make.
2. Find the branch work normally lands on (CLAUDE.md, CI config, `origin/HEAD`). Current branch
   differs → ask: branch from the current one, or stop.
3. Arguments: `resume` → check out the existing `housekeeping/*` branch, read its pass record
   (`docs/archive/passes/<date>.md`) and continue at the first unchecked phase.
   `no-checkpoint` → skip the approval question in Phase 1 (preflight questions still apply).
   Anything else is the owner's notes for this pass: follow them.
4. Base = `git rev-parse --short HEAD`. Create `housekeeping/<YYYY-MM-DD>`. Work dir =
   `${XDG_CACHE_HOME:-$HOME/.cache}/claude-housekeeping/<repo>-<YYYY-MM-DD>/` (outside the repo:
   snapshots may hold personal data; it survives a resume).
5. List the in-scope files and the out-of-scope markdown globs (for `--exclude`).

Worker (one agent) writes `<work>/baseline.md`:
- The full check: find it (CLAUDE.md commands, Makefile, package.json scripts, scripts/, CI
  workflows: run what CI runs) and run it; record commands and outcome. No test suite → say so.
- `measure` of every in-scope file; `outline --max-level 2` of each file > 20 KB.
- `links --save <work>/links-base.json`.
- Graphify state: `which graphify`, `graphify-out/graph.json`, `.graphifyignore`, graphify hooks
  in `.claude/settings*.json`, a graphify section in a CLAUDE.md, `.claude/skills/graphify`;
  half-setups (hook without graph, stale graph).
- [full] Behaviour snapshot into `<work>/snapshot-base/`: outputs of deterministic commands over
  local inputs (CLI exports, reports, pipelines, static builds) with caches off and fixed
  parameters, plus the public surface (every CLI `--help`, API schema, route list, package
  exports). Record the exact commands so they can be re-run.

Check red → stop and report. Never clean up on a red tree.

## Phase 1 — Audit and plan (no edits to tracked files)

Mark each in-scope file's load class from the baseline and the instructions:
- every session: CLAUDE.md files on the path, their @imports, MEMORY.md (first 200 lines), files
  CLAUDE.md says to read first or every session;
- every task: files the task workflow sends agents to (tick the roadmap, append a decision,
  update the status);
- on demand: the rest.

Classify every section of every in-scope doc:
- **LIVE**: needed to do the next task right: constraints, rules, gotchas, conventions,
  commands, architecture map, open tasks in full, open questions, the binding rule of each
  active decision.
- **REFERENCE**: still true, needed only by some tasks (data model, API details, design system,
  methods, notes on external sources). Stays live in docs/ with a contents list at the top;
  propose a split by topic when a file is very large. REFERENCE inside CLAUDE.md moves to
  `docs/<topic>.md`, leaving a one-line pointer.
- **HISTORY**: completed task specs, validation logs, deviations of finished work, dated status
  narratives, fixed review findings, audits acted upon, run notes, kickoff prompts, decision
  context/options/evidence, "since task X" notes, duplicated text. Goes to the archive.
- **STALE**: contradicted by current code or docs. Goes to the archive with "superseded by …";
  listed in the report.

Targets:
- CLAUDE.md: only LIVE. Aim ≤ ~12 KB or ≤ 60 % of today, whichever is larger, without dropping
  a rule. Replace "where things are" prose with a read-on-demand map: which doc for which kind
  of task, and how to read big files by slice (grep the heading, read that range). Add:
  "`docs/archive/` holds history moved out of the live docs; read it only to trace why
  something is the way it is, or when asked."
- Planning and status docs: header, how a task is run, a Status block of ≤ 10 lines (where we
  are, what's next, blockers), open questions, open and in-progress tasks in full. A done task
  becomes a one-line stub (ID, title, commit, decision refs, `{link}`); a done phase becomes its
  heading plus those stubs; task files of finished phases move whole.
- Decision log: an index of active decisions. Move each full entry to the archive with a stub:
  ID, title, date, status, the binding rule verbatim where possible, `{link}`. Superseded
  entries: "→ superseded by …". New decisions are still written in full in the live file; the
  next pass condenses them. First pass: add a decision recording this archive convention, if the
  project keeps a decision log.
- README: every feature stays documented for users. Remove only duplication, stale statements
  and development history; propose (don't do) a split into docs/ for a long guide.
- CHANGELOG: leave it, unless released sections older than the last two are long; then move
  those verbatim.
- Agents, skills, memory: flag text duplicated from CLAUDE.md, pointers to files that will move,
  stale memories (finished hand-offs). Propose; don't delete.

Who does what:
- Analysts, one per in-scope doc over ~60 KB, in parallel: write `<work>/plan-<name>.md`
  (section, lines, class, destination, ≈bytes saved, reason) and `<work>/moves-<name>.json`
  (stubs drafted; decision logs: the index stubs). They don't edit tracked files.
- Lead: the CLAUDE.md files and smaller docs, the same two outputs; then reviews the analysts'
  plans (spot-check LIVE vs HISTORY calls, especially rules hiding in history).
- [full] Worker: code scan per `code.md` into `<work>/plan-code.md`, in parallel with the
  analysts. Lead re-checks the SAFE / SIMPLIFY / OWNER classification of every item.
- Graphify: set up → plan `.graphifyignore` entries (archive, bulk data, generated, vendored)
  and a refresh. Half-setup → propose completing or removing it. Absent → recommend for or
  against: for a real codebase agents navigate (roughly 50+ source files, several layers or
  languages, cross-file flows); against for data or content repos, small apps, prototypes.
  Weigh hook friction and the LLM cost of a full extraction against the free AST-only update.

Lead writes the pass record `docs/archive/passes/<YYYY-MM-DD>.md`: mode, base, branch, a
Progress checklist (phases 0–6), the baseline summary, the plan (per file: before → expected
size, what moves where; load per session and per task, before → expected), [full] the code
findings by class with file:line and evidence, the graphify recommendation, open questions.

**Approval** (unless `no-checkpoint`): give a short summary and the pass record's path, then
AskUserQuestion with: approve as planned (recommended); [full] approve docs only, skip code;
stop here. Free-text answers ("Other") are amendments: apply them to the plan, then continue.
On stop: leave the branch and the uncommitted pass record, report, end.

## Phase 2 — Docs (one commit)

1. First pass only: create `docs/archive/README.md` with what the archive is, a "what lives
   where" section (the classes and targets above, condensed), and a pass log table (date, base,
   mode, files, size before → after).
2. Merge the approved specs per source file; `move --dry-run`, check the summary, then `move`.
   Whole files: `mvfile` (e.g. reviews of finished work to `docs/archive/reviews/`).
3. Lead writes the remaining live-doc edits: CLAUDE.md slimming and its read-on-demand map,
   Status blocks, contents lists, REFERENCE splits that were approved.
4. Worker fixes references to moved text or files across the repo (docs, code comments, tests,
   scripts, `.claude/`) from the list of moves; lead updates pointers in the auto-memory
   directory.
5. Gates, all must pass: `preserve --base <base>` (every exception justified in the pass
   record), `links --baseline <work>/links-base.json`, `ids --base <base> --pattern …`. Re-run
   `measure` and record the sizes.
6. Commit (`housekeeping: archive history out of the live docs`), with the pass record updated.
   Push too if the project's instructions pair commit and push. Never merge.

## Phase 3 — Code [full]

Per `code.md`: SAFE items by the worker, then SIMPLIFY items by an analyst; one commit each,
each after the full check and the snapshot comparison pass.

## Phase 4 — Graph (commit only if tracked files change)

Worker, when graphify is set up: add the planned `.graphifyignore` entries; `graphify update .`
(`--force` if it refuses because code was deleted); sanity-check `graphify god-nodes`. If the
graph also indexes docs semantically, report that a semantic re-extraction is pending (`graphify
check-update .`) instead of paying for it. Lead keeps the CLAUDE.md graphify section short and
consistent. New install only if approved: `graphify claude install`; gitignore `graphify-out/`
and `.claude/*.graphify-bak`; add `.graphifyignore`; build; one `graphify query` as a check.

## Phase 5 — Review

Reviewer, fresh context, writes `<work>/review.md`:
- Re-run the three gates and the full check independently.
- Read `git diff <base>..HEAD` of every live doc: was any LIVE rule dropped, weakened or moved
  out of reach? Is archived text verbatim? Do stubs and condensed indexes say what the full
  entries say (decision rules especially)? Does the read-on-demand map point to real files and
  sections? Are stale references left (repo, `.claude/`, memory)?
- [full] Every code change: is behaviour identical (snapshot and public surface compared again)?
  Was any OWNER item touched? Any missed dynamic use (string dispatch, framework conventions)?
- Findings as must-fix / should-fix / note, each with file:line and evidence.

Lead applies must-fix and should-fix items (asks first if one conflicts with these rules or needs
the owner), re-runs the gates and the check, commits `housekeeping: review fixes`. One review
round; a must-fix still disputed after it goes to the owner in the report.

## Phase 6 — Report and record

- Pass record complete (Progress all ticked or explained), a row in the archive README's pass
  log, one line in the planning doc's status. No CHANGELOG entry (nothing user-visible
  changes). Final commit.
- Final message to the owner: before → after (bytes, ≈tokens) for every-session and every-task
  load and the biggest files; what moved where; [full] code removed or simplified (lines per
  area) and OWNER items with a recommendation; graph status; review verdict and what was fixed;
  skipped items and checks not run, with reasons; branch and commits; the work dir (delete it
  after merging).
