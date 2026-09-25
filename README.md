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
**Respostas** e viram colunas próprias no CSV. Quando a LP pede nome e telefone antes do WhatsApp, a linha já chega
preenchida, e um novo clique com o mesmo telefone (mesmo de outro aparelho)
soma na mesma linha. Cliques repetidos do mesmo
visitante somam na mesma linha e mantêm a origem da
primeira visita. Contatos que chegaram no WhatsApp sem passar pela LP podem ser
adicionados à mão (**+ Adicionar lead**). A planilha exporta para CSV no
formato do Excel em português.

API do script para LPs que montam o link do WhatsApp no próprio código:

```js
window.open(LeadHub.whatsappUrl("https://wa.me/55119..."));  // registra o clique e inclui o código
LeadHub.set({ "Tempo de queda": "Mais de 5 anos" });          // respostas (quiz) que vão junto com o clique
LeadHub.identify({ name: "Maria", phone: "(11) 91234-5678" }); // contato pedido antes do WhatsApp
LeadHub.track("quiz_concluido", { value: 150 });              // evento que a LP não manda ao pixel nem ao GTM
```

O script também lê sozinho os eventos que a LP já dispara pelo pixel da Meta e
pelo Google Tag Manager, sem alterar nenhum dos dois, e ignora os sem peso
comercial (PageView, ViewContent, rolagem...). Cada lead mostra os eventos que
disparou, e as métricas mostram quantas pessoas dispararam cada evento e
quantas delas clicaram no WhatsApp e compraram.

Regras de instalação em outras LPs: [docs/INSTALACAO-LP.md](docs/INSTALACAO-LP.md).
Segurança e LGPD (feito e pendente): [docs/SEGURANCA-LGPD.md](docs/SEGURANCA-LGPD.md).

## LGPD

- Código da LP com `data-consent="banner"`: aviso de cookies (Aceitar/Recusar);
  sem aceite, nada fica no aparelho e só o contato digitado é registrado.
- Política de privacidade pública por cliente em `/privacidade/<cliente>`,
  preenchida no painel mãe (cartão Privacidade).
- Prazo de guarda automático (função agendada `netlify/functions/retention.mts`),
  exportação dos dados de um lead para o titular e registro de exportações e
  exclusões.
- Login com limite de tentativas.

Detalhes e pendências em [docs/SEGURANCA-LGPD.md](docs/SEGURANCA-LGPD.md).

## Acesso

- **Painel mãe** (`/admin`): cria clientes e Landing Pages, copia o código e o
  prompt de instalação de cada LP, gera ou troca a senha do atendente, vê os
  eventos recebidos, abre a planilha de qualquer cliente e exclui linhas (por
  exemplo, testes) com uma etapa de confirmação. Há dois papéis:
  - **master**: vê todos os clientes e cria, desativa ou troca a senha dos
    gestores (menu **Gestores**). Também escolhe o gestor responsável de cada
    cliente. O master é criado no banco:
    ```sql
    select lh_private.create_admin('email@exemplo.com', '<senha com 10+ caracteres>');
    ```
  - **gestor**: criado pelo master no painel; vê e administra só os clientes
    que criou ou que o master passou para ele. Um cliente de outro gestor
    responde como se não existisse. Desativar um gestor encerra as sessões
    dele na hora.
  - **Minha conta** (clique no seu e-mail no topo): troca a própria senha
    digitando a atual; os outros aparelhos saem.
  - **Esqueci minha senha** (tela de login): manda por e-mail um link para
    criar uma senha nova. O link vale 30 minutos, funciona uma vez, só o
    último pedido vale e há no máximo 3 por hora por conta. A resposta é a
    mesma para e-mails sem acesso. Gestor desativado não recupera: o master
    reativa. Precisa de `RESEND_API_KEY` e `LH_MAIL_FROM` (veja abaixo).
- **Atendente** (`/w/<cliente>`): entra com a senha do cliente e vê só a
  planilha. Pode editar nome, telefone, status, valor e observações, mas não
  exclui linhas nem vê configurações.

## Atendimento

- **Atender** (primeira tela do atendente): fila de quem clicou e ainda não
  recebeu contato, do mais antigo para o mais novo, com o tempo de espera
  (verde até 5 min, amarelo até 30, vermelho depois), mais os retornos
  atrasados e os de hoje. A aba mostra quantos estão esperando.
- **Mensagens prontas**: o botão **WhatsApp** de cada lead abre a conversa com
  uma mensagem escolhida, já com o primeiro nome (`{nome}`) e o nome da empresa
  (`{empresa}`). Abrir a conversa registra o primeiro contato e passa o lead de
  Novo para Em atendimento. O administrador edita as mensagens na aba
  **Mensagens**; o atendente só vê.
- **Retorno**: cada lead pode ter data de próximo contato (atalhos "Amanhã 9h",
  "Em 3 dias"...). No dia, ele volta para a fila.
- **Motivo da perda**: marcar como Perdido pede o motivo, que aparece nas
  métricas.
- **Histórico**: cada lead guarda tudo o que aconteceu (clique, telefone,
  status, mensagens, retornos, envios para a Meta), com quem fez e quando.
- **Avisos**: o Lead Hub pode ser instalado como app (no iPhone, pela opção
  "Adicionar à Tela de Início" do Safari) e avisar cada novo lead com uma
  notificação, mesmo fechado (**Ativar avisos** no topo). Com o painel aberto,
  toca um som e o título da aba mostra quantos esperam.

## Conversões para a Meta

