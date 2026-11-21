# Preparing the portfolio repository

The original history contains an AWS deployment workflow, deployment host and path references, and historical organization branding. The current demo uses Workers and D1 and has a verification-only CI workflow. Keep the existing checkout and its Git history private. Create a fresh history from reviewed source files when publication is approved.

## Review findings

- The local object store had one commit and two dangling trees. The audit inspected all 275 stored blobs, including unreachable objects. It checked for recognizable private keys and token formats, credential-bearing URLs, unusual email domains, personal workstation paths, organization names and cloud deployment references. No live credentials or real employee records were identified in the inspected source and fixture files.
- The AWS workflow and operations details were confined to the original history. Earlier branding assets also survive there. The current D1 fixture uses fictional employees and reserved email addresses. The original Node/PostgreSQL seed contains only reference departments and leave types. The optional local demo credential seeder emits credentials to ignored files.
- Keep local environment files, Wrangler state and generated staging configuration, build output, uploaded images, sample exports, database copies, backups, screenshots of real systems and the old `IMPORT_FIXES_HANDOFF.md` out of the public snapshot. Review source ownership and publication rights before selecting a license.

## Build a clean snapshot

From the private checkout, make a file list and review every entry. The list includes tracked changes and new source files, including the new D1 migrations. The filter omits the old internal handoff. This procedure creates no remote repository.

```sh
publication=$(mktemp -d)
git ls-files --cached --others --exclude-standard -z |
  while IFS= read -r -d '' source_file; do
    if [ -f "$source_file" ] && [ "$source_file" != IMPORT_FIXES_HANDOFF.md ]; then
      printf '%s\0' "$source_file"
    fi
  done > "$publication/manifest"
tr '\0' '\n' < "$publication/manifest"

mkdir "$publication/source"
tar -c -f - --null -T "$publication/manifest" | tar -x -f - -C "$publication/source"
cd "$publication/source"
git init -b main
git add --all
git diff --cached --check
git diff --cached --stat
git ls-files
```

Review the actual snapshot, run the tests from the new directory with fresh local configuration, and run a secret scan on the index and new history. Confirm the only CI workflow runs checks and a Wrangler dry run. Create the initial portfolio commit only after reviewing the staged files. Verify the new repository contains a single clean root commit and has no inherited branches, tags, remotes or Git objects. After public publication is approved, create a new empty GitHub repository and push only this new `main`. Enable secret scanning and push protection where available. [GitHub secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning)
