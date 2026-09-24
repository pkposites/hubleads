# Lead Hub

Planilha de leads da Landing Page: cada clique no botão de WhatsApp vira uma
linha, com a origem completa do anúncio. O telefone fica para o atendente
preencher, porque o visitante vai direto para o WhatsApp sem formulário.

## Como funciona

```
Landing Page + tracker.js ──► /api/collect ──► lh_collect() ──► planilha
  UTMs, gclid, fbclid,           (Next.js)      (Supabase)       atendente preenche
  cookies do pixel da Meta,                                      telefone, status,
  visitas e cliques no WhatsApp                                  valor e observações
```

1. A LP recebe uma linha de código (em **Instalação na LP** no painel):
   ```html
   <script src="https://leadinghub.netlify.app/tracker.js" data-key="pk_..." async></script>
   ```
2. O script guarda as UTMs, os identificadores de clique e os cookies `_fbp` e
   `_fbc` do pixel da Meta, e envia uma visita ao abrir a página.
3. Em todo clique num link de WhatsApp (`wa.me`, `api.whatsapp.com`,
   `whatsapp://` ou `window.open` para eles), envia o clique sem atrasar a
   abertura do WhatsApp e acrescenta à mensagem um código curto, por exemplo
   "(cód. 7F3K)".
4. No painel, a linha aparece em segundos com o mesmo código. Quando a conversa
   chega, o atendente busca o código e preenche telefone, status, valor e
   observações direto na célula.

Respostas enviadas pela LP (por exemplo, de um quiz) aparecem na coluna
**Respostas** e viram colunas próprias no CSV. Cliques repetidos do mesmo
visitante somam na mesma linha e mantêm a origem da
primeira visita. Contatos que chegaram no WhatsApp sem passar pela LP podem ser
adicionados à mão (**+ Adicionar lead**). A planilha exporta para CSV no
formato do Excel em português.

API do script para LPs que montam o link do WhatsApp no próprio código:

```js
window.open(LeadHub.whatsappUrl("https://wa.me/55119..."));  // registra o clique e inclui o código
LeadHub.set({ "Tempo de queda": "Mais de 5 anos" });          // respostas (quiz) que vão junto com o clique
LeadHub.identify({ name: "Maria" });                          // nome no lead do visitante
LeadHub.track("quiz_concluido", { etapa: 3 });                // qualquer outro evento
```

## Acesso

Cada empresa tem um endereço e uma senha (`/w/<empresa>`). Não há cadastro:
a empresa é criada no banco por um administrador:

```sql
select lh_private.create_workspace('Dra Letícia', 'dra-leticia', '<senha>', 'LP Transplante');
```

## Banco de dados

Tudo fica no esquema `public` com o prefixo `lh_`, para dividir o projeto
Supabase com outros sistemas sem configuração extra. As tabelas têm RLS ativo
e nenhuma política: o app (com a chave pública) só consegue chamar as funções
`lh_*`. A captura exige a chave pública da LP, e o painel exige um token de
sessão emitido por `lh_login`. Opcionalmente, cada LP aceita dados só dos
domínios cadastrados.

| Tabela | Conteúdo |
| --- | --- |
| `lh_workspaces` | Empresas e hash da senha |
| `lh_sessions` | Sessões do painel (30 dias) |
| `lh_pages` | Landing Pages, chave pública, domínios, código no WhatsApp |
| `lh_leads` | Uma linha por visitante que clicou no WhatsApp (ou lead manual) |
| `lh_events` | Visitas, cliques e outros eventos da LP |

## Ambiente de teste

- App: https://leadinghub.netlify.app (Netlify, projeto `leadinghub`, branch
  `claude/new-session-hmpokh`).
- Banco: projeto Supabase `rda-report-panel`, tabelas `lh_*`.
- Variáveis no Netlify: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` e `NEXT_PUBLIC_APP_URL`.

## Desenvolvimento

```bash
npm install
cp .env.example .env.local   # URL e chave pública do Supabase
npm run dev
```

## Testes

```bash
npm test          # unitários: tracker.js (jsdom), coleta, CSV, normalização, origem
npm run test:db   # banco: captura, sessões, isolamento entre empresas, edição
```

Os testes de banco criam um banco descartável, aplicam
`supabase/tests/supabase-shim.sql` e todas as migrações, e chamam as funções
como o papel `anon`, do mesmo jeito que o app. Precisam de um PostgreSQL 15+:

```bash
export TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
```
