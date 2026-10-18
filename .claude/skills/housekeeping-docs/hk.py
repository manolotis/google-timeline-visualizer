"""Deterministic helpers for the housekeeping skills (stdlib only, Python 3.10+).

Run from the repository root (python3 hk.py <command> -h for details):

  outline FILE [--max-level N]         headings with line ranges, sizes and anchors
  measure PATH... [--json]             bytes, lines, ~tokens (bytes/4) of .md files
  move SPEC.json [--dry-run]           move line ranges verbatim into archive files
  mvfile SRC DEST                      git mv a whole file, rebasing its links
  preserve --base SHA [--archive DIR]  every removed doc line still exists somewhere
  links [--save F] [--baseline F]      broken relative links and anchors in .md files
  ids --base SHA --pattern RE...       every ID present at SHA is still present

Moved text is copied byte for byte except relative link targets, which are rebased
so they still resolve from the new location; preserve ignores link targets for the
same reason. preserve, links and ids exit 1 when they find a problem, else 0.

move and mvfile never write a file that Claude Code loads as instructions, nor over
the archive's index: a destination named CLAUDE.md or CLAUDE.local.md becomes
claude-md.md or claude-local-md.md in the same folder, and <archive>/README.md
becomes <archive>/readme-md.md (--archive, default docs/archive). They print a note
when they rename a destination.
"""

from __future__ import annotations

import argparse
import difflib
import fnmatch
import itertools
import json
import os
import re
import subprocess
import sys
import urllib.parse
from pathlib import Path

HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
FENCE = re.compile(r"^\s*(```|~~~)")
HTML_ID = re.compile(r"""<a\s+[^>]*(?:id|name)=["']([^"']+)["']""", re.IGNORECASE)
LINK_TEXT = r"!?\[(?:[^\[\]]|\[[^\]]*\])*\]"
INLINE_LINK = re.compile(LINK_TEXT + r"\(\s*<?([^)\s>]+)>?(?:\s+[\"'(][^)]*)?\)")
REF_LINK = re.compile(r"^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+.*)?$")
LINK_TARGET = re.compile(r"(\]\()\s*<?[^)\s>]*>?")
REF_TARGET = re.compile(r"^(\s{0,3}\[[^\]]+\]:)\s*\S+")
REBASE_INLINE = re.compile(r"(\]\(\s*<?)([^)\s>]+)")
REBASE_REF = re.compile(r"^(\s{0,3}\[[^\]]+\]:\s*<?)(\S+?)(>?(?:\s.*)?)$", re.DOTALL)
SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")
LINE_ANCHOR = re.compile(r"^L\d+(-L?\d+)?$")
TRIVIAL = re.compile(r"^[\W_]*$")
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "graphify-out"}
ARCHIVE_HEADER = "<!-- Housekeeping archive of {src}: append-only, never edited. -->\n"
# File names Claude Code loads as instructions from any folder it works in: an
# archive named like this would be read as instructions, history and all.
INSTRUCTION_NAMES = {"claude.md", "claude.local.md"}


# ---------------------------------------------------------------- helpers


def git(*args: str) -> str:
    done = subprocess.run(["git", *args], check=True, capture_output=True, text=True)
    return done.stdout


def is_tracked(path: str) -> bool:
    cmd = ["git", "ls-files", "--error-unmatch", path]
    return subprocess.run(cmd, check=False, capture_output=True).returncode == 0


def excluded(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(path, p) for p in patterns)


def current_md_files(excludes: list[str]) -> list[str]:
    """Tracked plus untracked-but-not-ignored .md files in the working tree."""
    cmd = ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"]
    names = git(*cmd).splitlines()
    keep = {n for n in names if os.path.isfile(n) and not excluded(n, excludes)}
    return sorted(keep)


def base_md_files(base: str, excludes: list[str]) -> list[str]:
    names = git("ls-tree", "-r", "--name-only", base).splitlines()
    return [n for n in names if n.endswith(".md") and not excluded(n, excludes)]


