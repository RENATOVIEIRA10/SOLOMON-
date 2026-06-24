import { createClient } from '@supabase/supabase-js'

// Host canônico do agentes-hub (projeto zwnlpumonvkrghoxnddd no Supabase).
//
// Se createHubClient resolver a URL via fallback (MANAGED_SUPABASE_*
// ausente) e cair em outro projeto (ex: NEXT_PUBLIC_SUPABASE_URL
// apontando para o projeto produto ohmoyfbtfuznhlpjcbbk), os calls
// falham com mensagens genéricas (RLS, "relation eval_jobs does not
// exist") — exatamente o que aconteceu em prod 2026-06-23 quando
// MANAGED_SUPABASE_URL/KEY não estavam configuradas no Vercel.
//
// Este guard falha LOUD e direcionado, em vez de deixar o erro
// genérico subir até a UI como "erro ao enfileirar job".
const EXPECTED_HUB_HOST = 'zwnlpumonvkrghoxnddd.supabase.co'

export function createHubClient() {
  const url = process.env.MANAGED_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.MANAGED_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('Supabase client parameters url and key are required.')
  }

  // Validação de host por igualdade exata (nao .includes) — evita que URLs
  // tipo "https://zwnlpumonvkrghoxnddd.supabase.co.attacker.com" passem.
  let resolvedHost: string
  try {
    resolvedHost = new URL(url).host
  } catch {
    throw new Error(
      `[supabase-hub] URL invalida (${url}). Defina MANAGED_SUPABASE_URL no Vercel.`
    )
  }
  if (resolvedHost !== EXPECTED_HUB_HOST) {
    throw new Error(
      `[supabase-hub] URL ${resolvedHost} nao bate com agentes-hub esperado ` +
        `(${EXPECTED_HUB_HOST}). Provavelmente faltam MANAGED_SUPABASE_URL/KEY em prod. ` +
        `Defina MANAGED_SUPABASE_URL=https://${EXPECTED_HUB_HOST} e ` +
        `MANAGED_SUPABASE_KEY com a service_role do agentes-hub.`
    )
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  })
}
