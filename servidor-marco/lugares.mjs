// Busca de lugares do Marco: o caminho B validado na validação 1, rodada 3 (validacoes/01-dados-lugares/analisar-v3.mjs).
// As chaves ficam só no servidor.
//
// Camada global (todo país): OpenStreetMap (Nominatim e Photon), Mapbox Search e Foursquare.
// Conectores por país (seção 24 da especificação), somados à camada global quando o destino bate:
//   US → National Park Service. Suíça (swisstopo, MySwitzerland, transporte suíço) entra depois de validada.
//
// Regras do selo (as mesmas da validação):
//   descarta resultado longe do dia (> 250 km da referência), que é área (parque, cidade, bairro...)
//   ou cujo nome não bate com o pedido (metade das palavras do nome devolvido presentes no pedido);
//   escolhe o candidato com mais fontes concordando (até 300 m), empate pela prioridade da fonte;
//   verde = 2+ fontes concordam (ou NPS oficial com nome exato) sem conflito;
//   amarelo = uma fonte só sem conflito, ou consenso com uma fonte discordando;
//   vermelho = nada encontrado, ou fonte única em conflito com outra (> 500 m).

const UA = "Cle/0.1 (+https://github.com/cle-travel/cle-app)"; // exigido pela política de uso do OpenStreetMap
const RAIO_DIA_KM = 250;

function km(a, b) {
  const R = 6371, r = (x) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const diagKm = (s, w, n, e) => km({ lat: +s, lng: +w }, { lat: +n, lng: +e });

const GENERICOS = new Set(["the", "of", "and", "a", "at", "de", "da", "do", "national", "park", "np", "trail", "trailhead", "point", "overlook", "view", "viewpoint", "area", "inn", "hotel", "restaurant", "cafe", "store", "center", "tx", "az", "ut", "nm", "nv", "sd", "wy", "mt", "united", "states", "county"]);
const tokens = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length > 1 && !GENERICOS.has(t) && !/^\d+$/.test(t));
function nomeCompativel(pedido, devolvido) {
  const a = new Set(tokens(pedido)), b = tokens(devolvido);
  if (!b.length) return true;
  return b.filter((t) => a.has(t)).length / b.length >= 0.5;
}
const NOME_AREA = /\b(national park|conservation area|recreation area|state park|national forest|wilderness)\b/i;
const TIPOS_AREA = /boundary|administrative|place\/(city|town|village|county|state|hamlet)|leisure\/(park|nature_reserve)|national_park|protected_area|^(place|locality|region|district|neighborhood|postcode|street|country|block)$/;
const PRIORIDADE_NOME = ["nps", "foursquare", "mapbox", "photon", "nominatim"];
const PRIORIDADE_ENDERECO = ["nominatim", "photon", "mapbox", "foursquare", "nps"];

// região de busca: caixa de ~110 km em volta da referência do dia (hotel ou parada próxima)
function caixa(perto) {
  if (!perto || perto.lat == null || perto.lng == null) return null;
  const dLat = 1, dLng = 1 / Math.max(0.2, Math.cos((perto.lat * Math.PI) / 180));
  return { s: perto.lat - dLat, n: perto.lat + dLat, w: perto.lng - dLng, e: perto.lng + dLng };
}

async function getJson(url, headers = {}) {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA, ...headers }, signal: AbortSignal.timeout(8000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// o Nominatim aceita no máximo 1 pedido por segundo: fila única no servidor
let filaNominatim = Promise.resolve();
const naFilaNominatim = (fn) => { const p = filaNominatim.then(fn); filaNominatim = p.then(() => new Promise((r) => setTimeout(r, 1100)), () => {}); return p; };

// ---------- camada global ----------
async function nominatim(q, R, pais) {
  const cx = R ? `&bounded=1&viewbox=${R.w},${R.n},${R.e},${R.s}` : "";
  const cc = pais ? `&countrycodes=${pais.toLowerCase()}` : "";
  const j = await naFilaNominatim(() => getJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1${cc}${cx}&q=${encodeURIComponent(q)}`));
  const x = j && j[0];
  if (!x) return null;
  const bb = x.boundingbox || [];
  return { lat: +x.lat, lng: +x.lon, nome: x.name || x.display_name, endereco: x.display_name, tipo: `${x.category}/${x.type}`, area: bb.length === 4 ? diagKm(bb[0], bb[2], bb[1], bb[3]) : 0 };
}

async function photon(q, R) {
  const cx = R ? `&bbox=${R.w},${R.s},${R.e},${R.n}` : "";
  const j = await getJson(`https://photon.komoot.io/api/?limit=1${cx}&q=${encodeURIComponent(q)}`);
  const f = j && j.features && j.features[0];
  if (!f) return null;
  const p = f.properties;
  let area = 0;
  if (p.extent) { const [w, n, e, s] = p.extent; area = diagKm(s, w, n, e); }
  const endereco = [p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street, p.city, p.state, p.country].filter(Boolean).join(", ");
  return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], nome: p.name || "", endereco, tipo: `${p.osm_key}/${p.osm_value}`, area };
}

