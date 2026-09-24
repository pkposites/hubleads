# Lead Hub

Painel de leads e mensuração do anúncio até a venda. Implementação do
*Blueprint de produto e implementação v1.0* (22/09/2026).

Esta primeira entrega cobre a **primeira tarefa** (§20.1) e a **primeira
demonstração útil** (§20.2) do blueprint:

- Base multiempresa: workspaces, membros com papéis, projetos e **RLS** em
  todas as tabelas, com testes provando que um membro do workspace A não
  acessa o workspace B (AC11).
- Schema de leads, conversões, respostas, pipeline configurável, histórico
  imutável e outbox (§7, §9).
- API de ingestão `POST /api/v1/leads` com chave pública + Origin ou chave
  secreta, idempotência, deduplicação por telefone/e-mail e classificação de
  origem (§6, §8).
- Painel: login, escolha de workspace, criação de projeto, Landing Pages,
  formulários, chaves, tabela de leads com filtros, mudança de estágio e
  página do lead com first/last touch e linha do tempo (§13).

## Stack

| Camada | Tecnologia |
| --- | --- |
| Aplicação | Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 |
| Banco e Auth | Supabase (PostgreSQL 17, Supabase Auth) |
| Validação | zod, libphonenumber-js |
| Testes | Vitest; testes de banco contra um PostgreSQL real |

## Como rodar

1. Crie um projeto no Supabase (ou use `npx supabase start` com Docker).
2. Aplique as migrações:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
3. Copie `.env.example` para `.env.local` e preencha as chaves.
4. `npm install && npm run dev` e abra http://localhost:3000.

### Roteiro da demo (§20.2)

1. Crie uma conta em `/login` e um workspace.
2. Crie um projeto. O pipeline padrão (Novo → Contatado → Qualificado →
   Agendado → Venda / Perdido) é criado automaticamente.
3. Na página do projeto, gere uma **chave secreta** e envie um lead pela API:
   ```bash
   curl -X POST http://localhost:3000/api/v1/leads \
     -H "Authorization: Bearer sk_live_..." \
     -H "Idempotency-Key: $(uuidgen)" \
     -H "Content-Type: application/json" \
     -d '{
       "lead": { "name": "Joao da Silva", "phone": "(11) 99999-9999", "email": "joao@example.com" },
       "answers": { "budget_range": "10k_20k", "city": "Sao Paulo" },
       "tracking": { "utm_source": "facebook", "utm_medium": "paid", "utm_campaign": "transplante_sp", "ad_id": "456789" },
       "consent": { "privacy_policy": true }
     }'
   ```
   Ou use o botão **Enviar lead de teste**.
4. Em **Leads**, mude o estágio de Novo para Contatado. A mudança aparece na
   linha do tempo do lead com autor e horário.

## API de ingestão

`POST /api/v1/leads` (contrato do §8). Respostas sempre trazem `X-Request-Id`.

| Modo | Cabeçalhos |
| --- | --- |
| Landing Page (navegador) | `X-Project-Key: pk_live_…` e `Origin` de um domínio autorizado da LP |
| Servidor | `Authorization: Bearer sk_live_…` e `Idempotency-Key` (obrigatório) |

| Status | Quando |
| --- | --- |
| 201 | Conversão registrada (`created: true` se o lead é novo; `duplicate: true` se o lead já existia) |
| 200 | Reenvio com a mesma `Idempotency-Key` e o mesmo payload: devolve o resultado original |
| 400 `INVALID_REQUEST` | Payload inválido, com `details` por campo |
| 401 `INVALID_PROJECT_KEY` | Chave ausente, inválida ou revogada |
| 403 `ORIGIN_NOT_ALLOWED` | Origin fora dos domínios da Landing Page |
| 404 `PROJECT_NOT_FOUND` | Projeto arquivado |
| 409 `DUPLICATE_REQUEST` | Mesma `Idempotency-Key` com payload diferente |

Regras implementadas:

- Telefone normalizado para E.164 (padrão Brasil) é o identificador
  preferencial; e-mail é o segundo. Mesmo telefone no mesmo projeto reutiliza
  o lead e cria uma nova conversão; nunca há fusão entre projetos. E-mail que
  já pertence a outro telefone cria um lead marcado para revisão (§6.4).
- First touch é preservado; last touch é atualizado a cada conversão (§5.5).
  O SDK pode enviar `tracking.first_touch`.
- Canal classificado por click id → UTM → referrer → direct (§6.2, §6.3).
- Campo honeypot `website`: se preenchido, responde 201 e não grava nada.
- Toda conversão gera `lead.created` na outbox; estágios com evento geram
  `lead.qualified`, `lead.scheduled`, `lead.won` ou `lead.lost` na mesma
  transação, com `event_key` imutável e `transaction_id` estável para vendas.

## Banco de dados

Migrações em `supabase/migrations/`:

| Arquivo | Conteúdo |
| --- | --- |
| `…01_tenancy.sql` | profiles, workspaces, workspace_members, projects, helpers de RLS, `create_workspace()` |
| `…02_leads_pipeline.sql` | landing_pages, forms, project_api_keys, pipelines, pipeline_stages, leads, lead_conversions, lead_answers, lead_stage_history, outbox_events, `move_lead_stage()` |
| `…03_ingestion.sql` | `ingest_lead_conversion()` (somente service role) |

Permissões (§4.3): admin e gestor configuram o projeto e veem chaves e outbox;
comercial move estágios; cliente só lê; atendente só vê e edita os leads
atribuídos a ele. Estágio, histórico e outbox só mudam por funções do banco;
o histórico é append-only.

## Testes

```bash
npm test          # unitários: normalização, atribuição, chaves, handler da API
npm run test:db   # banco: migrações, RLS, papéis, ingestão, pipeline
```

Os testes de banco criam um banco descartável, aplicam
`supabase/tests/supabase-shim.sql` (papéis `anon`/`authenticated`/`service_role`,
`auth.uid()` e os grants padrão do Supabase) e todas as migrações. Precisam de
um PostgreSQL 15+ onde o usuário possa criar bancos e papéis:

```bash
export TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
```

O CI (`.github/workflows/ci.yml`) roda lint, typecheck, testes unitários, testes
de banco em PostgreSQL 17 e o build.

## Próximos passos (plano do §16)

- Fase 4: SDK JavaScript (`tracker.min.js`) com sessão anônima, first/last
  touch em cookie first party e tabelas `sessions`/`touchpoints`.
- Fase 5: registro do clique no WhatsApp na linha do tempo (US03, AC07),
  convites de membros e responsável pelo lead.
- Fase 6: worker da outbox, webhooks de saída assinados com HMAC, tentativas
  com backoff e painel de diagnóstico (AC10, AC14); exportação CSV (AC12).
- P1: Turnstile e rate limit na ingestão pública.
- Fases 7 e 8: Meta CAPI e Google Data Manager.
