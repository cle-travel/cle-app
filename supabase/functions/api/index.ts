// O Marco na nuvem: Edge Function do Supabase (Deno). Usa as MESMAS rotas e o MESMO núcleo do computador de testes:
// os arquivos de ../_shared/ são cópias de servidor-marco/ feitas por prototipo/publicar-nuvem.mjs (não editar aqui).
// Segredos (definidos pelo script, nunca no código): ANTHROPIC_API_KEY, MAPBOX_TOKEN, FOURSQUARE_API_KEY, NPS_API_KEY,
// TESTADORES ({"Nome":"código"}) e, opcional, LIMITE_DIARIO_USD. SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY vêm do Supabase.
// @ts-nocheck

import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { criarApi, resumirConsumo } from "../_shared/http.mjs";

const env = (k: string) => Deno.env.get(k);
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

// consumo na tabela public.consumo (só números, sem conteúdo da conversa; acessível apenas pelo servidor)
const consumo = {
  async registrar(modo, c, quem) {
    if (!c || !c.chamadas) return;
    const { error } = await db.from("consumo").insert({ modo, quem, entrada: c.entrada, saida: c.saida, cache_lido: c.cacheLido, cache_escrito: c.cacheEscrito, buscas: c.buscas, chamadas: c.chamadas, usd: +c.usd.toFixed(5) });
    if (error) console.error("consumo:", error.message);
  },
  async ler() {
    const inicioMes = new Date().toISOString().slice(0, 7) + "-01T00:00:00Z";
    const { data } = await db.from("consumo").select("*").gte("quando", inicioMes);
    const linhas = (data || []).map((r) => ({ quando: r.quando, modo: r.modo, quem: r.quem, entrada: r.entrada, saida: r.saida, cacheLido: r.cache_lido, cacheEscrito: r.cache_escrito, buscas: r.buscas, chamadas: r.chamadas, usd: +r.usd }));
    const v = +(env("LIMITE_DIARIO_USD") || 0);
    return resumirConsumo(linhas, v > 0 ? v : null);
  },
};

// prazo de 110 s por pedido: o Supabase corta em 150 s; perto disso o Marco entrega o que fez e o app pede a continuação
const tratar = criarApi({ env, Anthropic, consumo, prazoMs: 110_000, origens: ["https://cle-travel.github.io", "http://localhost:8090"], exigirAcesso: true });

Deno.serve(tratar);
