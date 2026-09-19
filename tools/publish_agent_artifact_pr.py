#!/usr/bin/env python3
"""Publish the built openmausbot-launcher payload to the agent-skills repo as a pull request.

Reads agent-artifacts.json, (re)builds the payload, copies it into a checkout of
the target repo at the configured `target_path`, upserts this skill's own entry
into the target README from `readme_entry`, and opens a PR with `gh`.
It never merges. With --dry-run it builds and prints exactly what it would do
and makes no network calls.

The registry README is SHARED with other people's skills: only this skill's bullet
and its `#### <name> Use Case` block are ever written: see merge_skill_into_readme.

    python3 tools/publish_agent_artifact_pr.py --dry-run          # safe preview (no network)
    python3 tools/publish_agent_artifact_pr.py --skill NAME       # open a real PR (needs gh auth)
    python3 tools/publish_agent_artifact_pr.py --checkout DIR     # reuse an existing local clone

Guardrails: opens a PR but never merges; exits without a PR when the payload is
byte-identical to what's already published; requires an authenticated `gh`.
Run only with the user's explicit go-ahead.
"""
import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "agent-artifacts.json")
PACKAGE_JSON = os.path.join(ROOT, "package.json")


def version():
    """The release version: package.json's `version` (the SKILL.md metadata carries the same value; a test pins that)."""
    with open(PACKAGE_JSON, encoding="utf-8") as fh:
        return json.load(fh)["version"]


def log(*a):
    print("[publish]", *a, flush=True)


def run(cmd, cwd=ROOT, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check)


def load_artifacts(skill):
    if not os.path.exists(MANIFEST):
        sys.exit("error: %s not found" % MANIFEST)
    with open(MANIFEST, encoding="utf-8") as fh:
        arts = json.load(fh).get("artifacts", [])
    if skill:
        arts = [a for a in arts if a["name"] == skill]
        if not arts:
            sys.exit("error: skill %r not in manifest" % skill)
    if not arts:
        sys.exit("error: no artifacts in manifest")
    return arts


def list_files(root):
    return sorted(os.path.relpath(os.path.join(base, f), root)
                  for base, _, files in os.walk(root) for f in files)


def copy_payload(src_dir, dst_dir):
    """Replace dst_dir's contents with src_dir's (a clean publish, no stale files)."""
    if os.path.exists(dst_dir):
        shutil.rmtree(dst_dir)
    os.makedirs(os.path.dirname(dst_dir) or ".", exist_ok=True)
    shutil.copytree(src_dir, dst_dir)


def read_readme_entry(a):
    """Return the markdown of this skill's target-README entry, or None."""
    rel = a.get("readme_entry")
    if not rel:
        return None
    path = os.path.join(ROOT, rel)
    if not os.path.isfile(path):
        sys.exit("error: readme_entry not found: %s" % path)
    with open(path, encoding="utf-8") as fh:
        return fh.read().rstrip("\n") + "\n"


def _usecase_heading(name):
    return "#### %s Use Case" % name


def _block_end(lines, start, stops):
    """Index just past the block beginning at `start`, i.e. the next line starting with
    any of `stops` (or end of list). Trailing blank lines are left out of the block."""
    end = next((i for i in range(start + 1, len(lines))
                if any(lines[i].startswith(s) for s in stops)), len(lines))
    while end > start + 1 and not lines[end - 1].strip():
        end -= 1
    return end


def parse_readme_entry(entry_md, name):
    """Split this skill's entry file into (bullet_line, usecase_block).

    The entry keeps the target README's full shape ('## Skills' + bullet + '### Use Case'
    + '#### <name> Use Case'); only those two pieces are ever written to the target, so a
    shared registry README keeps every other skill's content.
    """
    lines = entry_md.splitlines(keepends=True)
    bullet = next((ln for ln in lines if ln.startswith("- [%s]" % name)), None)
    if bullet is None:
        sys.exit("error: readme_entry has no '- [%s](...)' bullet" % name)
    head = _usecase_heading(name)
    start = next((i for i, ln in enumerate(lines) if ln.strip() == head), None)
    if start is None:
        sys.exit("error: readme_entry has no '%s' heading" % head)
    end = _block_end(lines, start, ("#### ", "### ", "## "))
    return bullet, lines[start:end]


