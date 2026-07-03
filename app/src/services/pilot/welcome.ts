import { sendMessage } from '@/services/whatsapp/providers'

const WELCOME_BODY = (name: string) =>
  `Ola, *${name.split(' ')[0]}*! Bem-vindo ao *SOLOMON* — seu consultor privado de seguros de vida.\n\n` +
  `O que eu faco de melhor: *cotacao Prudential e MAG na hora, com fonte*. ` +
  `Tambem consulto condicoes gerais de 14 seguradoras — sempre citando a fonte; quando nao tenho certeza, eu digo.\n\n` +
  `Pode comecar agora: me pergunte, por exemplo,\n` +
  `_"cotacao Prudential vida inteira, homem, 35 anos, capital 500 mil"_\n\n` +
  `Digite */ajuda* para ver tudo que sei fazer.`

/** Envia o welcome do piloto. Lança em falha — o chamador decide se bloqueia. */
export async function sendPilotWelcome(phoneE164: string, name: string): Promise<void> {
  const provider = process.env.WHATSAPP_PROVIDER ?? 'kapso'
  await sendMessage(provider, { to: phoneE164, body: WELCOME_BODY(name) })
}
