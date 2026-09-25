# Segurança e LGPD: estado e plano

Última revisão: 25/09/2026. Marque os itens conforme forem entregues.

## Já implementado

- Senhas (atendente e administrador) e tokens de sessão guardados só como hash.
- Tabelas com RLS e sem políticas: o app acessa apenas por funções `lh_*`, que
  conferem a chave da LP ou a sessão; cada cliente vê só os próprios dados.
- Funções de servidor (`lh_server_*`) exigem o segredo `LH_SERVER_SECRET`
  (guardado no banco só como hash).
- **Token da Meta criptografado** (AES-256-GCM) antes de ir para o banco. A
  chave (`LH_ENCRYPTION_KEY`) fica só no servidor (Netlify); o banco recusa
  qualquer token que não esteja cifrado; o painel mostra só os 4 últimos
  caracteres; a resposta da Meta é gravada sem o token.
- Logs sem nome, telefone, código ou conteúdo enviado.
- Trava de domínio por LP.
- Histórico de alterações por lead (quem e quando, por papel).
- Exclusão definitiva de linhas pelo administrador, com confirmação.

## Segurança: pendente (ordem de prioridade)

1. [ ] Limite de tentativas de login (atendente e admin) com bloqueio temporário.
2. [ ] Login individual por atendente (rastreabilidade por pessoa).
3. [ ] Verificação em duas etapas (2FA) no painel mãe.
4. [ ] Cabeçalhos de segurança: CSP, HSTS, X-Frame-Options, Referrer-Policy.
5. [x] Token da Meta criptografado.
6. [ ] Registro de exportações de CSV e exclusões (quem, quando, quantas linhas).
7. [ ] Projeto Supabase exclusivo do Lead Hub (hoje é dividido com outro sistema).

## LGPD

**Papéis**: a clínica/empresa é a **controladora**; o Lead Hub é **operador**
(precisa de contrato de tratamento de dados com cada cliente); a Meta recebe
dados como terceira, com **transferência internacional**, que deve constar no
contrato e na política.

**Na landing page (responsabilidade do cliente, com nosso modelo):**
- [ ] Banner de consentimento; o Lead Hub só roda após o aceite (opção
      `data-consent` no script).
- [ ] Política de privacidade linkada no formulário: dados coletados (nome,
      telefone, respostas, origem do anúncio, IP, navegador), finalidade,
      compartilhamento com a Meta, prazo de guarda, canal para pedidos.
- [ ] **Dados de saúde**: respostas de quiz sobre saúde são dado sensível;
      exigem consentimento específico e destacado. Essas respostas nunca vão
      para a Meta (regra do código: só evento, valor e dados de contato em hash).

**No Lead Hub:**
- [ ] Prazo de guarda automático (ex.: lead perdido 12 meses, cliente 24 meses)
      com exclusão ou anonimização.
- [ ] IP e navegador apagados após 90 dias.
- [ ] Atendimento ao titular: exportar os dados de um lead; exclusão já existe.
- [ ] Canal de privacidade (e-mail) e, se aplicável, encarregado (DPO).
- [ ] Plano de incidente: avisar ANPD e titulares em até 3 dias úteis.
- [ ] Modelos de contrato de tratamento e de política de privacidade (revisar
      com advogado).