def merge_skill_into_readme(readme_path, name, entry_md):
    """Upsert ONLY this skill's bullet and its '#### <name> Use Case' block into the
    target README's '## Skills' section. Every other skill's bullet and block is left
    byte-identical -- the registry README is shared. Idempotent."""
    bullet, usecase = parse_readme_entry(entry_md, name)
    with open(readme_path, encoding="utf-8") as fh:
        lines = fh.readlines()

    start = next((i for i, ln in enumerate(lines) if ln.strip() == "## Skills"), None)
    if start is None:
        sys.exit("error: target README has no '## Skills' section to fill in")
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")),
               len(lines))
    section = lines[start:end]

    # 1. the bullet: replace ours in place, else append after the last bullet
    ours = next((i for i, ln in enumerate(section) if ln.startswith("- [%s]" % name)), None)
    if ours is not None:
        section[ours] = bullet
    else:
        last = max((i for i, ln in enumerate(section) if ln.startswith("- [")), default=0)
        section.insert(last + 1, bullet)

    # 2. the use case: replace our block in place, else append to '### Use Case'
    head = _usecase_heading(name)
    ours = next((i for i, ln in enumerate(section) if ln.strip() == head), None)
    if ours is not None:
        section[ours:_block_end(section, ours, ("#### ", "## "))] = usecase
    else:
        if not any(ln.strip() == "### Use Case" for ln in section):
            section += ["\n", "### Use Case\n"]
        while section and not section[-1].strip():
            section.pop()
        section += ["\n"] + usecase

    while section and not section[-1].strip():          # exactly one blank line before
        section.pop()                                   # whatever section follows
    with open(readme_path, "w", encoding="utf-8") as fh:
        fh.writelines(lines[:start] + section + (["\n"] + lines[end:] if end < len(lines) else []))


def publish(a, args):
    name = a["name"]
    build_command = a["build_command"]
    source_path = os.path.join(ROOT, a["source_path"])
    target_repo = a.get("target_repo")
    target_path = a["target_path"]
    base = args.base or a.get("base_branch", "main")

    log("== %s ==" % name)
    if not target_repo:
        sys.exit("error: target_repo not set for %r in agent-artifacts.json "
                 "(add the agent-skills URL and re-run)" % name)

    log("build:", build_command)
    run(shlex.split(build_command))
    if not os.path.isdir(source_path):
        sys.exit("error: build did not produce %s" % source_path)
    files = list_files(source_path)
    section = read_readme_entry(a)

    if args.dry_run:
        log("DRY RUN — no network calls, no PR")
        log("would publish %d file(s) to %s (base %s) at path %r:"
            % (len(files), target_repo, base, target_path))
        for f in files:
            print("    %s/%s" % (target_path.rstrip("/"), f))
        if section:
            bullet, usecase = parse_readme_entry(section, name)
            log("would upsert ONLY this skill's bullet and use-case block into the "
                "target README (every other skill left untouched):")
            print("\n" + bullet + "\n" + "".join(usecase))
        log("plan: clone -> branch off %s -> copy payload -> update README "
            "-> commit -> push -> gh pr create  (never merges)" % base)
        return

    if not shutil.which("gh"):
        sys.exit("error: `gh` not on PATH; install it and run `gh auth login` first")
    if subprocess.run(["gh", "auth", "status"], capture_output=True).returncode != 0:
        sys.exit("error: `gh` is not authenticated; run `gh auth login` first")

    tmp = None
    try:
        if args.checkout:
            checkout = os.path.abspath(args.checkout)
            if not os.path.isdir(os.path.join(checkout, ".git")):
                sys.exit("error: --checkout %s is not a git repo" % checkout)
        else:
            tmp = tempfile.mkdtemp(prefix="publish-%s-" % name)
            checkout = os.path.join(tmp, "repo")
            log("cloning", target_repo)
            run(["git", "clone", "--depth", "1", "--branch", base, target_repo, checkout],
                cwd=None)

        ver = version()
        branch = "publish/%s-%s" % (name, ver)
        run(["git", "checkout", "-b", branch], cwd=checkout)
        copy_payload(source_path, os.path.join(checkout, target_path))
        if section:
            merge_skill_into_readme(os.path.join(checkout, "README.md"), name, section)
        run(["git", "add", "-A"], cwd=checkout)
        if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=checkout).returncode == 0:
            log("no changes vs. the published version — skipping PR")
            return
        title = "Publish %s %s" % (name, ver)
        body = ("Payload for the `%s` skill, version %s, built from "
                "https://github.com/WSH95/openmausbot-launcher with `%s`; the README gains this "
                "skill's bullet and use-case block and nothing else changes.\n\n"
                "Do not merge without review." % (name, ver, build_command))
        run(["git", "commit", "-m", title], cwd=checkout)
        run(["git", "push", "-u", "origin", branch], cwd=checkout)
        run(["gh", "pr", "create", "--repo", target_repo, "--base", base,
             "--head", branch, "--title", title, "--body", body], cwd=checkout)
        log("PR opened (not merged).")
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(
        description="Publish built skill payload(s) as a PR to the agent-skills repo.")
    ap.add_argument("--skill", help="publish only this skill (default: all)")
    ap.add_argument("--dry-run", action="store_true",
                    help="build and print the plan; no network, no PR")
    ap.add_argument("--checkout",
                    help="use an existing local clone of the target repo instead of cloning")
    ap.add_argument("--base", help="override the base branch")
    args = ap.parse_args()
    for a in load_artifacts(args.skill):
        publish(a, args)


if __name__ == "__main__":
    main()
