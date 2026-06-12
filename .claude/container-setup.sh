#!/bin/bash
# Container setup for Claude Code sessions.
# Runs automatically via SessionStart hook. Idempotent — safe to re-run.

set -euo pipefail

# 1. Git identity (loaded from git-identity.sh)
if [[ ! -f ".claude/git-identity.sh" ]]; then
  cp ".claude/git-identity.sh.template" ".claude/git-identity.sh"
fi
source ".claude/git-identity.sh"
GIT_IDENTITY_OK=true
if [[ -z "${GIT_NAME:-}" || -z "${GIT_EMAIL:-}" ]]; then
  GIT_IDENTITY_OK=false
else
  git config --global user.name "$GIT_NAME"
  git config --global user.email "$GIT_EMAIL"
fi

# 2. Mark workspace as trusted (mounted from Windows host)
git config --global --add safe.directory /home/claude/workspace

if [[ "$GIT_IDENTITY_OK" == "false" ]]; then
  echo '{"systemMessage": "GIT_NAME and/or GIT_EMAIL not set. Commits will fail. Set them in .claude/git-identity.sh"}'
else
  echo '{"systemMessage": "Container setup complete"}'
fi
