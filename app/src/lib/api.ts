export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Fetch com contrato de erro único: sucesso retorna JSON tipado,
 * falha SEMPRE lança ApiError com mensagem apresentável.
 * Consumido direto e como fetcher global do SWR.
 */
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    throw new ApiError('Falha de rede. Verifique sua conexão.', 0)
  }
  if (!res.ok) {
    let message = `Erro ${res.status}. Tente novamente.`
    try {
      const body = (await res.json()) as { error?: unknown }
      if (body && typeof body.error === 'string' && body.error) message = body.error
    } catch {
      // corpo não-JSON: mantém mensagem genérica
    }
    throw new ApiError(message, res.status)
  }
  return (await res.json()) as T
}
