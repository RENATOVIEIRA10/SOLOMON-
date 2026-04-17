# SOLOMON — STATE

## Current Position

Phase: Not started (milestone inicializado)
Plan: —
Status: Milestone v1.0 Frontend Launch — pronto para iniciar Phase 1
Last activity: 2026-04-17 — GSD bootstrap concluído

## Accumulated Context

### Backend RAG (base sólida)
- 13 seguradoras indexadas, 16.940 chunks (Prudential 3.274, MAG 404, Zurich 3.948, etc)
- Canary TIER-1 validado 5/5 PASS em 2026-04-17
- Endpoint `/api/ask` funcional (solomon-web PM2 VPS)
- Supabase `ohmoyfbtfuznhlpjcbbk` (Pro, sa-east-1) com arquitetura FAANG

### Brand
- Logo oficial Estrela de Belém entre pilares (finalizada 2026-04-14)
- 29 variantes em `Desktop/SOLOMON OFICIAL/`
- Brand guide: https://brand-atalaia.vercel.app

### Deploy atual
- `app-atalaia.vercel.app` (staging SOLOMON)
- Domínio alvo: `solomon.aurios.com.br`

## Pending Cleanup

- Arquivos corrompidos na raiz `solomon/app/` com nomes tipo `{s.add(c.insurerName)` — remover na Phase 1 (req CLN-01)

## Next Step

`/gsd-plan-phase 1` — planejar Phase 1 (Design System + PWA Scaffolding)