async function mapbox(q, R, pais, chaves) {
  if (!chaves.MAPBOX_TOKEN) return null;
  const cx = R ? `&bbox=${R.w},${R.s},${R.e},${R.n}` : "";
  const cc = pais ? `&country=${pais.toLowerCase()}` : "";
  const j = await getJson(`https://api.mapbox.com/search/searchbox/v1/forward?q=${encodeURIComponent(q)}&limit=1${cc}${cx}&access_token=${chaves.MAPBOX_TOKEN}`);
  const f = j && j.features && j.features[0];
  if (!f) return null;
  return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], nome: f.properties.name, endereco: f.properties.full_address || f.properties.place_formatted || "", tipo: f.properties.feature_type, area: 0 };
}

async function foursquare(q, R, pais, chaves) {
  if (!chaves.FOURSQUARE_API_KEY) return null;
  const cx = R ? `&sw=${R.s},${R.w}&ne=${R.n},${R.e}` : "";
  const j = await getJson(`https://places-api.foursquare.com/places/search?query=${encodeURIComponent(q)}${cx}&sort=RELEVANCE&limit=1`,
    { Authorization: "Bearer " + chaves.FOURSQUARE_API_KEY, "X-Places-Api-Version": "2025-06-17" });
  const f = j && j.results && j.results[0];
  if (!f || f.latitude == null) return null;
  return { lat: f.latitude, lng: f.longitude, nome: f.name, endereco: (f.location && (f.location.formatted_address || f.location.address)) || "", tipo: (f.categories || []).map((c) => c.name).join(","), area: 0, telefone: f.tel || null, site: f.website || null };
}

// ---------- conector EUA: National Park Service ----------
// Fraco para achar pontos (8% na validação), mas quando acha com nome exato é a fonte oficial.
const dentro = (R, lat, lng) => lat >= R.s && lat <= R.n && lng >= R.w && lng <= R.e;
let npsParquesCache = null;
const npsLugaresCache = new Map();
async function nps(q, R, pais, chaves) {
  if (pais !== "US" || !R || !chaves.NPS_API_KEY) return null;
  if (!npsParquesCache) {
    const j = await getJson(`https://developer.nps.gov/api/v1/parks?limit=600&fields=latitude&api_key=${chaves.NPS_API_KEY}`);
    if (!j) return null;
    npsParquesCache = (j.data || []).map((p) => ({ code: p.parkCode, nome: p.fullName, lat: +p.latitude, lng: +p.longitude }));
  }
  let melhor = null;
  for (const p of npsParquesCache.filter((p) => p.lat && dentro(R, p.lat, p.lng))) {
    if (!npsLugaresCache.has(p.code)) {
      const j = await getJson(`https://developer.nps.gov/api/v1/places?parkCode=${p.code}&limit=500&api_key=${chaves.NPS_API_KEY}`);
      npsLugaresCache.set(p.code, ((j && j.data) || []).filter((d) => d.latitude && d.longitude).map((d) => ({ nome: d.title, lat: +d.latitude, lng: +d.longitude })));
    }
    for (const l of npsLugaresCache.get(p.code)) {
      if (!dentro(R, l.lat, l.lng)) continue;
      // todas as palavras do nome oficial precisam estar na busca, e o nome precisa ter 2+ palavras significativas
      const tl = tokens(l.nome), tq = tokens(q);
      const s = tl.length ? tl.filter((t) => tq.includes(t)).length / tl.length : 0;
      const cobre = tl.filter((t) => tq.includes(t)).length / Math.max(1, tq.length);
      if (s >= 0.99 && tl.length >= 2 && (!melhor || cobre > melhor.cobre)) melhor = { ...l, cobre, parque: p.nome };
    }
  }
  // o nome do parque vai no endereço: no nome, "National Park" faria a regra de área descartar o ponto oficial
  return melhor ? { lat: melhor.lat, lng: melhor.lng, nome: melhor.nome, endereco: melhor.parque, tipo: "nps/place", area: 0 } : null;
}

