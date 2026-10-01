// Rotas de carro e a pé (Mapbox Directions, camada global do caminho B). A chave fica só no servidor.
// Usada pelo Marco (tempo e distância reais para o impacto de cada proposta) e pelo app
// (traçado da estrada de cada dia, para o mapa e o guia impresso).

const PERFIS = { carro: "driving", pe: "walking" };

// reduz o traçado a no máximo `max` pontos (o app desenha em SVG; não precisa de cada curva)
function simplificar(coords, max = 160) {
  if (coords.length <= max) return coords;
  const passo = (coords.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => coords[Math.round(i * passo)]);
}

/**
 * @param pontos  [{lat,lng}, ...] na ordem do trajeto (2 a 25)
 * @param modo    "carro" | "pe"
 * @returns {km, min, trechos:[{km,min}], poly:[[lat,lng],...]} ou {erro}
 */
export async function calcularRota(pontos, modo, chaves) {
  if (!chaves.MAPBOX_TOKEN) return { erro: "Rotas indisponíveis: falta a chave do Mapbox no servidor." };
  const ps = (pontos || []).filter((p) => p && Number.isFinite(+p.lat) && Number.isFinite(+p.lng));
  if (ps.length < 2) return { erro: "São necessários pelo menos 2 pontos com coordenadas." };
  if (ps.length > 25) return { erro: "No máximo 25 pontos por rota." };
  const perfil = PERFIS[modo] || "driving";
  const cs = ps.map((p) => `${(+p.lng).toFixed(6)},${(+p.lat).toFixed(6)}`).join(";");
  let j = null;
  try {
    const r = await fetch(`https://api.mapbox.com/directions/v5/mapbox/${perfil}/${cs}?geometries=geojson&overview=full&access_token=${chaves.MAPBOX_TOKEN}`, { signal: AbortSignal.timeout(10000) });
    j = await r.json();
  } catch { return { erro: "O serviço de rotas não respondeu." }; }
  const rota = j && j.routes && j.routes[0];
  if (!rota) return { erro: (j && j.message) || "Não há rota entre esses pontos." };
  return {
    km: Math.round(rota.distance / 100) / 10,
    min: Math.round(rota.duration / 60),
    trechos: (rota.legs || []).map((l) => ({ km: Math.round(l.distance / 100) / 10, min: Math.round(l.duration / 60) })),
    poly: simplificar(rota.geometry.coordinates).map(([lng, lat]) => [+lat.toFixed(5), +lng.toFixed(5)]),
  };
}
