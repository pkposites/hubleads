# Plano: banco próprio e várias agências no Cadê o Lead

Objetivo: tirar o Cadê o Lead do banco compartilhado (Supabase
`bqtgpbegrewbamgatkef`, junto com J.A e outros sistemas) e abrir a ferramenta
para outras agências e gestores, cada um com seus clientes separados.

## Onde estamos (bom ponto de partida)

- Tudo é Postgres padrão: tabelas `lh_*` e funções `lh_*` em SQL. Nenhuma
  regra de negócio depende de recurso exclusivo do Supabase.
- O app fala com o banco por um único ponto: `call()` em `src/lib/db.ts`
  (chama funções). Trocar de Supabase para outro Postgres (Neon, RDS,
  Supabase em outra conta) muda só esse arquivo.
- O banco inteiro nasce dos arquivos em `supabase/migrations/`, em ordem. Os
  testes de banco (`npm run test:db`) já recriam tudo do zero a cada
  execução, então um banco novo sai idêntico ao de produção.
- Segredos (token da Meta) já são cifrados pelo app; mudam de banco junto
  com a chave `LH_ENCRYPTION_KEY`, sem ficar expostos.

## Modelo com várias agências

```
Plataforma (você, super-admin)
└── Agência (conta que assina o Cadê o Lead)
    ├── Usuários da agência: dono e gestores
    └── Clientes (workspaces)
        ├── Páginas, formulários Meta, planilhas, Google Ads
        └── Leads, histórico, eventos
```

- Nova tabela `agencies` (nome, plano, limites, status) e `agency_id` em
  admins e workspaces.
- Toda função `lh_admin_*` passa a checar "o cliente é da agência deste
  usuário" (hoje `admin_check_workspace` checa master/gestor; vira
  agência + papel). O teste `gestores.test.ts` passa a cobrir também
  "agência A não enxerga agência B".
- Papéis: super-admin (plataforma), dono da agência, gestor (só os clientes
  dele), atendente (painel do cliente, como hoje).
- Cadastro: os pedidos da página inicial (`lh_signups`) viram o início do
  fluxo de criar uma agência.

## Fases

1. **Preparar no banco atual (sem risco para os clientes)**
   - Criar `agencies` e `agency_id`; colocar os clientes atuais numa
     agência "Robson" (a sua). Nada muda para quem usa.
   - Ajustar as checagens de acesso e os testes para agência.
   - Deixar `src/lib/db.ts` pronto para Postgres direto, além do Supabase.
2. **Banco novo**
   - Projeto próprio, numa conta e organização só sua, plano pago com
     backup diário (e PITR se o volume crescer), região São Paulo.
   - Funções do Netlify também em São Paulo (mesma cidade do banco).
   - Rodar todas as migrações; conferir a "impressão digital" das funções.
3. **Mudança de dados**
   - Copiar só as tabelas `lh_*` (nada de J.A e outros), contar linhas
     tabela por tabela antes e depois.
   - Janela curta à noite: pausar o envio, copiar, trocar as variáveis no
     Netlify, testar um lead real, liberar.
   - Plano de volta: o banco antigo fica intacto por 30 dias.
4. **Abrir para outras agências**
   - Tela de criar agência a partir de um pedido de cadastro, convite de
     usuários, limites por plano (clientes, leads/mês).
   - Termos de uso e contrato de operador de dados (LGPD) por agência.

## Decisões pendentes (do Robson)

- Provedor do banco novo (recomendado: Supabase em conta própria, plano Pro).
- Planos e preço por agência (define os limites que o sistema controla).
- Se cada agência terá domínio/marca própria ou tudo em cadeolead.com.br.
