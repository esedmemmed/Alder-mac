#!/usr/bin/env bash
# Build the `public` branch from allow-listed paths in HEAD. Touches neither the
# worktree nor main, and never pushes: it prints the push command.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Only these paths go public. Anything new stays private until it is added here.
ALLOW=(.gitattributes .github LICENSE README.md air docs/air mac scripts/publish.sh)

mkdir -p .run/1.1
export GIT_INDEX_FILE=.run/1.1/publish.index
trap 'rm -f "$GIT_INDEX_FILE" "$GIT_INDEX_FILE.lock"' EXIT

git read-tree --empty
git ls-tree -r HEAD -- "${ALLOW[@]}" | git update-index --index-info
tree=$(git write-tree)
short=$(git rev-parse --short HEAD)

if parent=$(git rev-parse -q --verify refs/heads/public); then
  if [ "$(git rev-parse "$parent^{tree}")" = "$tree" ]; then
    echo "public already matches $short; nothing new to publish."
  else
    commit=$(git commit-tree "$tree" -p "$parent" -m "Publish $short")
    git update-ref refs/heads/public "$commit" "$parent"
    echo "public is now $(git rev-parse --short "$commit"), from main $short."
  fi
else
  # First publish: no parent yet, so this is the root commit of public.
  commit=$(git commit-tree "$tree" -m "Publish $short")
  git update-ref refs/heads/public "$commit" ""
  echo "public created at $(git rev-parse --short "$commit"), from main $short."
fi

echo "To push: git push origin public:main"
