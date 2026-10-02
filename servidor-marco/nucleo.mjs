// Núcleo do Marco: conversa com o Claude e executa as ferramentas que rodam no servidor.
// O mesmo arquivo serve ao servidor local (Node) e ao servidor na nuvem (Supabase/Deno).
//
// REGRA DE CONTEXTO E CUSTO (ESPECIFICACAO.md, seção 27). Resumo do que este arquivo garante:
//  R1 Prefixo congelado: o "system" e as ferramentas de cada modo são textos fixos, sem data nem estado.
//     Cada modo tem uma versão (hash); conversa com versão diferente recomeça com resumo (no app).
//  R2 Histórico só cresce: o app guarda as mensagens exatamente como foram enviadas/recebidas e devolve
//     igual. Nada é editado, cortado ou limpo depois (Opus 5.5 e Sonnet 5.5 recusam histórico editado).
//  R3 Contexto da viagem por turno: nunca no system; vai numa mensagem de sistema que se apaga no turno
//     seguinte (clear_at) ou, sem esse recurso, como texto dentro da mensagem do viajante.
//  R4 Cache: ponto fixo no fim do prefixo (1 h, compartilhado por todas as conversas do mesmo modo)
//     + cache automático no fim da conversa.
//  R5 Um modelo por conversa: conversa = Sonnet 5.5; planejamento = Opus 5.5; comprovante, ficha e resumos =
//     Sonnet 5.5 (avulsos, esforço baixo). Haiku fora do app. Nunca troca de modelo dentro de uma conversa.
//  R6 Sem limitar o viajante: o Marco faz de uma vez as consultas independentes (menos passos = menos reenvio de
//     contexto). Há só um teto de segurança alto contra repetição sem fim (defeito), nunca um corte de experiência.
//  R7 Resultados de ferramentas enxutos (teto de caracteres), medidos antes do primeiro envio.
//  R8 Compactação no servidor da Anthropic quando a conversa cresce (não conta como edição).
//  R9 Consumo medido em cada chamada (tokens, cache, buscas na web, custo estimado).

import crypto from "node:crypto";
import { buscarLugar } from "./lugares.mjs";
import { calcularRota } from "./rotas.mjs";

// preços em US$ por milhão de tokens (conferidos na documentação em 01/10/2026; confirmar na página de preços)
export const PRECOS = {
  "claude-opus-5-5": { ent: 4, sai: 20, leit: 0.2, esc5m: 5, esc1h: 8 },
  "claude-sonnet-5-5": { ent: 2, sai: 10, leit: 0.2, esc5m: 2.5, esc1h: 4 },
};
export const PRECO_BUSCA_WEB = 0.01;
export const CREDITOS_ACABARAM = "Os créditos da Anthropic acabaram. Recarregue em console.anthropic.com (conta do Marco) e tente de novo. O resto do app continua funcionando."; // US$ 10 por 1.000 buscas
const TETO_RESULTADO = 1500; // caracteres por resultado de ferramenta (R7)

const BASE = `Você é o Marco, o agente de viagens do app Clé. Fala português do Brasil, com calor humano e objetividade, como um agente experiente que conhece bem o viajante.

CARTÕES POR VOZ: quando a mensagem trouxer "Cartões na tela esperando decisão" e a fala decidir algum deles, use decidir_cartoes primeiro ("sim, pode seguir" depois de você perguntar se pode seguir = aprovar os cartões mostrados). Depois do resultado, siga com o que foi pedido.

REGRA DE OURO: você nunca altera a viagem diretamente. Toda mudança vira uma PROPOSTA por uma ferramenta propor_*; o viajante decide no cartão (Aprovar, Ajustar ou Recusar). Consultas e pesquisas não precisam de aprovação. Toda proposta traz o motivo e o impacto (horário, rota, custo). Depois de propor, diga em uma frase o que propôs. As decisões do viajante sobre os cartões chegam junto com a mensagem seguinte dele.

CONTEXTO DA VIAGEM: chega a cada turno numa mensagem de sistema (viagem, perfil, roteiro em uma linha por dia, checklist, desejos, alertas automáticos, data de hoje). É a fonte da verdade e substitui qualquer versão anterior. Para ver as paradas de um dia, use consultar_dia.

LUGARES E PRECISÃO (nunca apresente uma coordenada duvidosa como certa):
- Antes de propor um lugar novo, use buscar_lugar com o país e a referência do dia. Formule a busca sem anotações, com o parque ou a cidade ("Slough Creek, Yellowstone").
- O resultado traz um selo: verde = fontes concordam; amarelo = aproximado; vermelho = a confirmar. Proponha sempre com o selo devolvido; amarelo ou vermelho: avise que o ponto precisa ser conferido no mapa.
- Para atividades na natureza, informe o ponto de chegada de carro (estacionamento ou início da trilha) quando houver.
- Nunca invente coordenadas, telefones, horários, preços ou regras. Para o que muda (horários, ingressos, fechamentos, clima, regras locais), use a busca na web só quando necessário e cite a fonte de forma curta.

CARTEIRA: lançamentos só por propor_lancamento, valor exato ao centavo, quem pagou e quem divide com os nomes exatos da lista de viajantes. Situação: estimado (previsão), apagar (reservado, paga no local), pago (pago antes da viagem), realizado (pago durante a viagem).

ECONOMIA SEM PERDER QUALIDADE: antes de usar ferramentas, liste mentalmente tudo de que precisa e peça de uma vez, na mesma resposta, todas as consultas que não dependem umas das outras (vários buscar_lugar, calcular_rota e consultar_dia juntos). Não repita buscas já feitas nesta conversa e não consulte dias que não importam ao pedido. Faça o trabalho completo que o pedido exige: economizar é evitar repetição, nunca entregar menos.

FORMA: suas respostas são FALADAS em voz alta pelo app (ou aparecem como legenda curta). No máximo 3 frases curtas, até umas 60 palavras, sem listas, títulos ou markdown. Não enumere muitos itens na fala: cite no máximo 3 e deixe o resto nos cartões ou numa próxima pergunta. Termine com uma pergunta só quando precisar de uma decisão. Se perguntarem sobre o próprio app (por exemplo, por que você parou de falar), responda isso primeiro, em uma frase: a voz pode ter sido desligada pelo botão CC (legendas) ou a conexão pode ter caído; depois siga com a viagem. Dinheiro com centavos no formato brasileiro (US$ 38,50). Datas em português. Horários como 18h30. Se faltar algo essencial, pergunte uma coisa de cada vez. O que veio por voz pode ter nomes distorcidos: confira contra os lugares da viagem e confirme valores ambíguos. Em emergência de saúde ou segurança, oriente primeiro a ligar para o número de emergência do país e a usar a tela Emergência do app; você não faz diagnóstico.`;

