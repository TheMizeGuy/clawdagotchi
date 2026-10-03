#!/usr/bin/env python3
"""Fail when `claude plugin validate` output shows a tool.call hook that can match Bash.

On Claude Code 2.1.287 a mod's tool.call hook whose matcher could match Bash (no
matcher, a RegExp, or Bash itself) makes every Bash call in a worktree-isolated
subagent fail with "working-directory isolation context ... was lost". Exact tool
names, a string or an array, are safe (docs/BUILD-SPEC.md rule 7a).

Usage: claude plugin validate <dir> | scripts/worktree-safety.py
Exit 0 when every tool.call hook is safe, 1 otherwise (offenders on stderr).
"""
import re
import sys

UNSAFE_NAMES = {"Bash", "PowerShell"}
EXACT = re.compile(r"^tool\.call\{tool=([A-Za-z0-9_-]+(?:\|[A-Za-z0-9_-]+)*)\}$")


def split_hooks(line):
    """Split 'a, b{x=1,y=2}, c' on top-level ', ' only."""
    out, depth, cur = [], 0, ""
    for ch in line:
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
            continue
        cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def main():
    bad = []
    for line in sys.stdin:
        m = re.search(r"hooks: (.*)$", line)
        if not m:
            continue
        for hook in split_hooks(m.group(1)):
            if not (hook == "tool.call" or hook.startswith("tool.call{")):
                continue
            exact = EXACT.match(hook)
            if not exact or UNSAFE_NAMES & set(exact.group(1).split("|")):
                bad.append(hook)
    if bad:
        sys.stderr.write("unsafe tool.call hook(s): " + "; ".join(bad) + "\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
