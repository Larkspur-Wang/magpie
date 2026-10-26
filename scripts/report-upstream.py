#!/usr/bin/env python3
"""Compare refs without checking out or merging into the user's worktree."""
import argparse
import json
from pathlib import Path
import subprocess


def git(*args):
    return subprocess.check_output(["git", *args]).decode().strip()


def compare(base, upstream):
    before = git("status", "--porcelain=v1", "-z")
    head = git("rev-parse", "--verify", base + "^{commit}")
    target = git("rev-parse", "--verify", upstream + "^{commit}")
    missing = int(git("rev-list", "--count", head + ".." + target))
    merged = subprocess.run(["git", "merge-tree", "--write-tree", "--name-only",
                             "--no-messages", "-z", head, target], capture_output=True)
    if merged.returncode not in (0, 1):
        raise RuntimeError(merged.stderr.decode(errors="replace"))
    fields = merged.stdout.decode().split("\0")
    if len(fields[0]) != 40:
        raise RuntimeError("merge-tree returned no tree; comparison is unknown")
    conflicts = [entry for entry in fields[1:] if entry]
    if bool(conflicts) != (merged.returncode == 1):
        raise RuntimeError("merge-tree conflict result is inconsistent")
    if before != git("status", "--porcelain=v1", "-z"):
        raise RuntimeError("worktree changed during comparison")
    return {"head": head, "upstream": target, "missing": missing,
            "conflicts": conflicts, "worktreeUnchanged": True,
            "commits": git("log", "--max-count=60", "--format=- `%h` %s", head + ".." + target)}


def markdown(result):
    status = ("Conflicts: " + ", ".join("`" + p + "`" for p in result["conflicts"])) if result["conflicts"] else "Trial merge applies cleanly."
    return ("# Upstream updates\n\n"
            f'Product: `{result["head"]}`\n\nUpstream: `{result["upstream"]}`\n\n'
            f'**{result["missing"]}** upstream commits not yet absorbed. {status}\n\n'
            "This report changes no product files, installed app, accounts or routes. "
            "A clean trial merge is not test or release acceptance.\n\n"
            "Review and test in an isolated worktree before merging; never auto-install.\n\n"
            "<details><summary>Recent upstream commits (at most 60)</summary>\n\n"
            + result["commits"] + "\n\n</details>\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="HEAD")
    parser.add_argument("--upstream", default="upstream/main")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = compare(args.base, args.upstream)
    args.output.write_text(markdown(result))
    args.output.with_suffix(".json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: v for k, v in result.items() if k != "commits"}))
