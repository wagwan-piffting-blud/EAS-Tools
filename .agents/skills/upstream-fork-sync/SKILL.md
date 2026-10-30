---
name: upstream-fork-sync
description: Safely synchronize a fork or soft-fork with an upstream Git repository before local commits, while preserving dirty work, proving the upstream authority, classifying conflicts, and stopping before commit or push unless explicitly authorized.
---

# Upstream-to-fork synchronization

Use this skill when a repository needs to absorb current work from an upstream
remote before local changes are committed. It is provider-neutral: upstream may
be hosted on GitHub, GitLab, Forgejo, a self-hosted Git server, or another Git
transport. Use ordinary Git and the repository's configured remotes; do not
require a provider CLI.

## Authority and scope

1. Read the repository instructions and identify the repository root, current
   branch, configured remotes, and current `HEAD`.
2. Determine the intended upstream URL and branch from explicit user direction,
   repository documentation, or an existing remote. Do not guess between
   multiple plausible upstreams. Ask the human when authority, branch, or
   compatibility policy is ambiguous.
3. Resolve the remote branch's current tip with `git ls-remote` or fetch it when
   network access is authorized. Record the URL, remote branch, fetched commit,
   local `HEAD`, and ahead/behind relationship before changing the worktree.
4. Do not treat a fork's default branch, a stale tracking ref, or a similarly
   named remote as authoritative without checking its identity and current tip.

## Preserve local work

Before a merge or rebase, inspect `git status --short`, including untracked and
ignored files that could be affected. Never discard, reset, checkout-over, or
silently overwrite local work.

If the worktree is dirty, choose a reversible preservation method:

- Prefer a temporary worktree or a complete `git stash push -u` when the
  operation is authorized and the repository allows Git metadata writes.
- Verify that the preservation contains both tracked and untracked work, and
  record its identifier before fetching or merging.
- If preservation cannot be verified, stop before mutating the worktree and
  report the concrete blocker.

Generated files, dependency directories, coverage output, and ignored files are
not automatically safe to delete. Inspect them before excluding them from a
preservation step.

## Select the synchronization operation

Use the smallest operation that matches the requested history policy:

- Use `git fetch` to update remote-tracking evidence without changing the
  current branch.
- Use `git merge --no-commit --no-ff <upstream-ref>` when the fork should retain
  its history and the human wants to inspect a merge before committing.
- Use `git rebase <upstream-ref>` only when the human explicitly requests a
  rewritten fork history and all local commits are safe to replay.
- If the upstream tip is already an ancestor of `HEAD`, report that no merge is
  needed. If `HEAD` is an ancestor of upstream, a fast-forward may be suitable;
  preserve the requested no-commit inspection boundary when one was specified.

Do not use `git reset --hard`, `git clean`, force pushes, or automated conflict
resolution as synchronization shortcuts. Do not create a merge commit, push,
tag, release, or pull request unless the human explicitly authorizes that exact
action.

## Restore and classify

After the upstream operation, restore preserved local work and inspect:

- `git status` and the merge/rebase state;
- staged upstream result versus unstaged local work;
- conflicts and conflict markers;
- changed files, generated artifacts, and source-of-truth boundaries;
- whether any conflict changes behavior, compatibility, protocol output, UI,
  or documentation.

Resolve only conflicts whose intended result is established by repository
instructions, current source-of-truth files, and the user's requested scope.
Otherwise stop with the conflict preserved and ask for Human-in-the-Loop
direction. Never declare a conflict resolved merely because the file parses.

## Validate the combined tree

Run the repository's narrowest relevant checks, then its required quality gate.
At minimum, run formatting/diff checks and the tests applicable to files touched
by either side. For this repository, use `make quality` after upstream changes
that affect application code, generated artifacts, documentation, or skills.
Report upstream-only changes, local-only changes, conflict resolutions, exact
checks, warnings, and anything not validated.

Automated checks demonstrate that the combined tree is reviewable; they do not
constitute human acceptance. Ask for Human-in-the-Loop review when upstream
behavior conflicts with product intent, a protocol or external compatibility
baseline is uncertain, or the next action would be externally visible.

## Handoff

State clearly:

- upstream URL, branch, fetched commit, and local base;
- whether the operation was fetch-only, merge-in-progress, completed merge, or
  rebase;
- whether a commit or push occurred (normally: no);
- preservation method and restoration status;
- conflicts and their evidence-based disposition;
- validation results and the exact human decision still required.
