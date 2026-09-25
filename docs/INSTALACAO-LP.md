# Instalação do Lead Hub numa Landing Page

## Passo a passo

1. No painel mãe (`/admin`), **Novo cliente**: cria a planilha, a primeira LP
   e a senha do atendente.
2. Na página do cliente, copie o **Prompt de instalação** e cole no Claude Code
   do projeto da LP (ou entregue ao desenvolvedor).
3. Teste: abra a LP com `?utm_source=teste`, preencha nome e telefone e clique
   no WhatsApp. A mensagem termina com "(cód. XXXX)" e a linha aparece na
   planilha em segundos.
4. Cadastre o domínio da LP em **Domínios autorizados**: a chave passa a
   aceitar dados só desse site.
5. Entregue ao atendente o link `/w/<cliente>` e a senha.

## Regras para toda LP

- **Script em todas as páginas**, no `<head>`, logo depois do pixel da Meta,
  sem alterar o pixel nem os scripts existentes.
- **Uma chave por LP.** Outra LP do mesmo cliente usa **Adicionar outra
  Landing Page**, nunca a mesma chave (as métricas separam por LP).
- **Todo botão de WhatsApp passa pelo Lead Hub**: link `wa.me` /
  `api.whatsapp.com`, `window.open`, ou `LeadHub.whatsappUrl(url)` quando a
  página monta a URL no próprio código. Um `location.href` montado à mão sem a
  função não é registrado.
- **Nome e telefone antes do WhatsApp**, com
  `LeadHub.identify({ name, phone })`, e o aviso "Ao continuar, você concorda
  em ser contatado pelo WhatsApp." com link para a política de privacidade.
- **Quiz**: `LeadHub.set({ "Pergunta curta": "resposta" })`. Cada rótulo vira
  uma coluna.
- **Anúncios da Meta** com os parâmetros de URL recomendados no README (nomes
  e IDs de campanha, conjunto e anúncio).
- **Não remover o "(cód. XXXX)"** da mensagem: é o que liga a conversa à linha.
- **LGPD** (ver `SEGURANCA-LGPD.md`): banner de consentimento antes de carregar
  pixel e Lead Hub; consentimento específico e destacado se o quiz perguntar
  sobre saúde.