def base_text(base: str, path: str) -> str:
    cmd = ["git", "show", f"{base}:{path}"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return raw.decode("utf-8", errors="replace")


def safe_dest(dest: str, archive: str) -> str:
    """The path move and mvfile write to instead of `dest` (see the module doc)."""
    folder, name = os.path.split(dest)
    if name.lower() in INSTRUCTION_NAMES:
        new = os.path.join(folder, name.lower().replace(".", "-") + ".md")
    elif os.path.normpath(dest).lower() == os.path.normpath(os.path.join(archive, "README.md")).lower():
        new = os.path.join(folder, "readme-md.md")
    else:
        return dest
    print(f"note: {dest} -> {new} (never an instruction file or the archive's index)")
    return new


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8", errors="replace")


def size_of(lines: list[str]) -> int:
    return sum(len(x.encode()) for x in lines)


def human(n: int) -> str:
    return f"{n / 1024:.1f} KB" if n >= 1024 else f"{n} B"


def normalise(line: str) -> str:
    """Whitespace-collapsed, with link targets blanked (moves may rebase them)."""
    blanked = REF_TARGET.sub(r"\1", LINK_TARGET.sub(r"\1", line))
    return " ".join(blanked.split())


def rebase_target(target: str, src_dir: str, dest_dir: str) -> str:
    if not target or SCHEME.match(target) or target.startswith(("/", "#")):
        return target
    path, sep, anchor = target.partition("#")
    absolute = os.path.normpath(os.path.join(src_dir, path))
    moved = os.path.relpath(absolute, dest_dir or ".").replace(os.sep, "/")
    return moved + sep + anchor


def rebase_lines(lines: list[str], src: str, dest: str) -> list[str]:
    """Rewrite relative link targets outside code so they resolve from dest."""
    src_dir, dest_dir = os.path.dirname(src), os.path.dirname(dest)
    if os.path.normpath(src_dir or ".") == os.path.normpath(dest_dir or "."):
        return list(lines)

    def inline(m: re.Match[str]) -> str:
        return m.group(1) + rebase_target(m.group(2), src_dir, dest_dir)

    def ref(m: re.Match[str]) -> str:
        return inline(m) + m.group(3)

    out, fenced = [], False
    for line in lines:
        fence = bool(FENCE.match(line))
        fenced = fenced != fence
        if fenced or fence:
            out.append(line)
            continue
        parts = re.split(r"(`[^`]*`)", line)
        for k in range(0, len(parts), 2):
            parts[k] = REBASE_REF.sub(ref, REBASE_INLINE.sub(inline, parts[k]))
        out.append("".join(parts))
    return out


def slug(text: str) -> str:
    """GitHub-style heading anchor (before de-duplication)."""
    t = re.sub(r"<[^>]+>", "", text)
    t = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"[^\w\- ]", "", t.strip().lower())
    return t.replace(" ", "-")


def headings(lines: list[str]) -> list[tuple[int, int, str]]:
    """(0-based line index, level, text) of every ATX heading outside code."""
    out, fenced = [], False
    for i, line in enumerate(lines):
        if FENCE.match(line):
            fenced = not fenced
            continue
        m = None if fenced else HEADING.match(line)
        if m:
            out.append((i, len(m.group(1)), m.group(2)))
    return out


def anchors_by_line(lines: list[str]) -> dict[int, str]:
    seen: dict[str, int] = {}
    out = {}
    for i, _, text in headings(lines):
        s = slug(text)
        n = seen.get(s, 0)
        seen[s] = n + 1
        out[i] = s if n == 0 else f"{s}-{n}"
    return out


def anchor_set(text: str) -> set[str]:
    found = set(anchors_by_line(text.splitlines()).values())
    return found | set(HTML_ID.findall(text))


# ---------------------------------------------------------------- outline


def cmd_outline(a: argparse.Namespace) -> int:
    lines = read(a.file).splitlines(keepends=True)
    hs = headings(lines)
    anchors = anchors_by_line(lines)
    for k, (i, level, text) in enumerate(hs):
        if level > a.max_level:
            continue
        ends = [j for j, lv, _ in hs[k + 1 :] if lv <= level]
        end = ends[0] if ends else len(lines)
        size = human(size_of(lines[i:end]))
        print(f"L{i + 1}-{end}\t{'#' * level} {text}\t({size})\t#{anchors[i]}")
    print(f"total\t{len(lines)} lines\t{human(size_of(lines))}")
    return 0


