import { LegalShell } from "@/components/legal/legal-shell";
import { LEGAL } from "@/config/legal";

export const metadata = { title: "Política de Privacidade" };

export default function PrivacidadePage() {
  return (
    <LegalShell
      title="Política de Privacidade"
      version={LEGAL.privacy.version}
      updatedAt={LEGAL.privacy.updatedAt}
    >
      <section>
        <h2>1. Quem somos</h2>
        <p>
          O SOLOMON é um assistente de inteligência artificial para corretores de
          seguros de vida, operado pela {LEGAL.controller} (&quot;nós&quot;), controladora
          dos dados pessoais tratados nesta plataforma. Esta política explica quais
          dados coletamos, por que, com quem compartilhamos e quais são os seus
          direitos, em conformidade com a Lei nº 13.709/2018 (LGPD).
        </p>
      </section>

      <section>
        <h2>2. Dados que coletamos</h2>
        <p>Coletamos apenas o necessário para prestar o serviço:</p>
        <ul>
          <li><strong>Cadastro:</strong> nome, e-mail, telefone (WhatsApp) e CPF/CNPJ.</li>
          <li><strong>Profissionais:</strong> CRECI e registro SUSEP, quando informados.</li>
          <li><strong>Uso do serviço:</strong> perguntas feitas ao assistente (no WhatsApp e no painel), respostas geradas, histórico de consultas e feedback.</li>
          <li><strong>Pagamento:</strong> status e identificadores da assinatura. Os dados do cartão/Pix são processados diretamente pelo Asaas — nós não armazenamos dados financeiros de pagamento.</li>
          <li><strong>Técnicos:</strong> registros de acesso (data, hora, IP) para segurança e prevenção a abuso.</li>
        </ul>
      </section>

      <section>
        <h2>3. Bases legais e finalidades</h2>
        <ul>
          <li><strong>Execução do contrato</strong> (art. 7º, V): criar e manter sua conta, responder às suas consultas, processar a assinatura.</li>
          <li><strong>Consentimento</strong> (art. 7º, I): envio de mensagens de boas-vindas e avisos pelo WhatsApp; você pode revogar a qualquer momento.</li>
          <li><strong>Legítimo interesse</strong> (art. 7º, IX): segurança, prevenção a fraude e melhoria do serviço, sempre respeitando seus direitos.</li>
          <li><strong>Cumprimento de obrigação legal</strong> (art. 7º, II): guarda de registros de acesso e fiscais quando exigido por lei.</li>
        </ul>
      </section>

      <section>
        <h2>4. Com quem compartilhamos</h2>
        <p>
          Não vendemos seus dados. Compartilhamos apenas com operadores necessários ao
          funcionamento do serviço, cada um tratando os dados conforme suas próprias
          políticas:
        </p>
        <ul>
          <li><strong>Supabase</strong> — banco de dados e autenticação.</li>
          <li><strong>Vercel</strong> — hospedagem da aplicação.</li>
          <li><strong>Asaas</strong> — processamento de pagamentos e assinaturas.</li>
          <li><strong>Kapso / Meta (WhatsApp)</strong> — envio e recebimento das mensagens.</li>
          <li><strong>Provedores de IA</strong> (Anthropic, OpenRouter, Google) — geração das respostas do assistente. As perguntas enviadas ao assistente são processadas por esses provedores para produzir a resposta.</li>
        </ul>
        <p>
          Parte desses provedores pode processar dados fora do Brasil. Nesses casos, a
          transferência internacional segue as hipóteses do art. 33 da LGPD.
        </p>
      </section>

      <section>
        <h2>5. Retenção</h2>
        <p>
          Mantemos seus dados enquanto sua conta estiver ativa e pelo prazo necessário
          para cumprir obrigações legais e resolver disputas. Encerrada a conta, os
          dados são eliminados ou anonimizados, salvo quando a lei exigir guarda por
          prazo determinado.
        </p>
      </section>

      <section>
        <h2>6. Segurança</h2>
        <p>
          Seus dados são armazenados com criptografia em repouso e em trânsito (HTTPS/TLS),
          com controle de acesso por linha (Row Level Security) e proteção contra senhas
          vazadas. Ainda assim, nenhum sistema é 100% infalível — em caso de incidente de
          segurança relevante, comunicaremos você e a ANPD conforme a LGPD.
        </p>
      </section>

      <section>
        <h2>7. Seus direitos</h2>
        <p>
          Você pode, a qualquer momento, solicitar: confirmação de tratamento, acesso,
          correção, anonimização, portabilidade, eliminação dos dados, informação sobre
          compartilhamento e revogação do consentimento. Para exercer qualquer desses
          direitos, escreva para <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
        </p>
      </section>

      <section>
        <h2>8. Encarregado (DPO) e contato</h2>
        <p>
          Para dúvidas sobre privacidade ou para exercer seus direitos, fale com o
          encarregado pelo tratamento de dados: <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
        </p>
      </section>
    </LegalShell>
  );
}
