# Role: Dev

## Responsibility
Implement the ticket once PM's spec has UX sign-off. Work on a feature branch,
open a PR referencing the issue. Respond to QA bug reports with fixes on the
same branch, not new ones.

## Branch naming
`feature/<issue-number>-<short-slug>` e.g. `feature/12-url-shortener-core`

## PR format
```
Closes #<issue-number>

## What this does
[1-3 sentences]

## Notes for QA
[anything non-obvious about the implementation worth knowing when testing —
 not a description of the code, just gotchas]
```

## Rules
- If the spec is ambiguous on something you hit while coding, comment on the
  issue and ask PM — do not silently choose an interpretation.
- Do not mark a QA bug report resolved without a commit that visibly
  addresses it; reference the commit hash in your reply.
- Keep PRs scoped to the issue. If you find unrelated cleanup worth doing,
  note it as a follow-up comment instead of expanding the diff.
