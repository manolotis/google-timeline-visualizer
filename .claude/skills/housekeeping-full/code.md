# Code rules (housekeeping-full)

Same no-functional-change contract as the docs: identical behaviour, identical public surface.

## Scan (worker, report only; writes `<work>/plan-code.md`)

Ephemeral runners only (`uvx`, `npx`, `pipx run`): never add a dependency, never change lint,
format or type-checker config. Per language present, for example:
- Python: `vulture <pkg> tests scripts --min-confidence 60`;
  `ruff check --no-fix --statistics --select F401,F811,F841,ERA001,SIM,RET,PIE,C4,UP`;
  `pylint --disable=all --enable=duplicate-code <pkg>`.
- JS/TS: `knip` (unused files, exports, dependencies, types);
  `tsc --noEmit --noUnusedLocals --noUnusedParameters` as a probe; `jscpd <src>` for duplication.
- Across layers: server routes no client calls; scripts, assets, fixtures and test helpers
  nothing references; TODO/FIXME about finished work; commented-out code; variables in the
  example env file nothing reads; dependencies nothing imports.

Skip everything out of scope (vendored copies, provenance folders, generated files, migrations).
Confirm every hit by search before listing it: framework conventions (route and CLI decorators,
ORM or schema fields, test fixtures and conftest, file-based routing, config files, entry points
in package metadata), `__all__`, re-exports, dynamic imports, `getattr` and string dispatch,
templates, and references from docs or CI all make live code look unused.

Each finding: class, file:line, what it is, the evidence (the search that shows no reference),
≈lines saved.

## Classes

- **SAFE**: provably unreferenced internal code; unused imports, locals and dependencies; dead
  branches; commented-out code; obsolete TODOs.
- **SIMPLIFY**: same behaviour in fewer lines (a duplicated helper merged, a verbose idiom), only
  where tests cover the path.
- **OWNER** (report only, never applied): anything reachable from a user entry point (command,
  flag, route, page, script, documented feature) even if nothing calls it internally; code used
  only by its own tests; schema; public interfaces and response shapes; any non-deletion change
  in numerical, financial, medical, security or otherwise safety-relevant code.

The lead re-checks every classification; when in doubt, OWNER.

## Apply (only approved items)

- SAFE by the worker, one commit; then SIMPLIFY by an analyst, one commit.
- No formatting churn, no renames of public names, no new abstractions. Removing an unused
  dependency updates its lockfile with the project's package manager.
- No test suite: only SAFE items that build, type-check and lint prove (unused imports, files
  the build doesn't include); everything else stays in the report.
- After each commit: full check green; re-run the recorded snapshot commands into
  `<work>/snapshot-<step>/` and compare with `snapshot-base/` (byte-identical, or equal after
  sorting JSON keys or ignoring content-hashed asset names); public surface identical. Any
  difference: revert that change, re-verify, and list it in the pass record.
- Record lines removed per area in the pass record.
