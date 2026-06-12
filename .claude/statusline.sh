#!/bin/bash
input=$(cat)

MODEL=$(jq -r '.model.display_name' <<< "$input")
PCT=$(jq -r '.context_window.used_percentage // 0 | tostring | split(".")[0]' <<< "$input")
DURATION_MS=$(jq -r '.cost.total_duration_ms // 0' <<< "$input")
COST_CC=$(jq -r '.cost.total_cost_usd // 0' <<< "$input")

TODAY=$(date "+%Y-%m-%d")
if [[ -n "$ANTHROPIC_AUTH_TOKEN" && -n "$ANTHROPIC_BASE_URL" ]]; then
    ACT=$(curl -sf --max-time 3 \
        "${ANTHROPIC_BASE_URL%/}/user/daily/activity?start_date=${TODAY}&end_date=${TODAY}&page=1&page_size=50" \
        -H "x-litellm-api-key: ${ANTHROPIC_AUTH_TOKEN}" 2>/dev/null)
    COST=$(jq -r '[.results[] | .metrics.spend // 0] | add // 0' <<< "$ACT" 2>/dev/null)
    [[ -z "$COST" || "$COST" == "null" ]] && COST=0
    COST_LABEL="today"
else
    COST="$COST_CC"
    COST_LABEL="session"
fi

CYAN='\033[36m'; GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; ORANGE='\033[38;5;208m'; RESET='\033[0m'

if [ "$PCT" -ge 90 ]; then BAR_COLOR="$RED"
elif [ "$PCT" -ge 70 ]; then BAR_COLOR="$YELLOW"
else BAR_COLOR="$GREEN"; fi

FILLED=$((PCT / 10)); EMPTY=$((10 - FILLED))
printf -v FILL "%${FILLED}s"; printf -v PAD "%${EMPTY}s"
BAR="${FILL// /█}${PAD// /░}"

MINS=$((DURATION_MS / 60000)); SECS=$(((DURATION_MS % 60000) / 1000))

BRANCH=""
git rev-parse --git-dir > /dev/null 2>&1 && BRANCH=" | ${ORANGE}⎇${RESET} $(git branch --show-current 2>/dev/null)"

REPO=$(git remote get-url origin 2>/dev/null | sed 's/.*\///;s/\.git$//')
[[ -z "$REPO" && -f ".claude/reponame" ]] && read -r REPO < .claude/reponame
[[ -z "$REPO" ]] && REPO="⚠ set .claude/reponame or git remote"

CAVEMAN=""
CAVEMAN_FLAG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.caveman-active"
if [[ -f "$CAVEMAN_FLAG" && ! -L "$CAVEMAN_FLAG" ]]; then
    CM=$(head -c 64 "$CAVEMAN_FLAG" 2>/dev/null | tr -cd 'a-z0-9-')
    case "$CM" in
        off|"") ;;
        full)   CAVEMAN=" \033[38;5;172m[CAVEMAN]\033[0m" ;;
        *)      CAVEMAN=" \033[38;5;172m[CAVEMAN:${CM^^}]\033[0m" ;;
    esac
fi

COST_FMT=$(printf '$%.2f' "$COST")
echo -e "${CYAN}[$MODEL]${RESET} 📁 ${REPO}$BRANCH${CAVEMAN}"
echo -e "${BAR_COLOR}${BAR}${RESET} ${PCT}% | ${COST_LABEL} ${YELLOW}${COST_FMT}${RESET} | ⏱️ ${MINS}m ${SECS}s"
