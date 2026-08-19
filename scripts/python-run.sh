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

if [ ! -d .venv ]; then
  "$PYTHON_BIN" -m venv .venv
fi

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
