import { LegalShell } from "@/components/legal/legal-shell";
import { LEGAL } from "@/config/legal";

export const metadata = { title: "Termos de Uso" };

export default function TermosPage() {
  return (
    <LegalShell
      title="Termos de Uso"
      version={LEGAL.terms.version}
      updatedAt={LEGAL.terms.updatedAt}
    >
      <section>
        <h2>1. Aceitação</h2>
        <p>
          Estes Termos regem o uso do SOLOMON, assistente de inteligência artificial
          para corretores de seguros de vida operado pela {LEGAL.controller}. Ao criar
          uma conta, assinar ou usar o serviço, você declara que leu e concorda com
          estes Termos e com a{" "}
          <a href="/privacidade">Política de Privacidade</a>.
        </p>
      </section>

      <section>
        <h2>2. O que o SOLOMON é — e o que não é</h2>
        <p>
          O SOLOMON é uma ferramenta de <strong>apoio e orientação</strong> ao corretor:
          consulta condições gerais, calcula cotações a partir de tabelas das seguradoras
          e cita as fontes que usou. Ele foi feito para acelerar a sua consulta, não para
          substituir o seu julgamento profissional.
        </p>
        <p>
          <strong>O SOLOMON não presta aconselhamento jurídico, securitário ou financeiro
          vinculante.</strong> As respostas são geradas por inteligência artificial e
          podem conter erros, estar desatualizadas ou não cobrir o seu caso específico.
          A decisão final — sobre cobertura, cotação, sinistro ou qualquer orientação ao
          cliente — é sempre sua responsabilidade profissional, que deve confirmar as
          informações na condição geral vigente e junto à seguradora e à SUSEP quando
          aplicável.
        </p>
      </section>

      <section>
        <h2>3. Sua conta</h2>
        <ul>
          <li>Você é responsável por manter a confidencialidade da sua senha e por todo uso feito na sua conta.</li>
          <li>Os dados que você informa (nome, CPF, telefone, e-mail) devem ser verdadeiros e atualizados.</li>
          <li>O acesso é pessoal e intransferível; o piloto é por convite.</li>
        </ul>
      </section>

      <section>
        <h2>4. Assinatura e pagamento</h2>
        <ul>
          <li>Os planos e valores vigentes são exibidos na página de planos. A cobrança é recorrente, processada pelo Asaas.</li>
          <li>Em caso de atraso, o acesso ao plano pago pode ser reduzido ao plano gratuito após o período de tolerância informado.</li>
          <li>Você pode cancelar a assinatura a qualquer momento; o cancelamento encerra as renovações futuras e não gera reembolso de períodos já pagos, salvo disposição legal em contrário.</li>
        </ul>
      </section>

      <section>
        <h2>5. Uso aceitável</h2>
        <p>Você concorda em não:</p>
        <ul>
          <li>Usar o serviço para fins ilícitos ou para enganar clientes.</li>
          <li>Tentar burlar limites, automatizar acesso indevido ou sobrecarregar a plataforma.</li>
          <li>Reproduzir ou revender as respostas como se fossem parecer oficial de seguradora ou da SUSEP.</li>
        </ul>
      </section>

      <section>
        <h2>6. Limitação de responsabilidade</h2>
        <p>
          Na máxima extensão permitida pela lei, a {LEGAL.controller} não se responsabiliza
          por prejuízos decorrentes de decisões tomadas com base nas respostas do SOLOMON,
          por indisponibilidades temporárias do serviço ou por informações fornecidas por
          terceiros (seguradoras, provedores de IA, meios de pagamento). O serviço é
          fornecido &quot;no estado em que se encontra&quot;, durante a fase de piloto.
        </p>
      </section>

      <section>
        <h2>7. Alterações</h2>
        <p>
          Podemos atualizar estes Termos. Mudanças materiais serão informadas e a versão
          vigente estará sempre disponível nesta página. O uso continuado após a alteração
          significa concordância com a nova versão.
        </p>
      </section>

      <section>
        <h2>8. Contato e foro</h2>
        <p>
          Dúvidas sobre estes Termos: <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
          Aplica-se a legislação brasileira.
        </p>
      </section>
    </LegalShell>
  );
}
