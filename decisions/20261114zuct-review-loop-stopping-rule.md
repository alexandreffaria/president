---
id: "20261114zuct"
title: When should a pull request's review loop stop?
status: resolved
kind: choice
priority: normal
created: 2026-11-14T03:00:52Z
created_by: claude-code (reflection)
tags: [process, review]
depends_on: []
recommendation:
  option: no-should-fix
  why: >-
    Late rounds were mostly nits; this drops those rounds but still re-reviews every bug or
    regression a fix adds. Pick cap-3 if review time matters more than any remaining
    should-fix.
options:
  - id: all
    title: Until every finding is fixed (as now)
    summary: Every finding, nits included, is fixed and reviewed again.
    pros:
      - Highest polish
    cons:
      - PR 1 took 11 rounds over about 11 hours
  - id: no-should-fix
    title: Until nothing should-fix is left
    summary: >-
      Bugs and should-fix findings are fixed and reviewed again; nits are fixed once without
      another round, or listed in the pull request.
    pros:
      - Skips nit-only rounds (3 of PR 1's 11)
    cons:
      - Small nits may ship
  - id: cap-3
    title: At most 3 rounds
    summary: After round 3 I merge if nothing is a bug, and tell you what was left.
    pros:
      - Cost is bounded
    cons:
      - May merge a known should-fix
resolution:
  choice: all
  resolved_at: 2026-11-14T03:19:37Z
---

## Context

About 41% of president's 337 commits fix review findings. Each round reruns about 90 seconds
of tests plus a fresh reviewer.