const ADENDOS = {
  conversa: `MODO CONVERSA: você atende o dia a dia (dúvidas, lançamentos, tarefas, desejos, ajustes pontuais de uma parada). Quando o pedido exigir montar ou reotimizar um ou mais dias inteiros, reorganizar o roteiro, conciliar desejos do grupo ou resolver alertas de sobrecarga, use encaminhar_ao_planejador com o pedido completo e diga ao viajante, em uma frase, que o planejamento detalhado vem a seguir.`,
  planejamento: `MODO PLANEJAMENTO: você é o motor de roteirização. Use calcular_rota para tempos reais, respeite o perfil (ritmo, máximo de horas dirigindo, hora de acordar, regras inegociáveis, limites, interesses), não mexa nas âncoras (o que já está reservado) sem pedido, preencha as lacunas e proteja os momentos especiais. Monte um dia por propor_dia. Toda proposta encerra a sua resposta e espera a decisão do viajante: por isso faça TODAS as propostas do lote na mesma resposta (os propor_dia lado a lado) e não proponha outra coisa antes dos dias pedidos. Evento ou atração especial que você descobrir (festa, show, temporada) entra no dia certo ou é citado em uma frase. TRABALHE EM LOTES: no máximo 3 dias por resposta (os próximos ainda sem roteiro, ou os que o viajante pediu); ao terminar o lote, diga em uma frase quantos dias faltam e pergunte se pode seguir. Pesquise na web só o indispensável (horários e ingressos que mudam), no máximo 2 buscas por lote. Com mais de um viajante, concilie: interesses comuns viram programa do grupo; divergência forte vira atividade individual em paralelo com ponto e horário de reencontro. Considere os alertas automáticos e corrija-os.`,
  comprovante: `MODO COMPROVANTE: leia o comprovante enviado (foto ou PDF) e proponha, de uma vez, tudo o que ele alimenta: lançamento na Carteira (inclua saldo a pagar no local, caução e taxas), parada ou pernoite no roteiro, tarefa concluída (propor_concluir_tarefa com o id do checklist) e novos lembretes (propor_tarefa), e dados de apoio (propor_info_viagem, ex.: telefone da central do seguro). Diga em uma frase o que leu. Não faça pesquisas.`,
};

