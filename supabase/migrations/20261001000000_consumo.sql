-- Consumo do Marco: uma linha por pedido, só números (sem conteúdo da conversa).
-- Segurança de linha ligada e nenhuma regra de acesso: só o servidor (chave de serviço) lê e grava.
create table if not exists public.consumo (
  id bigint generated always as identity primary key,
  quando timestamptz not null default now(),
  modo text not null,
  quem text,
  entrada integer not null default 0,
  saida integer not null default 0,
  cache_lido integer not null default 0,
  cache_escrito integer not null default 0,
  buscas integer not null default 0,
  chamadas integer not null default 0,
  usd numeric(12, 5) not null default 0
);
create index if not exists consumo_quando on public.consumo (quando);
alter table public.consumo enable row level security;
-- o projeto não expõe tabelas novas automaticamente: acesso explícito só para o servidor (chave de serviço);
-- o público e usuários logados não leem nem gravam
revoke all on public.consumo from anon, authenticated;
grant select, insert on public.consumo to service_role;
