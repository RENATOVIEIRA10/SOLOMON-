# Stop Hook Light — Setup Evidence

**Data:** 2026-05-16
**Branch:** `ops/stop-hook-light`
**Issue:** #36 (Ops backlog: Claude Code autonomous workflow rollout)
**Repo:** SOLOMON (`/root/solomon/repo`)
**Operador:** Claude Opus 4.7 via SSH desde notebook

---

## Princípio

> Hook nao decide produto. Hook so impede "feito sem prova".

Ou seja: o hook não substitui o call de CEO. Apenas força Claude a trazer evidência limpa (tsc + eslint + grep de padrões proibidos) antes de finalizar um turno e pedir decisão.

---

## Escopo desta PR

**In scope:**
- `app/scripts/claude-stop-hook-light.sh` (137 linhas)
- `.claude/settings.json` local do repo, registrando hook no evento `Stop`
- Esta evidência em `docs/audit-runs/2026-05-16-stop-hook-light-setup.md`
- Linha mínima no `.claude/aurios-status.md` registrando o ciclo

**Out of scope (deliberado):**
- `/schedule`, `/loop`, Auto Mode amplo
- Heavy hook (suite completa Phase 2 + smoke)
- Templates `/goal` globais
- Expansão para outros repos (REVELA, ATALAIA, etc)
- Alterações em código de produção da Phase 2
- Mudanças em `.claude/settings.json` global do Claude Code

---

## Comportamento do hook

1. Resolve raiz do repo via `git rev-parse --show-toplevel` (FAIL se fora de git)
2. Estabelece base de comparação: `origin/master` ou `origin/main` (FAIL se nenhuma)
3. Coleta arquivos alterados: `git diff` (commits + working + staged) + `git ls-files --others --exclude-standard` (untracked)
4. **Fail-closed:** se ALL_FILES vazio → FAIL "sem prova de trabalho"
5. Concatena diff content + cat dos untracked
6. Grep por padrões proibidos (`DELETE FROM`, `TRUNCATE`, `DROP TABLE`, `rm -rf`) **APENAS em arquivos de código executável** (`.ts|.tsx|.js|.jsx|.mjs|.cjs|.sh|.bash|.sql|.py|.rb|.go|.rs`)
   - Padrões construídos via `printf '%s%s'` para o próprio script não casar com seu match
   - Documentação (`.md`, `docs/`) é ignorada deliberadamente: relatórios em `docs/audit-runs/` e governança em `.claude/aurios-status.md` podem mencionar os padrões como descrição, não como execução
7. Filtra arquivos testáveis: exclui `docs/audit-runs/`, filtra por extensão (`.ts|.tsx|.js|.jsx|.mjs|.cjs|.json|.md|.sh`)
8. Se diff só `*.md` → pula tsc/eslint/tests, libera
9. `tsc --noEmit` em `app/` (full project)
10. eslint apenas nos arquivos alterados em `app/` (não full)
11. Para cada slice `app/scripts/phase2/<X>` alterada, roda `npm run phase2:azure-di:<base>:test` se existir
12. Imprime `git status --short` ao final
13. Exit `0` (PASS) ou `1` (FAIL)

---

## Validações executadas

### V1 — Bloqueio sintético

**Setup:** worktree isolado em `/tmp/solomon-hook-test` baseado em `origin/master`, script copiado, payload sintético criado.

**Payload:**
```sql
-- payload sintetico para validar stop-hook
TRUNCATE TABLE users;
```

**Comando:** `bash app/scripts/claude-stop-hook-light.sh`

**Resultado:**
```
[stop-hook] branch: HEAD
[stop-hook] base: origin/master
[stop-hook] arquivos alterados:
  app/scripts/claude-stop-hook-light.sh
  test-payload.sql
[stop-hook] FAIL: padrao proibido no diff:
142:TRUNCATE TABLE users;
EXIT: 1
```

**Veredicto:** ✅ PASS — hook detectou `TRUNCATE TABLE` no diff e falhou com exit 1 antes de prosseguir para tsc/eslint.

**Cleanup:** `rm test-payload.sql` + `git worktree remove --force /tmp/solomon-hook-test`. Branch sintética não foi criada (worktree detached HEAD descartado).

### V2 — Liberação real

**Setup:** branch `ops/stop-hook-light` no repo principal, com:
- 2 arquivos novos da PR (script + settings) untracked
- Audit-runs antigos da slice 3B.7.1 untracked (não-removidos deliberadamente, são evidência de outra branch)

