#!/usr/bin/env bash
# Relay a prepared handoff block from docs/cmls/HANDOFF-CODEX.md to Codex.
#
# This automates the COPY, not the DECISION. It refuses on every condition the
# handoff agents refuse on, it never commits, and it never adjudicates what
# comes back. docs/GATE.md's stop point is the founder deciding what the reply
# means -- this script hands them the reply, nothing more.
#
#   tools/relay-codex.sh 1          # send section 1 (review)
#   tools/relay-codex.sh 1 --dry-run
#
set -euo pipefail

CODEX_BIN="${CODEX_BIN:-/Applications/ChatGPT.app/Contents/Resources/codex}"
REPO="$(git rev-parse --show-toplevel)"
HANDOFF="$REPO/docs/cmls/HANDOFF-CODEX.md"
LEDGER="$REPO/docs/cmls/LEDGER.md"

die() { printf '\nREFUSED: %s\n' "$*" >&2; exit 1; }

SECTION="${1:-}"
DRY_RUN=0
[ "${2:-}" = "--dry-run" ] && DRY_RUN=1
[ -n "$SECTION" ] || die "usage: tools/relay-codex.sh <section> [--dry-run]"

# ---- 1. the role lock -------------------------------------------------------
# docs/GATE.md permits one Codex role at a time. Section 1 is review, 2 is impl.
case "$SECTION" in
  1) NEED=review ;;
  2) NEED=impl ;;
  3) NEED=review ;;
  *) die "unknown section '$SECTION'. Sections are 1 (review), 2 (impl), 3 (review)." ;;
esac
LOCK="$(sed -n 's/^codex_role:[[:space:]]*//p' "$LEDGER" | sed -n 1p)"
[ -n "$LOCK" ] || die "no 'codex_role:' line in $LEDGER. The lock is the mechanism; without it nothing may be sent."
if [ "$LOCK" != "$NEED" ] && [ "$LOCK" != "none" ]; then
  die "role lock says '$LOCK', section $SECTION needs '$NEED'.
  docs/GATE.md permits one Codex role at a time, and implementation and review
  never run concurrently. Close the '$LOCK' round first."
fi

# ---- 2. the block must not be marked held ----------------------------------
HEADING="$(grep "^## $SECTION —" "$HANDOFF" | sed -n 1p)" || true
[ -n "$HEADING" ] || die "no section '## $SECTION —' in $HANDOFF"
case "$HEADING" in *"DO NOT SEND"*) die "section $SECTION is marked DO NOT SEND in $HANDOFF. It is held deliberately; read the note under it." ;; esac

# ---- 3. the branch must be pushed ------------------------------------------
# The repo is the only shared memory, and the repo means origin, not this disk.
BRANCH="$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
git -C "$REPO" rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1 \
  || die "branch '$BRANCH' has no upstream. Codex reads origin, not this disk. Push it first."
AHEAD="$(git -C "$REPO" rev-list --count '@{u}..HEAD')"
[ "$AHEAD" = "0" ] || die "branch '$BRANCH' is $AHEAD commit(s) ahead of origin. Push before relaying, or Codex reviews something it cannot fetch."
UNPUSHED="$(git -C "$REPO" log --branches --not --remotes --oneline | sed -n 1,5p)"
[ -z "$UNPUSHED" ] || printf 'note: other local branches are unpushed:\n%s\n\n' "$UNPUSHED" >&2

# ---- 4. extract the block verbatim -----------------------------------------
BLOCK="$(awk -v sec="$SECTION" '
  $0 ~ "^## " sec " —" { inseg = 1; next }
  inseg && /^## / { exit }
  inseg && /^```/ { if (infence) exit; infence = 1; next }
  infence { print }
' "$HANDOFF")"
[ -n "$BLOCK" ] || die "section $SECTION in $HANDOFF has no fenced block to send."

# ---- 5. an isolated worktree ------------------------------------------------
# Detached at HEAD: the agent cannot move anyone's branch, and ~/src/vrdct keeps
# this branch checked out untouched.
SHA="$(git -C "$REPO" rev-parse HEAD)"
WT="${RELAY_WORKTREE:-$(cd "$REPO/.." && pwd)/vrdct-relay-$SECTION}"
OUT="$WT/.relay-last-message.txt"

cat <<EOF

  section   $SECTION  ($NEED)
  lock      codex_role: $LOCK
  branch    $BRANCH @ ${SHA:0:7}  (pushed)
  worktree  $WT  (detached)
  codex     $("$CODEX_BIN" --version 2>/dev/null || echo "NOT FOUND at $CODEX_BIN")
  block     $(printf '%s' "$BLOCK" | wc -l | tr -d ' ') lines

EOF

if [ "$DRY_RUN" = "1" ]; then
  printf -- '--- block that would be sent ---\n%s\n--- end ---\n' "$BLOCK"
  echo "dry run: nothing sent."
  exit 0
fi

[ -x "$CODEX_BIN" ] || die "no codex binary at $CODEX_BIN (override with CODEX_BIN=...)"

if [ ! -d "$WT" ]; then
  git -C "$REPO" worktree add --detach "$WT" "$SHA" >/dev/null
else
  git -C "$WT" checkout --detach "$SHA" >/dev/null 2>&1
fi

# network_access is on because this specific review must re-fetch from a public
# RPC to recompute the number under test. It is stated here rather than buried
# in config so that granting it is visible in the diff.
set +e
"$CODEX_BIN" exec \
  -C "$WT" \
  -s workspace-write \
  -c sandbox_workspace_write.network_access=true \
  -o "$OUT" \
  "$BLOCK"
RC=$?
set -e

echo
echo "codex exec exited $RC"

# ---- 6. carry the artifact back, uncommitted --------------------------------
CHANGED="$(git -C "$WT" status --porcelain -- reviews/ | awk '{print $2}')"
if [ -n "$CHANGED" ]; then
  echo "$CHANGED" | while read -r f; do
    [ -n "$f" ] || continue
    mkdir -p "$REPO/$(dirname "$f")"
    cp "$WT/$f" "$REPO/$f"
    echo "  landed (uncommitted): $f"
  done
else
  echo "  no file under reviews/ was written. The reply, if any, is in $OUT"
fi

cat <<EOF

Not done by this script, deliberately:
  - nothing was committed, and nothing was pushed
  - the role lock was read, never written
  - the reply was NOT adjudicated. docs/GATE.md stops at the verdict; reading
    what Codex found and deciding what it means is the founder's call.
EOF
