#!/usr/bin/env bash
# claude-stop-hook-light.sh
#
# Principio: Hook nao decide produto. Hook so impede "feito sem prova".
#
# Local: app/scripts/claude-stop-hook-light.sh
# Repo: SOLOMON | branch ops/stop-hook-light | criado 2026-05-16
#
# Fluxo:
#   1. Resolve raiz do repo
#   2. Estabelece base de comparacao (origin/master | origin/main) -- FAIL se ausente
#   3. Coleta arquivos alterados (commits + working + staged + untracked)
#   4. FAIL se nada alterado (sem prova de trabalho)
#   5. Grep por padroes proibidos APENAS em arquivos de codigo executavel
#      (.ts/.js/.sh/.sql/.py/etc). Documentacao (.md, docs/) e ignorada
#      porque pode mencionar os padroes como descricao.
#   6. Diff so *.md/docs -> pula tsc/eslint/tests
#   7. tsc --noEmit em app/
#   8. eslint nos arquivos alterados em app/
#   9. Roda npm scripts phase2:azure-di:<slice>:test para slices afetadas
#   10. Imprime git status --short
#
# Exit codes: 0 PASS | 1 FAIL

set -euo pipefail

log()  { echo "[stop-hook] $*"; }
fail() { echo "[stop-hook] FAIL: $*" >&2; exit 1; }

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$REPO_ROOT" ] && fail "fora de git repo"
cd "$REPO_ROOT"

APP_DIR="$REPO_ROOT/app"
[ ! -d "$APP_DIR" ] && fail "pasta app/ ausente em $REPO_ROOT"

log "branch: $(git rev-parse --abbrev-ref HEAD)"

BASE_REF=""
if git rev-parse --verify --quiet origin/master >/dev/null 2>&1; then
  BASE_REF="origin/master"
elif git rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
  BASE_REF="origin/main"
fi
[ -z "$BASE_REF" ] && fail "sem origin/master nem origin/main como base verificavel"
log "base: $BASE_REF"

CHANGED_COMMITS="$(git diff --name-only "$BASE_REF"...HEAD 2>/dev/null || true)"
CHANGED_WORKING="$(git diff --name-only HEAD 2>/dev/null || true)"
CHANGED_STAGED="$(git diff --name-only --cached 2>/dev/null || true)"
UNTRACKED_FILES="$(git ls-files --others --exclude-standard 2>/dev/null || true)"

ALL_FILES="$(printf '%s\n%s\n%s\n%s\n' "$CHANGED_COMMITS" "$CHANGED_WORKING" "$CHANGED_STAGED" "$UNTRACKED_FILES" | sort -u | sed '/^$/d')"

[ -z "$ALL_FILES" ] && fail "nada alterado vs $BASE_REF nem no working tree -- sem prova"

log "arquivos alterados:"
echo "$ALL_FILES" | sed 's/^/  /'

# ---- Grep de padroes proibidos: APENAS em codigo executavel ----
# Documentacao (.md, docs/) e ignorada porque pode mencionar os padroes
# como descricao. O proprio aurios-status.md e esta evidencia descrevem
# os padroes.
CODE_PATHS="$(echo "$ALL_FILES" \
  | grep -vE '^docs/' \
  | grep -vE '\.md$' \
  | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|sh|bash|sql|py|rb|go|rs)$' \
  || true)"

# Padroes construidos via concatenacao para o proprio script nao casar
P1="$(printf '%s%s' 'DELETE ' 'FROM')"
P2="$(printf '%s%s' 'TRUNC' 'ATE')"
P3="$(printf '%s%s' 'DROP ' 'TABLE')"
P4="$(printf '%s%s' 'rm ' '-rf')"
FORBIDDEN="${P1}|${P2}|${P3}|${P4}"

if [ -z "$CODE_PATHS" ]; then
  log "grep proibidos: nenhum arquivo de codigo alterado -- skip"