const PONTO = { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" } }, required: ["lat", "lng"], additionalProperties: false };
const PARADA = {
  nome: { type: "string", description: "Nome do lugar como deve aparecer no roteiro" },
  horario: { type: "string", description: "Horário de início, formato 18h30" },
  duracao_min: { type: "integer", description: "Tempo no local, em minutos" },
  tipo: { type: "string", enum: ["passeio", "refeicao", "pernoite", "abastecimento", "transito"] },
  endereco: { type: "string", description: "Endereço devolvido por buscar_lugar" },
  lat: { type: "number", description: "Ponto da atividade" },
  lng: { type: "number" },
  selo: { type: "string", enum: ["verde", "amarelo", "vermelho"], description: "Selo devolvido por buscar_lugar" },
  telefone: { type: "string" },
  site: { type: "string" },
  chegada_nome: { type: "string", description: "Ponto de chegada de carro (estacionamento, trailhead), se diferente da atividade" },
  chegada_lat: { type: "number" },
  chegada_lng: { type: "number" },
  trecho_pe_min: { type: "integer", description: "Minutos a pé entre a chegada e a atividade" },
};
const obrigParada = ["nome", "horario", "tipo", "lat", "lng", "selo"];

const T = {
  buscar_lugar: {
    name: "buscar_lugar",
    description: "Busca um lugar real cruzando várias fontes e devolve o ponto escolhido com selo de confiança (verde, amarelo, vermelho), o motivo e até 2 alternativas. Use antes de propor um lugar novo. Não altera a viagem.",
    input_schema: { type: "object", properties: {
      consulta: { type: "string", description: "Nome do lugar com o parque ou a cidade, ou o endereço" },
      forma: { type: "string", enum: ["nome", "endereco"] },
      pais: { type: "string", description: "Código ISO de 2 letras do país" },
      perto_lat: { type: "number", description: "Latitude de referência do dia (hotel ou parada próxima)" },
      perto_lng: { type: "number" },
    }, required: ["consulta"], additionalProperties: false },
  },
  calcular_rota: {
    name: "calcular_rota",
    description: "Distância e tempo reais entre pontos, na ordem dada (de carro ou a pé). Não altera a viagem.",
    input_schema: { type: "object", properties: { pontos: { type: "array", items: PONTO, minItems: 2, maxItems: 25 }, modo: { type: "string", enum: ["carro", "pe"] } }, required: ["pontos"], additionalProperties: false },
  },
  consultar_dia: {
    name: "consultar_dia",
    description: "Devolve as paradas de um dia do roteiro (horário, nome, tipo, duração, selo, coordenadas). Use só para os dias que importam ao pedido. Não altera a viagem.",
    input_schema: { type: "object", properties: { dia: { type: "integer", description: "Número do dia (D1 = 1)" } }, required: ["dia"], additionalProperties: false },
  },
  propor_dia: {
    name: "propor_dia",
    description: "Propõe montar ou reotimizar um dia inteiro (substitui as paradas do dia). O viajante aprova, ajusta ou recusa.",
    input_schema: { type: "object", properties: {
      dia: { type: "integer" }, titulo: { type: "string", description: "Ex.: \"Moab → Arches → Moab\"" },
      paradas: { type: "array", items: { type: "object", properties: PARADA, required: obrigParada, additionalProperties: false } },
      motivo: { type: "string" }, impacto: { type: "string", description: "Horas de direção, horas ativas, custo, o que muda" },
    }, required: ["dia", "titulo", "paradas", "motivo", "impacto"], additionalProperties: false },
  },
  propor_parada: {
    name: "propor_parada",
    description: "Propõe incluir uma parada num dia. O viajante aprova, ajusta ou recusa.",
    input_schema: { type: "object", properties: { dia: { type: "integer" }, ...PARADA, motivo: { type: "string" }, impacto: { type: "string" } }, required: ["dia", ...obrigParada, "motivo", "impacto"], additionalProperties: false },
  },
  propor_lancamento: {
    name: "propor_lancamento",
    description: "Propõe um lançamento na Carteira. O viajante confere e lança.",
    input_schema: { type: "object", properties: {
      descricao: { type: "string" },
      categoria: { type: "string", enum: ["pass", "seg", "hosp", "loc", "comb", "desl", "pas", "ali", "comp", "con", "out"], description: "pass=passagens, seg=seguros e documentos, hosp=hospedagem, loc=locação do carro, comb=combustível, desl=deslocamentos, pas=passeios e ingressos, ali=alimentação, comp=compras, con=conectividade, out=outros" },
      valor: { type: "number" }, moeda: { type: "string", description: "Moeda local da viagem ou BRL" },
      quem_pagou: { type: "string" }, dividir_com: { type: "array", items: { type: "string" } },
      situacao: { type: "string", enum: ["estimado", "apagar", "pago", "realizado"] },
      dia: { type: "integer", description: "0 = antes da viagem" }, motivo: { type: "string" },
    }, required: ["descricao", "categoria", "valor", "moeda", "quem_pagou", "dividir_com", "situacao", "motivo"], additionalProperties: false },
  },
  propor_tarefa: {
    name: "propor_tarefa",
    description: "Propõe uma tarefa no checklist.",
    input_schema: { type: "object", properties: { titulo: { type: "string" }, detalhe: { type: "string" }, grupo: { type: "string", enum: ["Fazer agora", "Até 30 dias antes", "Véspera", "Durante a viagem"] }, motivo: { type: "string" } }, required: ["titulo", "grupo", "motivo"], additionalProperties: false },
  },
  propor_concluir_tarefa: {
    name: "propor_concluir_tarefa",
    description: "Propõe marcar como concluída uma tarefa do checklist (use o id do contexto).",
    input_schema: { type: "object", properties: { id: { type: "string" }, motivo: { type: "string" } }, required: ["id", "motivo"], additionalProperties: false },
  },
  propor_desejo: {
    name: "propor_desejo",
    description: "Propõe um item para a lista de desejos. O viajante responde Quero, Talvez ou Não.",
    input_schema: { type: "object", properties: { nome: { type: "string" }, detalhe: { type: "string", description: "Uma frase que ajude a decidir" }, cidade: { type: "string" } }, required: ["nome", "detalhe"], additionalProperties: false },
  },
  propor_info_viagem: {
    name: "propor_info_viagem",
    description: "Propõe gravar uma informação de apoio (lida de um comprovante ou dita pelo viajante).",
    input_schema: { type: "object", properties: { campo: { type: "string", enum: ["seguro_central", "seguro_apolice", "seguro_nome", "locadora_telefone", "consulado"] }, valor: { type: "string" }, motivo: { type: "string" } }, required: ["campo", "valor", "motivo"], additionalProperties: false },
  },
  // cartões por voz (Wagner, 02/10/2026): a decisão falada sobre um cartão que está na tela
  decidir_cartoes: {
    name: "decidir_cartoes",
    description: "Aplica a decisão que o viajante FALOU sobre cartões que estão na tela esperando resposta (os ids vêm na mensagem, em \"Cartões na tela esperando decisão\"). Use só quando a fala deixar a decisão clara: \"pode aprovar\", \"aprova o dia 2\", \"esse não\", \"sim, pode seguir\" logo depois de você perguntar se pode seguir. Na dúvida, pergunte. O app aplica e devolve o resultado; aí você continua.",
    input_schema: { type: "object", properties: { decisoes: { type: "array", items: { type: "object", properties: {
      id: { type: "string", description: "id do cartão, exatamente como veio na mensagem" },
      decisao: { type: "string", enum: ["aprovar", "recusar", "talvez", "ajustar"] },
      ajuste: { type: "string", description: "Só em ajustar: o que o viajante quer mudar" },
    }, required: ["id", "decisao"], additionalProperties: false } } }, required: ["decisoes"], additionalProperties: false },
  },
  encaminhar_ao_planejador: {
    name: "encaminhar_ao_planejador",
    description: "Encaminha ao planejador (modelo mais potente) um pedido que exige montar ou reotimizar dias inteiros, reorganizar o roteiro ou conciliar desejos do grupo.",
    input_schema: { type: "object", properties: { pedido: { type: "string", description: "O pedido completo, com tudo o que o viajante disse que importa" } }, required: ["pedido"], additionalProperties: false },
  },
  propor_ficha_viagem: {
    name: "propor_ficha_viagem",
    description: "Preenche a ficha da nova viagem com o que o viajante contou. Deixe de fora o que não foi dito.",
    input_schema: { type: "object", properties: {
      destino: { type: "string" }, pais: { type: "string", description: "ISO de 2 letras" }, saindo_de: { type: "string" },
      inicio: { type: "string", description: "AAAA-MM-DD, se dita" }, dias: { type: "integer" },
      viajantes: { type: "array", items: { type: "string" }, description: "Outros viajantes, sem quem fala" },
      ocasiao: { type: "string" }, reservado: { type: "string" }, orcamento: { type: "string" },
      ritmo: { type: "string", enum: ["tranquilo", "equilibrado", "intenso"] }, interesses: { type: "array", items: { type: "string" } },
    }, additionalProperties: false },
  },
};
const busca = (n) => ({ type: "web_search_20260209", name: "web_search", max_uses: n });

// R5/R6: cada modo tem modelo, esforço, passos, ferramentas e duração de cache fixos
export const MODOS = {
  conversa: { modelo: "claude-sonnet-5-5", esforco: "medium", passos: 15, maxTokens: 64000, ttl: "5m", compactarEm: 40000,
    ferramentas: [T.buscar_lugar, T.calcular_rota, T.consultar_dia, T.propor_parada, T.propor_lancamento, T.propor_tarefa, T.propor_concluir_tarefa, T.propor_desejo, T.propor_info_viagem, T.decidir_cartoes, T.encaminhar_ao_planejador, busca(5)] },
  planejamento: { modelo: "claude-opus-5-5", esforco: "medium", passos: 40, maxTokens: 128000, ttl: "1h", compactarEm: 60000,
    ferramentas: [T.buscar_lugar, T.calcular_rota, T.consultar_dia, T.propor_dia, T.propor_parada, T.propor_lancamento, T.propor_tarefa, T.decidir_cartoes, busca(4)] },
  comprovante: { modelo: "claude-sonnet-5-5", esforco: "low", passos: 8, maxTokens: 32000, ttl: "5m", compactarEm: null,
    ferramentas: [T.consultar_dia, T.propor_lancamento, T.propor_parada, T.propor_tarefa, T.propor_concluir_tarefa, T.propor_info_viagem] },
};
for (const [nome, m] of Object.entries(MODOS)) {
  m.system = BASE + "\n\n" + ADENDOS[nome];
  // R1: a versão muda quando o prefixo muda; o app recomeça a conversa (com resumo) em vez de reenviar histórico incompatível
  m.versao = crypto.createHash("sha256").update(m.modelo + "\n" + m.system + "\n" + JSON.stringify(m.ferramentas)).digest("hex").slice(0, 12);
}
const NO_SERVIDOR = new Set(["buscar_lugar", "calcular_rota", "consultar_dia"]);

const INSTR_COMPACTACAO = "Resuma a conversa para continuar o atendimento. Guarde: preferências e restrições ditas pelo viajante, decisões tomadas (aprovado, recusado, pedido de ajuste), perguntas em aberto, o que o Marco prometeu fazer e lugares já pesquisados com o selo. Não copie o roteiro, o checklist nem a Carteira: o app reenvia o estado atualizado a cada turno.";

// recursos em beta descobertos na prática: se a API recusar um, o servidor desliga e segue sem ele
export const RECURSOS = { clearAt: true, compactacao: true, gatilhoCompactacao: true };
const BETA_CLEAR = "mid-conversation-system-clear-at-2026-08-21", BETA_COMPACT = "compact-2026-01-12", BETA_FALLBACK = "server-side-fallback-2026-07-01";

export function custoDe(modelo, u = {}) {
  const p = PRECOS[modelo] || PRECOS["claude-opus-5-5"];
  const c1h = (u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0;
  const c5m = (u.cache_creation && u.cache_creation.ephemeral_5m_input_tokens) ?? Math.max(0, (u.cache_creation_input_tokens || 0) - c1h);
  const buscas = (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
  const usd = ((u.input_tokens || 0) * p.ent + (u.output_tokens || 0) * p.sai + (u.cache_read_input_tokens || 0) * p.leit + c5m * p.esc5m + c1h * p.esc1h) / 1e6 + buscas * PRECO_BUSCA_WEB;
  return { entrada: u.input_tokens || 0, saida: u.output_tokens || 0, cacheLido: u.cache_read_input_tokens || 0, cacheEscrito: c5m + c1h, buscas, usd };
}
const somar = (a, b) => ({ entrada: a.entrada + b.entrada, saida: a.saida + b.saida, cacheLido: a.cacheLido + b.cacheLido, cacheEscrito: a.cacheEscrito + b.cacheEscrito, buscas: a.buscas + b.buscas, usd: a.usd + b.usd, chamadas: a.chamadas + 1 });
const ZERO = { entrada: 0, saida: 0, cacheLido: 0, cacheEscrito: 0, buscas: 0, usd: 0, chamadas: 0 };

/**
 * Um turno do Marco. O app manda:
 *   modo        "conversa" | "planejamento" | "comprovante"
 *   historico   mensagens já enviadas nesta conversa, exatamente como foram (R2)
 *   novas       blocos da nova mensagem do viajante (resultados de cartões, notas, anexo, texto)
 *   contexto    texto compacto da viagem para este turno (R3)
 *   dados       roteiro completo, usado só por consultar_dia (não entra no prompt)
 *   prazoMs     tempo máximo deste pedido (nuvem: o Supabase corta em 150 s); perto dele o servidor entrega o que
 *               já fez com {tipo:"continuar"} e o app pede a continuação com `novas` vazio. Nada é cortado.
 * Eventos: texto, buscando, propostas {anexadas, resultadosServidor}, fim {anexadas}, continuar {anexadas}, erro {codigo}.
 * `anexadas` = tudo o que este turno acrescentou à conversa, byte a byte; o app guarda e reenvia igual.
 */
export async function* turnoMarco({ client, modo, historico, novas, contexto, dados, chaves, Anthropic, prazoMs = 0 }) {
  const t0 = Date.now();
  const M = MODOS[modo]; if (!M) { yield { tipo: "erro", mensagem: "Modo desconhecido." }; return; }
  let consumo = { ...ZERO };
  let tentativa = 0;
  inicio: for (;;) {
    const anexadas = [];
    const ctxTexto = "CONTEXTO DA VIAGEM NESTE TURNO:\n" + (contexto || "(sem viagem aberta)");
    const usuario = { role: "user", content: [...novas] };
    const ctxMsg = () => ({ role: "system", clear_at: "next_user_message", content: ctxTexto });
    // continuação de um pedido longo (novas vazio): o histórico já termina nos resultados das ferramentas
    if (novas.length) {
      if (RECURSOS.clearAt) anexadas.push(usuario, ctxMsg());
      else { usuario.content.push({ type: "text", text: ctxTexto }); anexadas.push(usuario); }
    }
    const msgs = () => [...historico, ...anexadas];
    let fila = [], usosServidor = 0;
    for (let passo = 1; passo <= M.passos + 1; passo++) {
      const betas = [BETA_FALLBACK, ...(RECURSOS.clearAt ? [BETA_CLEAR] : []), ...(RECURSOS.compactacao && M.compactarEm ? [BETA_COMPACT] : [])];
      const req = {
        model: M.modelo, max_tokens: M.maxTokens, betas, fallbacks: "default",
        output_config: { effort: M.esforco },
        cache_control: { type: "ephemeral", ttl: M.ttl }, // R4: automático no fim da conversa
        system: [{ type: "text", text: M.system, cache_control: { type: "ephemeral", ttl: "1h" } }], // R4: prefixo fixo
        tools: M.ferramentas, messages: msgs(),
      };
      if (RECURSOS.compactacao && M.compactarEm) req.context_management = { edits: [{ type: "compact_20260112", instructions: INSTR_COMPACTACAO, ...(RECURSOS.gatilhoCompactacao ? { trigger: { type: "input_tokens", value: M.compactarEm } } : {}) }] };
      let msg;
      try {
        const stream = client.beta.messages.stream(req);
        fila = [];
        stream.on("text", (t) => fila.push({ tipo: "texto", texto: t }));
        stream.on("error", () => {}); // erros chegam pelo finalMessage; a interrupção por tempo não pode derrubar o servidor
        const final = stream.finalMessage();
        let pronto = false;
        final.then(() => { pronto = true; }, () => { pronto = true; });
        while (!pronto || fila.length) {
          // um passo só (ex.: o roteiro inteiro com buscas na web) pode passar do limite da nuvem (150 s) e a conexão
          // cairia no meio ("network error", bug de 02/10/2026). Perto do limite, interrompe e avisa com clareza.
          if (!pronto && prazoMs && Date.now() - t0 > prazoMs + 25000) {
            const parcial = stream.currentMessage; stream.abort();
            if (parcial && parcial.usage) consumo = somar(consumo, custoDe(M.modelo, parcial.usage));
            yield { tipo: "erro", codigo: "tempo", consumo, mensagem: "Essa tarefa ficou grande demais para uma vez só. Vou fazer em partes menores." };
            return;
          }
          if (fila.length) yield fila.shift(); else await new Promise((r) => setTimeout(r, 30));
        }
        msg = await final;
      } catch (e) {
        const status = Anthropic && e instanceof Anthropic.APIError ? e.status : null, texto = String((e && e.message) || "");
        // recurso em beta recusado nesta conta: desliga e refaz o turno do zero (nada foi gravado ainda)
        if (status === 400 && passo === 1 && tentativa < 3) {
          if (RECURSOS.clearAt && /clear_at|role.*system|system.*role/i.test(texto)) { RECURSOS.clearAt = false; tentativa++; console.warn("clear_at indisponível; contexto vai no texto"); continue inicio; }
          if (RECURSOS.gatilhoCompactacao && /trigger/i.test(texto)) { RECURSOS.gatilhoCompactacao = false; tentativa++; console.warn("gatilho de compactação recusado; usando o padrão"); continue inicio; }
          if (RECURSOS.compactacao && /compact|context_management/i.test(texto)) { RECURSOS.compactacao = false; tentativa++; console.warn("compactação indisponível"); continue inicio; }
        }
        if (/credit balance|billing|insufficient/i.test(texto)) { yield { tipo: "erro", consumo, mensagem: CREDITOS_ACABARAM }; return; }
        if (status === 400 && /different conversation|signature/i.test(texto)) { yield { tipo: "erro", codigo: "historico_invalido", mensagem: "A conversa precisou recomeçar.", consumo }; return; }
        yield { tipo: "erro", consumo, mensagem: status === 401 ? "A chave da Anthropic é inválida ou venceu. Crie outra em console.anthropic.com e troque no arquivo servidor-marco/.env." : status === 429 ? "Muitas mensagens em pouco tempo. Tente de novo em instantes." : status === 400 ? "O pedido ao Marco foi recusado (formato)." : "O Marco não conseguiu responder agora. Tente de novo." };
        return;
      }
      consumo = somar(consumo, custoDe(M.modelo, msg.usage));
      anexadas.push({ role: "assistant", content: msg.content });
      if (msg.stop_reason === "refusal") { yield { tipo: "fim", anexadas, consumo, aviso: "O Marco não pode ajudar com esse pedido." }; return; }
      if (msg.stop_reason === "pause_turn") continue;
      const usos = msg.content.filter((b) => b.type === "tool_use");
      if (msg.stop_reason === "max_tokens" && usos.length) { yield { tipo: "erro", consumo, mensagem: "A resposta ficou longa demais. Peça em partes (por exemplo, um dia por vez)." }; return; }
      if (msg.stop_reason !== "tool_use" || !usos.length) { yield { tipo: "fim", anexadas, consumo }; return; }
      if (usos.some((u) => !NO_SERVIDOR.has(u.name))) {
        // propostas: o turno para; as ferramentas do servidor do mesmo passo já vão resolvidas
        const resultados = {};
        for (const u of usos.filter((x) => NO_SERVIDOR.has(x.name))) resultados[u.id] = await executarNoServidor(u, chaves, dados);
        yield { tipo: "propostas", anexadas, resultadosServidor: resultados, consumo };
        return;
      }
      const res = [];
      for (const u of usos) {
        usosServidor++;
        yield { tipo: "buscando", ferramenta: u.name, consulta: u.input && (u.input.consulta || (u.input.dia ? `D${u.input.dia}` : "")) };
        res.push({ type: "tool_result", tool_use_id: u.id, content: await executarNoServidor(u, chaves, dados) });
      }
      // R6: teto de segurança contra repetição sem fim (não é limite de experiência): ao alcançá-lo, o Marco conclui com o que tem
      if (passo >= M.passos) res.push({ type: "text", text: "Muitas consultas seguidas neste pedido: apresente agora o que já tem e diga o que falta, para o viajante pedir a continuação." });
      anexadas.push({ role: "user", content: res });
      if (RECURSOS.clearAt) anexadas.push(ctxMsg()); // o contexto se apagou com o resultado; volta para o próximo passo
      if (prazoMs && Date.now() - t0 > prazoMs && passo < M.passos) { yield { tipo: "continuar", anexadas, consumo }; return; }
    }
    yield { tipo: "erro", consumo, mensagem: "O Marco fez consultas demais seguidas neste pedido e parou por segurança. Peça para ele continuar de onde parou." };
    return;
  }
}

// R7: resultados enxutos e com teto, medidos antes de entrar na conversa (depois nunca são alterados)
const teto = (s) => (s.length > TETO_RESULTADO ? s.slice(0, TETO_RESULTADO) + " …[cortado]" : s);
async function executarNoServidor(uso, chaves, dados) {
  try {
    const i = uso.input || {};
    if (uso.name === "buscar_lugar") {
      if (typeof i.consulta !== "string" || !i.consulta.trim()) return "Erro: consulta vazia.";
      const r = await buscarLugar(i.consulta, { lat: i.perto_lat, lng: i.perto_lng }, chaves, { pais: i.pais, forma: i.forma });
      const p = (x) => x && { nome: x.nome, endereco: x.endereco, lat: x.lat, lng: x.lng, ...(x.telefone ? { tel: x.telefone } : {}), ...(x.site ? { site: x.site } : {}) };
      return teto(JSON.stringify({ selo: r.selo, motivo: r.motivo, ponto: p(r.escolhido), alternativas: (r.alternativas || []).map(p) }));
    }
    if (uso.name === "calcular_rota") {
      const r = await calcularRota(i.pontos, i.modo, chaves);
      return r.erro ? "Erro: " + r.erro : JSON.stringify({ km: r.km, min: r.min, trechos: r.trechos }); // o traçado fica para o app
    }
    if (uso.name === "consultar_dia") {
      const d = ((dados && dados.dias) || []).find((x) => x.dia === i.dia);
      if (!d) return `O dia ${i.dia} não existe nesta viagem.`;
      return teto(`D${d.dia} ${d.data} · ${d.titulo} · ${d.km} km · ${d.min} min de direção\n` + (d.paradas.length ? d.paradas.map((p) => `${p.h || "--"} ${p.n} (${p.t}${p.dur ? ", " + p.dur : ""}, selo ${p.selo}) ${p.lat},${p.lng}`).join("\n") : "(sem paradas)"));
    }
    return `Ferramenta desconhecida: ${uso.name}`;
  } catch (e) {
    return `Erro ao executar ${uso.name}: ${e.message}`;
  }
}

// Tarefas avulsas (sem histórico): ficha do onboarding e resumo para recomeçar uma conversa.
// Sonnet 5.5 com esforço baixo: são raras (centavos por mês) e um resumo ruim perderia preferências do viajante;
// por isso o Haiku 4.5 ficou fora do app (decisão de Wagner, 01/10/2026).
const RAPIDO = "claude-sonnet-5-5";
// Tela "Nova viagem": o Marco conversa por voz e preenche a ficha ao mesmo tempo. A cada fala, responde em
// voz alta (campo resposta) e devolve só o que foi dito para a ficha. Ferramenta própria, para não mexer no
// prefixo congelado dos modos (T.propor_ficha_viagem segue igual).
const FICHA_CONVERSA = {
  name: "responder_e_preencher",
  description: "Responde ao viajante (resposta, lida em voz alta) e preenche a ficha e o perfil com o que ele contou nesta fala.",
  input_schema: { type: "object", properties: {
    resposta: { type: "string", description: "O que o Marco fala em voz alta agora" },
    ...T.propor_ficha_viagem.input_schema.properties,
    // etapa "Ritmo e estilo" (perfil do grupo) e nome da viagem
    acordar: { type: "string", description: "Horário em que acordam nas férias, ex.: 8h00" },
    max_horas_direcao: { type: "number", description: "Máximo de horas dirigindo por dia" },
    regras: { type: "string", description: "Regras inegociáveis, ex.: sem caução em hotel" },
    alimentacao: { type: "string", description: "Restrições alimentares" },
    limites: { type: "string", description: "Medos e limites, ex.: altura, trilhas longas, calor" },
    nao_curtem: { type: "array", items: { type: "string" }, description: "Interesses que NÃO são com eles" },
    nome_viagem: { type: "string" },
    avancar: { type: "boolean", description: "true SOMENTE quando a pessoa confirmou o resumo desta tela ou pediu para seguir/pular: o app passa sozinho para a próxima tela (na última, cria a viagem)" },
  }, required: ["resposta"], additionalProperties: false },
};
// O que cada tela da Nova viagem coleta. O Marco junta as informações da tela e confirma UMA vez, no fim.
const ETAPAS_FICHA = {
  0: "Tela 1, ficha da viagem. ESSENCIAL: para onde (e país), quando começa, quantos dias e quem vai. Opcionais (só os campos da tela, nunca outros): de onde saem, ocasião, o que já está reservado, orçamento.",
  1: "Tela 2, ritmo e estilo: ritmo dos dias (tranquilo, equilibrado ou intenso), horário de acordar, máximo de horas dirigindo por dia, regras inegociáveis, restrições alimentares, medos e limites.",
  2: "Tela 3, interesses PARA ESTA VIAGEM (não gostos da vida): o que o grupo quer fazer neste destino (interesses) e o que não faria nesta viagem (nao_curtem). Se a pessoa falar de gostos gerais, pergunte se valem para esta viagem.",
  3: "Tela 4, situações: a pessoa responde tocando nas opções da tela; tire dúvidas e, quando ela quiser seguir ou pular, avancar = true.",
  4: "Tela 5, resumo final: nome da viagem e ajustes no que já foi preenchido.",
};
const INSTR_FICHA = `Você é o Marco, concierge de viagens do app Clé, conversando por voz com o viajante na tela "Nova viagem". Sua função: guiar e, se a pessoa quiser, fazer por ela todo o planejamento (ficha, roteiro, reservas, gastos, imprevistos).
A cada fala, use a ferramenta responder_e_preencher uma única vez:
1. Preenchimento: só o que foi dito na fala nova (o que já foi anotado vem em "Ficha na tela" e "Perfil"). Datas em AAAA-MM-DD a partir de hoje; país em ISO de 2 letras, deduzido do destino quando óbvio. Nunca invente. Correção vale mais que o anotado antes.
2. resposta: o que você vai FALAR. Português do Brasil, informal, caloroso, como um concierge de confiança. Curta: 1 ou 2 frases. Sem listas, emojis, markdown ou travessão.
REGRA PRINCIPAL, NÃO SE REPETIR: colete tudo o que a tela pede e confirme UMA vez só, no fim.
- Enquanto faltar algo do ESSENCIAL da tela: NÃO repita nem resuma o que já foi anotado. Reconheça em no máximo duas palavras ("Anotado!", "Perfeito.") e pergunte de uma vez, numa frase, tudo o que ainda falta da tela.
- Assim que o ESSENCIAL da tela estiver completo (ou a pessoa disser que é só isso), nesta mesma resposta: faça UM resumo único e curto de tudo o que anotou nesta tela e pergunte se está certo; se faltarem opcionais, convide na mesma frase, sem insistir ("se quiser, me conta também o orçamento"). Nunca pergunte por informação que a tela não tem.
- Se ela corrigir: aplique, diga só o que mudou em poucas palavras e pergunte se agora está certo.
- Se ela confirmar o resumo, ou pedir para seguir ou pular: avancar = true e resposta bem curta (até 4 palavras, ex.: "Fechado, seguimos!"); o app vai sozinho para a próxima tela e eu já faço a pergunta dela. Na tela 5, avancar = true cria a viagem (resposta curta, ex.: "Perfeito, vou criar a viagem!").
- A conversa é contínua: depois de cada resposta eu volto a ouvir sozinho. Não mande tocar em botões.
- Se a pessoa só cumprimentou ou perguntou algo sobre você, responda de verdade e convide a contar (sem resumo).
- Se existe "Sua última fala", a conversa está em andamento: não cumprimente de novo.`;
export async function fichaOnboarding({ client, fala, hoje, quem, ficha, perfil, etapa = 0, ultima }) {
  const lista = (o) => (o && typeof o === "object" ? Object.entries(o).filter(([, v]) => v != null && String(v).trim()).map(([k, v]) => `${k}: ${String(v).slice(0, 200)}`).join("; ") : "");
  const atual = lista(ficha), perf = lista(perfil);
  const msg = await client.messages.create({
    model: RAPIDO, max_tokens: 4000, output_config: { effort: "low" },
    system: INSTR_FICHA,
    tools: [FICHA_CONVERSA],
    messages: [{ role: "user", content: `Hoje: ${hoje}.${quem ? ` Quem fala: ${quem}.` : ""}\nTela atual: ${ETAPAS_FICHA[etapa] || ETAPAS_FICHA[0]}${atual ? `\nFicha na tela: ${atual}.` : ""}${perf ? `\nPerfil já anotado: ${perf}.` : ""}${ultima ? `\nSua última fala: "${ultima}"` : ""}\n\nFala nova do viajante:\n${fala}` }],
  });
  const b = msg.content.find((x) => x.type === "tool_use");
  const texto = msg.content.filter((x) => x.type === "text").map((x) => x.text).join(" ").trim();
  let fichaNova = null, resposta = texto, avancar = false;
  if (b) {
    const { resposta: r, ...resto } = b.input || {};
    if (r) resposta = r;
    if (resto.avancar === true) avancar = true;
    delete resto.avancar;
    if (Object.values(resto).some((v) => v != null && v !== "" && !(Array.isArray(v) && !v.length))) fichaNova = resto;
  }
  return { ficha: fichaNova, resposta: resposta || null, avancar, consumo: { ...somar(ZERO, custoDe(RAPIDO, msg.usage)) } };
}
export async function resumirConversa({ client, texto }) {
  const msg = await client.messages.create({
    model: RAPIDO, max_tokens: 4000, output_config: { effort: "low" },
    system: INSTR_COMPACTACAO + " Escreva em português, em até 250 palavras, em tópicos curtos.",
    messages: [{ role: "user", content: texto.slice(-60000) }],
  });
  const t = msg.content.filter((x) => x.type === "text").map((x) => x.text).join("\n").trim();
  return { resumo: t, consumo: { ...somar(ZERO, custoDe(RAPIDO, msg.usage)) } };
}
