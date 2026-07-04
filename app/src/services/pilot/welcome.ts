import { sendMessage } from '@/services/whatsapp/providers'

const WELCOME_BODY = (name: string) =>
  `Ola, *${name.split(' ')[0]}*! Bem-vindo ao *SOLOMON* — seu consultor privado de seguros de vida.\n\n` +
  `O que eu faco de melhor: *cotacao Prudential e MAG na hora, com fonte*. ` +
  `Tambem consulto condicoes gerais de 14 seguradoras — sempre citando a fonte; quando nao tenho certeza, eu digo.\n\n` +
  `Pode comecar agora: me pergunte, por exemplo,\n` +
  `_"cotacao Prudential vida inteira, homem, 35 anos, capital 500 mil"_\n\n` +
  `Digite */ajuda* para ver tudo que sei fazer.`

export type WelcomeSendResult = 'sent' | 'awaiting_first_contact'

/**
 * Envia o welcome do piloto.
 *
 * A Meta WhatsApp Cloud API só permite mensagens "non-template" dentro da
 * janela de 24h — corretor recém-convidado nunca mandou mensagem, então cai
 * fora da janela (422). Isso não é uma falha real: é o estado esperado do
 * primeiro contato invertido (corretor manda o 1º oi, SOLOMON responde).
 * Qualquer outro erro (rede, credencial, 5xx) continua lançando — falha real
 * precisa continuar falhando alto.
 */
export async function sendPilotWelcome(phoneE164: string, name: string): Promise<WelcomeSendResult> {
  const provider = process.env.WHATSAPP_PROVIDER ?? 'kapso'
  try {
    await sendMessage(provider, { to: phoneE164, body: WELCOME_BODY(name) })
    return 'sent'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // só a janela de 24h vira estado "aguardando"; qualquer outro 422 (telefone
    // inválido, payload ruim) é falha real e continua lançando
    if (/24[- ]hour window/i.test(message)) {
      return 'awaiting_first_contact'
    }
    throw err
  }
}