# ---------------------------------------------------------------- measure


def cmd_measure(a: argparse.Namespace) -> int:
    files: list[Path] = []
    for p in map(Path, a.paths):
        if p.is_dir():
            for root, dirs, names in os.walk(p):
                dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
                files += [Path(root) / n for n in names if n.endswith(".md")]
        elif p.is_file():
            files.append(p)
    rows: list[tuple[int, int, str]] = []
    for f in sorted(set(files)):
        data = f.read_bytes()
        rows.append((len(data), data.count(b"\n"), str(f)))
    rows.sort(key=lambda r: -r[0])
    if a.json:
        keys = ("bytes", "lines", "file")
        out = [dict(zip(keys, r, strict=True)) | {"tokens": r[0] // 4} for r in rows]
        print(json.dumps(out, indent=1))
        return 0
    for b, n, f in rows:
        print(f"{b:>9}  {n:>6}  ~{b // 4:>7} tok  {f}")
    total, lines = sum(r[0] for r in rows), sum(r[1] for r in rows)
    print(f"{total:>9}  {lines:>6}  ~{total // 4:>7} tok  TOTAL ({len(rows)} files)")
    return 0


# ---------------------------------------------------------------- move


def cmd_move(a: argparse.Namespace) -> int:
    spec = json.loads(read(a.spec))
    base = spec["base"]
    pass_heading = f"# Pass {spec['pass']} (from {base})"
    renamed = {d: safe_dest(d, a.archive) for d in dict.fromkeys(m["dest"] for m in spec["moves"])}
    no_heading = {renamed.get(d, d) for d in spec.get("no_pass_heading", [])}
    moves = [{**m, "dest": renamed[m["dest"]]} for m in spec["moves"]]

    src_lines: dict[str, list[str]] = {}
    for m in moves:
        src = m["src"]
        if src not in src_lines:
            src_lines[src] = read(src).splitlines(keepends=True)
        start, end = m["lines"]
        if not 1 <= start <= end <= len(src_lines[src]):
            sys.exit(f"bad range {start}-{end} for {src}")
    for src in src_lines:
        ranges = sorted(tuple(m["lines"]) for m in moves if m["src"] == src)
        for (s1, e1), (s2, _) in itertools.pairwise(ranges):
            if s2 <= e1:
                sys.exit(f"overlapping ranges in {src}: {s1}-{e1} and {s2}-")

    # Append blocks to their archive files, remembering where each block lands:
    # (move, dest, index of the block's first line, block length).
    dest_text: dict[str, list[str]] = {}
    placed: list[tuple[dict, str, int, int]] = []
    for m in moves:
        dest = m["dest"]
        if dest not in dest_text:
            old = read(dest).splitlines(keepends=True) if os.path.exists(dest) else []
            old = old or [ARCHIVE_HEADER.format(src=m["src"])]
            if not old[-1].endswith("\n"):
                old[-1] += "\n"
            has_heading = any(x.rstrip("\n") == pass_heading for x in old)
            if dest not in no_heading and not has_heading:
                old += ["\n", pass_heading + "\n"]
            dest_text[dest] = old
        start, end = m["lines"]
        block = rebase_lines(src_lines[m["src"]][start - 1 : end], m["src"], dest)
        if block and not block[-1].endswith("\n"):
            block[-1] += "\n"
        out = dest_text[dest]
        out += ["\n", f"<!-- {m['src']}, lines {start}-{end} at {base} -->\n"]
        placed.append((m, dest, len(out), len(block)))
        out += block

    links: list[str] = []
    for m, dest, first, length in placed:
        anchors = anchors_by_line(dest_text[dest])
        inside = [anchors[i] for i in range(first, first + length) if i in anchors]
        before = [v for i, v in sorted(anchors.items()) if i < first]
        anchor = inside[0] if inside else (before[-1] if before else "")
        rel = os.path.relpath(dest, os.path.dirname(m["src"]) or ".")
        rel = rel.replace(os.sep, "/")
        links.append(f"{rel}#{anchor}" if anchor else rel)

    # Replace source ranges bottom-up so earlier line numbers stay valid.
    new_src = {s: list(v) for s, v in src_lines.items()}
    for k in sorted(range(len(placed)), key=lambda k: -placed[k][0]["lines"][0]):
        m = placed[k][0]
        start, end = m["lines"]
        stub = m.get("stub", "").replace("{link}", links[k])
        repl = [ln + "\n" for ln in stub.split("\n")] if stub else []
        new_src[m["src"]][start - 1 : end] = repl

    for (m, *_), link in zip(placed, links, strict=True):
        start, end = m["lines"]
        size = human(size_of(src_lines[m["src"]][start - 1 : end]))
        print(f"{m['src']} L{start}-{end} ({size}) -> {link}")
    for src, lines in new_src.items():
        before_size, after_size = size_of(src_lines[src]), size_of(lines)
        print(f"{src}: {human(before_size)} -> {human(after_size)}")
    if a.dry_run:
        print("dry run: nothing written")
        return 0
    for dest, out in dest_text.items():
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        Path(dest).write_text("".join(out), encoding="utf-8")
    for src, lines in new_src.items():
        Path(src).write_text("".join(lines), encoding="utf-8")
    return 0


def cmd_mvfile(a: argparse.Namespace) -> int:
    a.dest = safe_dest(a.dest, a.archive)
    if os.path.exists(a.dest):
        sys.exit(f"{a.dest} exists")
    lines = read(a.src).splitlines(keepends=True)
    Path(a.dest).parent.mkdir(parents=True, exist_ok=True)
    tracked = is_tracked(a.src)
    if tracked:
        git("mv", a.src, a.dest)
    else:
        os.rename(a.src, a.dest)
    text = "".join(rebase_lines(lines, a.src, a.dest))
    Path(a.dest).write_text(text, encoding="utf-8")
    print(f"{a.src} -> {a.dest}" + (" (git mv)" if tracked else ""))
    return 0


# ---------------------------------------------------------------- preserve


def cmd_preserve(a: argparse.Namespace) -> int:
    archive = a.archive.rstrip("/") + "/"
    pool: set[str] = set()
    for f in current_md_files(a.exclude):
        pool.update(normalise(x) for x in read(f).splitlines())
    for root in a.extra or []:
        for f in Path(root).rglob("*.md"):
            pool.update(normalise(x) for x in read(str(f)).splitlines())
    problems = 0
    for path in base_md_files(a.base, a.exclude):
        if path.startswith(archive):
            continue
        old = base_text(a.base, path).splitlines()
        new = read(path).splitlines() if os.path.isfile(path) else []
        if old == new:
            continue
        removed: list[tuple[int, str]] = []
        sm = difflib.SequenceMatcher(None, old, new, autojunk=False)
        for tag, i1, i2, _, _ in sm.get_opcodes():
            if tag in ("delete", "replace"):
                removed += [(i + 1, old[i]) for i in range(i1, i2)]
        missing = []
        for n, x in removed:
            key = normalise(x)
            if not TRIVIAL.match(key) and key not in pool:
                missing.append((n, x))
        print(f"{path}: {len(removed)} removed, {len(missing)} not found elsewhere")
        for n, x in missing[: a.limit]:
            print(f"  L{n}: {x.strip()[:160]}")
        if len(missing) > a.limit:
            print(f"  ... {len(missing) - a.limit} more")
        problems += len(missing)
    print(f"{problems} removed lines exist nowhere else" if problems else "OK")
    return 1 if problems else 0


# ---------------------------------------------------------------- links


def find_links(text: str) -> list[tuple[int, str]]:
    out, fenced = [], False
    for n, line in enumerate(text.splitlines(), 1):
        if FENCE.match(line):
            fenced = not fenced
            continue
        if fenced:
            continue
        scan = re.sub(r"`[^`]*`", "", line)
        out += [(n, t) for t in INLINE_LINK.findall(scan)]
        m = REF_LINK.match(scan)
        if m:
            out.append((n, m.group(1)))
    return out


def cmd_links(a: argparse.Namespace) -> int:
    files = current_md_files(a.exclude)
    cache: dict[str, set[str]] = {}

    def has_anchor(path: str, anchor: str) -> bool:
        if path not in cache:
            cache[path] = {x.lower() for x in anchor_set(read(path))}
        return anchor.lower() in cache[path]

    broken = []
    for f in files:
        for n, target in find_links(read(f)):
            if SCHEME.match(target) or target.startswith("/"):
                continue
            path, _, anchor = target.partition("#")
            path, anchor = urllib.parse.unquote(path), urllib.parse.unquote(anchor)
            dest = os.path.join(os.path.dirname(f), path) if path else f
            dest = os.path.normpath(dest)
            is_doc = dest.endswith(".md") and not LINE_ANCHOR.match(anchor)
            if not os.path.exists(dest):
                broken.append((f, n, target, "missing file"))
            elif anchor and is_doc and not has_anchor(dest, anchor):
                broken.append((f, n, target, "missing anchor"))
    keys = sorted({f"{f}|{t}" for f, _, t, _ in broken})
    if a.save:
        Path(a.save).write_text(json.dumps(keys, indent=1), encoding="utf-8")
    known = set(json.loads(read(a.baseline))) if a.baseline else set()
    new = [b for b in broken if f"{b[0]}|{b[2]}" not in known]
    for f, n, t, why in new:
        print(f"{f}:{n}: {t} ({why})")
    label = "new broken links" if a.baseline else "broken links"
    extra = f" ({len(broken)} incl. baseline)" if a.baseline else ""
    print(f"{len(new)} {label} in {len(files)} files{extra}")
    return 1 if new else 0


# ---------------------------------------------------------------- ids


def cmd_ids(a: argparse.Namespace) -> int:
    pats = [re.compile(p) for p in a.pattern]

    def collect(texts: list[str]) -> set[str]:
        return {m.group(0) for t in texts for p in pats for m in p.finditer(t)}

    before = collect([base_text(a.base, p) for p in base_md_files(a.base, a.exclude)])
    after = collect([read(p) for p in current_md_files(a.exclude)])
    lost = sorted(before - after)
    print(f"{len(before)} IDs at {a.base}, {len(after)} now, {len(lost)} lost")
    for x in lost:
        print(f"  lost: {x}")
    return 1 if lost else 0


# ---------------------------------------------------------------- main


def main() -> int:
    raw = argparse.RawDescriptionHelpFormatter
    p = argparse.ArgumentParser(description=__doc__, formatter_class=raw)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("outline", help="headings with line ranges and sizes")
    s.add_argument("file")
    s.add_argument("--max-level", type=int, default=6)
    s.set_defaults(fn=cmd_outline)

    s = sub.add_parser("measure", help="bytes, lines and ~tokens of .md files")
    s.add_argument("paths", nargs="+")
    s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_measure)

    s = sub.add_parser("move", help="move line ranges verbatim into archives")
    s.add_argument("spec")
    s.add_argument("--dry-run", action="store_true")
    s.add_argument("--archive", default="docs/archive")
    s.set_defaults(fn=cmd_move)

    s = sub.add_parser("mvfile", help="git mv a file, rebasing its links")
    s.add_argument("src")
    s.add_argument("dest")
    s.add_argument("--archive", default="docs/archive")
    s.set_defaults(fn=cmd_mvfile)

    gates = (
        ("preserve", cmd_preserve, "removed doc lines must exist elsewhere"),
        ("links", cmd_links, "broken relative links and anchors"),
        ("ids", cmd_ids, "IDs present at --base must still be present"),
    )
    for name, fn, text in gates:
        s = sub.add_parser(name, help=text)
        s.add_argument("--exclude", action="append", default=[], help="glob to skip")
        s.set_defaults(fn=fn)
        if name in ("preserve", "ids"):
            s.add_argument("--base", required=True)
    preserve, links, ids = (sub.choices[n] for n, _, _ in gates)
    preserve.add_argument("--archive", default="docs/archive")
    preserve.add_argument("--extra", action="append", help="also search this dir")
    preserve.add_argument("--limit", type=int, default=20)
    links.add_argument("--save", help="write the broken-link keys as JSON")
    links.add_argument("--baseline", help="report only links not in this JSON")
    ids.add_argument("--pattern", action="append", required=True, help="ID regex")

    a = p.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