**Comando:** `bash app/scripts/claude-stop-hook-light.sh`

**Resultado abreviado:**
```
[stop-hook] branch: ops/stop-hook-light
[stop-hook] base: origin/master
[stop-hook] arquivos alterados: <100+ paths incluindo script, settings, audit-runs>
[stop-hook] grep proibidos: OK
[stop-hook] tsc --noEmit ...
[stop-hook] tsc: OK
[stop-hook] nenhum arquivo .ts/.js em app/ -- eslint skip
[stop-hook] git status --short:
?? .claude/settings.json
?? app/scripts/claude-stop-hook-light.sh
?? <audit-runs antigos>
[stop-hook] PASS
EXIT: 0
```

**Veredicto:** ✅ PASS — hook liberou em estado limpo, tsc passou full project, eslint sem alvos (nada `.ts/.js` em app/ alterado), grep proibidos limpo. Audit-runs antigos contendo SQL em relatórios foram automaticamente ignorados pelo filtro de código-apenas.

### Iteração observada — filtro inicial era frágil

Primeira versão do script construía o diff content concatenando todos os untracked exceto `docs/audit-runs/`. Resultado: quando `evidence.md` e `aurios-status.md` foram criados nesta PR (contendo os padrões proibidos como descrição em prosa), o hook bloqueou em V2 com `TRUNCATE TABLE no diff -> exit 1` apontando para texto descritivo no aurios-status.

Correção aplicada antes deste setup ficar pronto:
- O grep proibido agora roda **apenas em arquivos de código executável** filtrados por extensão
- Markdown e qualquer coisa sob `docs/` são excluídos do scan de padrões
- `tsc` / `eslint` / npm test continuam rodando normalmente nos arquivos relevantes

Aprendizado: hooks que escaneiam padrões em "diff" devem distinguir código executável de documentação, senão a própria evidência do hook bloqueia o hook.

---

## Limitações conhecidas

1. **tsc full project** — sempre roda o type check completo de `app/`. Para repos grandes pode demorar (medido ~10-20s neste caso). Não é "light" no sentido literal, mas é necessário porque tsc não suporta type check parcial sem perder integridade.

2. **eslint apenas arquivos alterados** — não roda full project para velocidade. Trade-off aceito: regressões eslint em arquivos não tocados nesta PR não são detectadas.

3. **Padrões proibidos hardcoded** — grep por `DELETE FROM | TRUNCATE | DROP TABLE | rm -rf` cobre 4 vetores mais comuns. Não cobre: `git reset --hard`, `git push --force`, `--no-verify`, `chmod 777`, etc. Expansão é heavy hook (out of scope desta PR).

4. **Sem cache** — toda execução roda tsc do zero. Tsc tem `incremental: true` no `tsconfig.json` do `app/`, então segunda execução é mais rápida.

5. **Untracked content scan** — `cat untracked` pode ser lento se houver arquivos binários grandes. Filtro por extensão minimiza, mas não elimina.

6. **Sem branch test/ persistente** — validação V1 usou worktree detached + cleanup. Não há branch `test/stop-hook-validation` em remote nem no repo local.

---

## Riscos

| Risco | Mitigação |
|-------|-----------|
| Hook bloqueia turno legítimo do CEO por padrão proibido em comentário | Padrões são SQL/shell reais; comentário em código TS/JS dificilmente casa |
| tsc demora demais e Claude desiste do hook | tsconfig tem `incremental: true`; medido ~15s |
| Script tem bug que não cobrimos nestes 2 testes | Testes V1+V2 cobrem caminhos críticos; expansão fica para slice futura se observarmos drift |
| Hook depende de `origin/master` estar fetched | Falha clara se ausente (FAIL "sem origin/master nem origin/main") |
| Conflito com hook global em `~/.claude/settings.json` | Settings local do repo tem precedência conforme Claude Code docs |

---

## Próximos passos sugeridos (fora desta PR)

1. **Usar em 1 slice real Phase 2** — esperar próximo trabalho do CEO em alguma slice phase2 e ver se o hook reduz risco sem atrapalhar velocidade
2. Se aceito após 3+ uses reais: expandir para REVELA, ATALAIA, aurios-agents-workspace
3. Heavy hook (full suite Phase 2 + smoke) — só se houver evidência de que light não pega regressões reais
4. `/goal` templates — só após hook validado em 3+ slices

---

## Commits

Único commit final (squash mental — implementado como commit único):
- `feat(ops): stop-hook light + settings + evidence`

PR pequena, escopo restrito, sem mudança em código de produção.
