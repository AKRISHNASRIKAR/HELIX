#!/usr/bin/env bash
# Shared bootstrap + task runner for every Python package (services/*, agents/*,
# analytics/*, packages/contracts-py). Called from the package's own package.json
# scripts so turbo can orchestrate Python and Node workspaces uniformly.
#
# Usage (run from inside the package directory): python-run.sh <dev|lint|test|typecheck>
set -euo pipefail

CMD="${1:-dev}"
PYTHON_BIN="${HELIX_PYTHON:-python3.12}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# turbo runs lint and test of the same package in parallel; only one of them
# may touch .venv at a time, so installs happen under a per-package lock.
LOCK_DIR=".venv.lock"
until mkdir "$LOCK_DIR" 2>/dev/null; do sleep 0.2; done
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

if [ ! -d .venv ]; then
  "$PYTHON_BIN" -m venv .venv
fi

# Skip pip entirely when nothing that decides the install set has changed: this
# package's requirements and pyproject, the shared dev requirements, and the
# pyproject of every editable sibling it installs (-e ../../...).
stamp_inputs() {
  local files=(requirements.txt pyproject.toml "$ROOT_DIR/requirements-dev.txt")
  if [ -f requirements.txt ]; then
    while read -r path; do files+=("$path/pyproject.toml"); done \
      < <(sed -n 's/^-e[[:space:]]*//p' requirements.txt)
  fi
  for f in "${files[@]}"; do
    [ -f "$f" ] && { echo "$f"; cat "$f"; }
  done
}
STAMP="$(stamp_inputs | shasum | cut -d' ' -f1)"
if [ "$(cat .venv/.helix-stamp 2>/dev/null || true)" != "$STAMP" ]; then
  .venv/bin/pip install --upgrade pip -q
  if [ -f requirements.txt ]; then
    .venv/bin/pip install -r requirements.txt -q
  fi
  if [ -f "$ROOT_DIR/requirements-dev.txt" ]; then
    .venv/bin/pip install -r "$ROOT_DIR/requirements-dev.txt" -q
  fi
  if [ -f pyproject.toml ]; then
    .venv/bin/pip install -e . -q
  fi
  echo "$STAMP" > .venv/.helix-stamp
fi
rmdir "$LOCK_DIR" 2>/dev/null || true
trap - EXIT

case "$CMD" in
  dev)
    exec .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port "${SERVICE_PORT:-8000}"
    ;;
  lint)
    exec .venv/bin/ruff check .
    ;;
  test)
    exec .venv/bin/pytest
    ;;
  typecheck)
    echo "No static type checker configured yet for this package."
    ;;
  *)
    echo "Unknown command: $CMD" >&2
    exit 1
    ;;
esac
