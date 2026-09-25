# Segurança e LGPD: estado e plano

Última revisão: 25/09/2026. Marque os itens conforme forem entregues.

## Já implementado

**Acesso e credenciais**
- Senhas (atendente e administrador) e tokens de sessão guardados só como hash.
- **Limite de tentativas de login** (atendente e painel mãe): 5 senhas erradas
  em 15 minutos bloqueiam aquele aparelho por 15 minutos; 30 erradas de
  qualquer lugar bloqueiam a conta para todos por 15 minutos (cobre também
  chamadas diretas à API). A senha certa zera a contagem. O IP é guardado só
  como hash, e a resposta não revela se a conta existe.
- Tabelas com RLS e sem políticas: o app acessa apenas por funções `lh_*`, que
  conferem a chave da LP ou a sessão; cada cliente vê só os próprios dados.
- Funções de servidor (`lh_server_*`) exigem o segredo `LH_SERVER_SECRET`
  (guardado no banco só como hash).
- Token da Meta criptografado (AES-256-GCM) com a chave `LH_ENCRYPTION_KEY`,
  que existe só no servidor; o banco recusa token não cifrado.
- **Cabeçalhos de segurança**: HSTS, nosniff, Referrer-Policy, proibição de
  exibir o painel dentro de outro site (X-Frame-Options/CSP frame-ancestors),
  Permissions-Policy.
- Logs sem nome, telefone, código ou conteúdo enviado.
- Trava de domínio por LP.

**LGPD**
- **Consentimento na LP** (`data-consent="banner"` ou `"required"`): antes do
  aceite nada fica no aparelho do visitante e nenhuma visita, origem, IP ou
  navegador é enviada; o clique no WhatsApp registra só o contato digitado
  (origem "não coletada"). O aceite libera também o pixel da Meta e as tags do
  Google (`fbq('consent')` / consent mode). A recusa apaga o que estava guardado.
- **Nada vai para a Meta** de quem recusou o rastreamento.
- **Política de privacidade pública** por cliente (`/privacidade/<cliente>`),
  com controlador, contato, finalidades e bases legais, compartilhamento,
  transferência internacional, prazos e direitos do titular (art. 18). É um
  modelo: revisar com o jurídico do cliente.
- **Dados do controlador** e **prazo de guarda** configuráveis por cliente no
  painel mãe (cartão Privacidade), com aviso se faltar o e-mail de privacidade.
- **Prazo de guarda automático** (todo dia às 03:10): leads sem atividade além
  do prazo do cliente (padrão 24 meses) e visitas antigas são apagados; IP e
  navegador são apagados após 90 dias.
- **Pedido do titular**: o administrador exporta tudo o que existe sobre um
  lead (botão no Histórico) e pode excluir definitivamente.
- **Registro de auditoria**: exportações de planilha, exportações de dados de
  lead e exclusões (quem, quando, quantas), visível no painel mãe, guardado 5
  anos.
- Dados de saúde: respostas do quiz nunca vão para a Meta; o prompt de
  instalação exige caixa de consentimento específico para perguntas de saúde.
- Histórico de alterações por lead (quem e quando, por papel).

## Pendente

**Segurança**
1. [ ] Login individual por atendente (rastreabilidade por pessoa).
2. [ ] Verificação em duas etapas (2FA) no painel mãe.
3. [ ] Projeto Supabase exclusivo do Lead Hub (hoje é dividido com outro sistema).
4. [ ] Trocar as senhas que passaram por conversas e as chaves de produção
       criadas em sessões com IA, se quiser risco zero.

**LGPD (fora do código)**
5. [ ] Contrato de tratamento de dados (operador) com cada cliente.
6. [ ] Revisão jurídica do modelo de política de privacidade.
7. [ ] Preencher, para cada cliente, controlador e e-mail de privacidade.
8. [ ] Reinstalar o código nas LPs já publicadas com `data-consent="banner"`
       e o `fbq('consent', 'revoke')` (LPs antigas continuam sem banner).
9. [ ] Plano de incidente: avisar ANPD e titulares em até 3 dias úteis.
10. [ ] Canal do encarregado (DPO), se o cliente não for dispensado.
