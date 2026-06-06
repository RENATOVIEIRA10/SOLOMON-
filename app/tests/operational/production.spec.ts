import { expect, test, type APIRequestContext } from '@playwright/test'

const protectedPages = [
  '/app',
  '/chat',
  '/clientes',
  '/comparador',
  '/base',
  '/alertas',
  '/perfil',
  '/pre-sinistro',
]

const protectedApis: Array<{
  name: string
  request: (request: APIRequestContext) => ReturnType<APIRequestContext['get']>
}> = [
  {
    name: 'profile',
    request: (request) => request.get('/api/profile'),
  },
  {
    name: 'knowledge search',
    request: (request) => request.get('/api/knowledge/search?q=prudential'),
  },
  {
    name: 'ask',
    request: (request) =>
      request.post('/api/ask', { data: { question: 'Quais coberturas existem?' } }),
  },
  {
    name: 'compare',
    request: (request) =>
      request.post('/api/compare', {
        data: { insurerNames: ['Azos', 'MAG'], productType: 'seguro de vida' },
      }),
  },
  {
    name: 'pre-sinistro',
    request: (request) =>
      request.post('/api/pre-sinistro', {
        data: {
          insurerName: 'MAG',
          claimType: 'doenca grave',
          description: 'Teste operacional sem efeitos colaterais.',
        },
      }),
  },
]

test.describe('public availability', () => {
  test('landing page is available', async ({ page }) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' })

    expect(response?.ok()).toBeTruthy()
    await expect(page.locator('body')).not.toBeEmpty()
  })

  test('login form is available', async ({ page }) => {
    const response = await page.goto('/login', { waitUntil: 'domcontentloaded' })

    expect(response?.ok()).toBeTruthy()
    await expect(page.getByText('Entrar', { exact: true }).first()).toBeVisible()
    await expect(page.getByLabel('E-mail')).toBeVisible()
    await expect(page.getByLabel('Senha')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible()
  })

  test('signup page is available', async ({ page }) => {
    const response = await page.goto('/signup', { waitUntil: 'domcontentloaded' })

    expect(response?.ok()).toBeTruthy()
    await expect(page.getByText('Solicitar acesso', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Enviar solicita/ })).toBeVisible()
  })
})

test.describe('unauthenticated protection', () => {
  for (const protectedPage of protectedPages) {
    test(`${protectedPage} redirects to login`, async ({ page }) => {
      await page.goto(protectedPage, { waitUntil: 'domcontentloaded' })

      const expectedRedirect = encodeURIComponent(protectedPage)
      await expect(page).toHaveURL(new RegExp(`/login\\?redirect=${expectedRedirect}$`))
    })
  }

  for (const protectedApi of protectedApis) {
    test(`${protectedApi.name} API rejects unauthenticated access`, async ({ request }) => {
      const response = await protectedApi.request(request)

      expect(response.status()).toBe(401)
    })
  }
})