No painel mãe, em cada cliente, **Conversões para a Meta** guarda o ID do
pixel e o token da API de Conversões. O token é criptografado (AES-256-GCM)
pelo servidor antes de ir para o banco, com a chave `LH_ENCRYPTION_KEY`, que
existe só no Netlify; o banco recusa tokens não cifrados e o painel mostra só
os 4 últimos caracteres. Com o envio ligado:

- Agendado → evento `Schedule`;
- Venda com valor → evento `Purchase` com o valor em BRL.

Cada evento vai uma vez por lead (`event_id` = lead + evento), com telefone e
nome em SHA-256, `fbc`, `fbp`, IP e navegador do clique, no horário em que o
lead foi agendado ou vendido e como conversão feita na conversa
(`action_source: chat`). Quem recusou os cookies na LP não é enviado.

Se um envio falhar, a função agendada `netlify/functions/meta-retry.mts` tenta
de novo a cada hora (até 6 vezes por evento, enquanto o resultado tiver menos
de 7 dias, que é o limite da Meta). Ela também envia o que foi agendado ou
vendido enquanto a integração estava desligada ou em modo teste. O painel mãe
mostra as falhas das últimas 24 horas e avisa quando a própria LP também
dispara `Schedule` ou `Purchase` pelo pixel/GTM, o que faria a Meta contar em
dobro. Com um código de
teste, os eventos aparecem só em "Testar eventos" do Gerenciador de Eventos.
A versão da Graph API pode ser trocada com `META_GRAPH_VERSION` (padrão
`v24.0`).

## Métricas

A aba **Métricas** (visível para o atendente e para o administrador) mostra a
**taxa de conversão da LP** em destaque: pessoas que clicaram no WhatsApp ÷
pessoas que visitaram (cliques repetidos da mesma pessoa contam uma vez). Traz
também o funil (visitaram → clicaram → com telefone → agendaram → compraram),
os visitantes e a conversão por dia, e o aproveitamento por origem, campanha,
conjunto, anúncio ou dispositivo. Leads adicionados à mão ficam fora do funil
da LP e aparecem numa nota à parte. A seção **Atendimento** mostra a mediana
do tempo até o primeiro contato, quantos foram respondidos em até 5 minutos e
os motivos de perda.

Todas as telas funcionam no celular: a planilha vira uma lista de cartões
editáveis (com botão para abrir o WhatsApp do lead), e os gráficos mostram os
números do dia ao tocar.

## Dados para a Meta

Para enviar conversões à Meta no futuro (Conversions API), cada lead guarda:
nome e ID da campanha, do conjunto e do anúncio, posicionamento, todas as
UTMs e demais parâmetros da URL, `fbclid`, `fbc` e `fbp`, a URL da página,
o horário do clique e o IP e o navegador do visitante. IP e navegador não
aparecem na planilha.

Parâmetros de URL recomendados nos anúncios da Meta (o `fbclid` a Meta
acrescenta sozinha):

```
utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&placement={{placement}}&site_source_name={{site_source_name}}
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
| `lh_admins`, `lh_admin_sessions` | Administradores do painel mãe e suas sessões |
| `lh_workspaces` | Clientes e hash da senha do atendente |
| `lh_sessions` | Sessões da planilha: atendente (30 dias) ou administrador (12 h) |
| `lh_pages` | Landing Pages, chave pública, domínios, código no WhatsApp |
| `lh_leads` | Uma linha por visitante que clicou no WhatsApp (ou lead manual) |
| `lh_events` | Visitas, cliques e outros eventos da LP |
| `lh_lead_history` | Histórico de cada lead (gravado por gatilho) |
| `lh_templates` | Mensagens prontas de cada cliente |
| `lh_push_subscriptions` | Aparelhos que recebem avisos de novo lead |
| `lh_meta_configs`, `lh_meta_events` | Pixel/token da Meta e registro dos envios |

As funções `lh_server_*` (avisos e Meta) só respondem ao servidor do app, que
se identifica com um segredo guardado como hash:

```sql
select lh_private.set_server_secret('<mesmo valor de LH_SERVER_SECRET>');
```

## Ambiente de teste

- App: https://leadinghub.netlify.app (Netlify, projeto `leadinghub`, branch
  `claude/new-session-hmpokh`).
- Banco: projeto Supabase `rda-report-panel`, tabelas `lh_*`.
- Variáveis no Netlify: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`,
  `LH_SERVER_SECRET` (32+ caracteres, o mesmo do banco),
  `LH_ENCRYPTION_KEY` (32 bytes aleatórios em base64url; trocar a chave obriga
  a salvar de novo o token da Meta),
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` (gerar com
  `npx web-push generate-vapid-keys`) e, opcional, `META_GRAPH_VERSION`.
  Para o "Esqueci minha senha": `RESEND_API_KEY` (conta em resend.com,
  variável secreta) e `LH_MAIL_FROM`, por exemplo
  `Lead Hub <nao-responda@cadeolead.com.br>`, com o domínio verificado no
  Resend. O link do e-mail usa `NEXT_PUBLIC_APP_URL` (ou a URL principal do
  Netlify), nunca o endereço da requisição.
  Sem o segredo ou as chaves VAPID, avisos e envio à Meta ficam desligados e o
  resto funciona normalmente.
- `LH_SERVER_SECRET`, `LH_ENCRYPTION_KEY`, `VAPID_PRIVATE_KEY` e `RESEND_API_KEY` são variáveis
  secretas: no Netlify, grave-as com o contexto **Production** (o Netlify não
  guarda variável secreta no contexto "todos") e publique de novo depois de
  criar ou trocar qualquer uma delas. O painel mãe avisa, no cartão da Meta,
  quando o servidor não as encontra.

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