const GLOBAIS = { nominatim, photon, mapbox, foursquare };
const POR_PAIS = { US: { nps } }; // próximos: CH (swisstopo, MySwitzerland), depois de validados

/**
 * @param consulta  texto da busca (nome + parque/cidade, ou endereço)
 * @param perto     {lat,lng} da referência do dia (hotel ou parada próxima); define a região de busca
 * @param chaves    {MAPBOX_TOKEN, FOURSQUARE_API_KEY, NPS_API_KEY}
 * @param opcoes    {pais: código ISO de 2 letras, forma: "nome" | "endereco"}
 */
export async function buscarLugar(consulta, perto, chaves, opcoes = {}) {
  const pais = opcoes.pais ? String(opcoes.pais).toUpperCase() : null;
  const forma = opcoes.forma === "endereco" ? "endereco" : "nome";
  const R = caixa(perto);
  const fontes = { ...GLOBAIS, ...(pais && POR_PAIS[pais]) };
  // Foursquare é base de estabelecimentos: não serve para endereço
  if (forma === "endereco") delete fontes.foursquare;
  const nomes = Object.keys(fontes);
  // como na validação: busca pelo texto completo e, se a fonte não achar, só pelo nome (antes da vírgula);
  // a região do dia já dá o contexto que o complemento ("Yellowstone") daria
  const soNome = forma === "nome" && consulta.includes(",") ? consulta.split(",")[0].trim() : null;
  const tentar = async (f) => (await fontes[f](consulta, R, pais, chaves).catch(() => null)) || (soNome && R ? await fontes[f](soNome, R, pais, chaves).catch(() => null) : null);
  const achados = await Promise.all(nomes.map(tentar));

  const cands = [], descartes = [];
  nomes.forEach((f, i) => {
    const x = achados[i];
    if (!x) return;
    if (perto && perto.lat != null && km(perto, x) > RAIO_DIA_KM) { descartes.push(`${f}: longe da região do dia`); return; }
    if (x.area > 1.5 || TIPOS_AREA.test(x.tipo || "") || (NOME_AREA.test(x.nome || "") && !NOME_AREA.test(consulta))) { descartes.push(`${f}: devolveu uma área, não um ponto`); return; }
    if (forma === "nome" && !nomeCompativel(consulta, x.nome)) { descartes.push(`${f}: nome diferente (${(x.nome || "").slice(0, 40)})`); return; }
    cands.push({ fonte: f, ...x });
  });
  if (!cands.length) return { selo: "vermelho", motivo: descartes.join("; ") || "nenhuma fonte encontrou", escolhido: null, orientacao: "Não há ponto confiável. Peça ao viajante para marcar no mapa ou tente uma busca com o parque ou a cidade." };

  const prio = forma === "endereco" ? PRIORIDADE_ENDERECO : PRIORIDADE_NOME;
  for (const c of cands) c.apoio = cands.filter((o) => o !== c && km(o, c) <= 0.3).map((o) => o.fonte);
  cands.sort((a, b) => b.apoio.length - a.apoio.length || prio.indexOf(a.fonte) - prio.indexOf(b.fonte));
  const e = cands[0];
  const conflito = cands.some((o) => km(o, e) > 0.5);
  let selo;
  if (e.apoio.length >= 1 || e.fonte === "nps") selo = conflito && e.apoio.length < 2 ? "amarelo" : "verde";
  else selo = conflito ? "vermelho" : "amarelo";
  const motivo = [e.apoio.length ? `${e.fonte} + ${e.apoio.join(", ")} concordam` : `só ${e.fonte}`, conflito ? "há fonte discordando" : "", ...descartes].filter(Boolean).join("; ");

  // telefone e site vêm do Foursquare quando ele concorda com o ponto escolhido
  const fsq = cands.find((c) => c.fonte === "foursquare" && km(c, e) <= 0.3);
  const ponto = (c) => ({ fonte: c.fonte, nome: c.nome, endereco: c.endereco, lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6) });
  return {
    selo, motivo,
    escolhido: { ...ponto(e), telefone: (fsq && fsq.telefone) || null, site: (fsq && fsq.site) || null, km_da_referencia: perto && perto.lat != null ? +km(perto, e).toFixed(1) : null },
    alternativas: cands.slice(1).filter((c) => km(c, e) > 0.3).slice(0, 2).map(ponto),
    orientacao: selo === "verde" ? "Ponto confiável: pode propor normalmente." : "Ponto incerto: proponha com este selo e avise que o viajante precisa conferir no mapa.",
  };
}