else
  CODE_PATHS_ONELINE="$(echo "$CODE_PATHS" | tr '\n' ' ')"
  # shellcheck disable=SC2086
  DIFF_CODE_GIT="$( { \
    git diff "$BASE_REF"...HEAD -- $CODE_PATHS_ONELINE 2>/dev/null || true; \
    git diff HEAD -- $CODE_PATHS_ONELINE 2>/dev/null || true; \
    git diff --cached -- $CODE_PATHS_ONELINE 2>/dev/null || true; \
  } )"

  DIFF_CODE_UNTRACKED=""
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    [ -f "$f" ] || continue
    if echo "$UNTRACKED_FILES" | grep -qFx "$f"; then
      DIFF_CODE_UNTRACKED+="$(printf '\n+++ NEW: %s\n' "$f"; cat -- "$f" 2>/dev/null || true)"
    fi
  done <<< "$CODE_PATHS"

  DIFF_CODE="${DIFF_CODE_GIT}${DIFF_CODE_UNTRACKED}"

  if echo "$DIFF_CODE" | grep -nE "$FORBIDDEN" >/dev/null 2>&1; then
    echo "[stop-hook] FAIL: padrao proibido em codigo:" >&2
    echo "$DIFF_CODE" | grep -nE "$FORBIDDEN" | head -10 >&2
    exit 1
  fi
  log "grep proibidos: OK ($(echo "$CODE_PATHS" | grep -c .) arquivo(s) de codigo varridos)"
fi

# ---- Filtro de arquivos testaveis para tsc/eslint/tests ----
TESTABLE="$(echo "$ALL_FILES" | grep -vE '^docs/audit-runs/' | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|json|md|sh)$' || true)"

if [ -z "$TESTABLE" ]; then
  log "nenhum arquivo testavel (so audit-runs/binarios) -- liberando"
  git status --short
  log "PASS"
  exit 0
fi

NON_MD="$(echo "$TESTABLE" | grep -vE '\.md$' || true)"
if [ -z "$NON_MD" ]; then
  log "diff so *.md -- pulando tsc/eslint/tests"
  git status --short
  log "PASS"
  exit 0
fi

PHASE2_SLICES="$(echo "$TESTABLE" | grep -E '^app/scripts/phase2/' | sed -E 's|app/scripts/phase2/||; s|\.ts$||; s|\.test$||' | sort -u || true)"

ESLINT_TARGETS="$(echo "$NON_MD" | grep '^app/' | grep -E '\.(ts|tsx|js|jsx|mjs|cjs)$' | sed 's|^app/||' || true)"

cd "$APP_DIR"

log "tsc --noEmit ..."
npx --no-install tsc --noEmit
log "tsc: OK"

if [ -n "$ESLINT_TARGETS" ]; then
  log "eslint nos arquivos alterados em app/ ..."
  # shellcheck disable=SC2086
  npx --no-install eslint $ESLINT_TARGETS
  log "eslint: OK"
else
  log "nenhum arquivo .ts/.js em app/ -- eslint skip"
fi

if [ -n "$PHASE2_SLICES" ]; then
  log "slices phase2 afetadas: $(echo "$PHASE2_SLICES" | tr '\n' ' ')"
  while IFS= read -r slice; do
    [ -z "$slice" ] && continue
    base="${slice#azure-di-}"
    SCRIPT_NAME="phase2:azure-di:${base}:test"
    if npm run 2>/dev/null | grep -qE "^[[:space:]]+${SCRIPT_NAME}[[:space:]]*$"; then
      log "npm run ${SCRIPT_NAME}"
      npm run "$SCRIPT_NAME"
    else
      log "WARN: sem npm script ${SCRIPT_NAME} para slice $slice (skip)"
    fi
  done <<< "$PHASE2_SLICES"
fi

cd "$REPO_ROOT"

log "git status --short:"
git status --short

log "PASS"
exit 0
