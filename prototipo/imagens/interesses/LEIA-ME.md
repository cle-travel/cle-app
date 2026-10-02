# Fotos da tela "Do que vocês gostam?"

Coloque aqui uma foto para cada interesse (16), com o **nome do arquivo exatamente como na lista** abaixo.
Na próxima montagem (`node prototipo/montar.mjs`), o app passa a usar as fotos sozinho. Interesse sem foto
continua com um degradê sóbrio no lugar.

| Interesse | Nome do arquivo |
|---|---|
| Natureza e parques | `natureza-e-parques.webp` |
| Trilhas | `trilhas.webp` |
| Cidades | `cidades.webp` |
| Museus e história | `museus-e-historia.webp` |
| Gastronomia | `gastronomia.webp` |
| Compras | `compras.webp` |
| Fotografia | `fotografia.webp` |
| Cultura local | `cultura-local.webp` |
| Shows e música | `shows-e-musica.webp` |
| Esportes | `esportes.webp` |
| Parques temáticos | `parques-tematicos.webp` |
| Aventura radical | `aventura-radical.webp` |
| Vida noturna | `vida-noturna.webp` |
| Praia | `praia.webp` |
| Bem-estar | `bem-estar.webp` |
| Carros e estradas cênicas | `carros-e-estradas-cenicas.webp` |

Pode ser `.webp`, `.jpg`, `.png` ou `.avif` (o nome antes do ponto é o que importa).

## Especificação

- **Tamanho:** 1080 × 2160 px (proporção 1:2, em pé).
- **Formato:** WebP com qualidade 80 (preferido) ou JPG com qualidade 80 a 85; cores sRGB.
- **Peso:** até 350 KB por foto. A montagem avisa quando passar de 700 KB.
- **Área segura:** deixe o assunto principal dentro do **retângulo central com 55% da largura e 85% da altura**.
  - No celular o cartão é estreito e alto, e as laterais da foto são cortadas.
  - No dobrável aberto (Z Fold) o cartão fica mais largo e baixo, e corta um pouco em cima e embaixo.
- **Faixa de baixo:** os 25% de baixo ficam sob um degradê escuro com o nome do interesse e o botão de escolha. Evite detalhes importantes ali; céu, chão ou água funcionam bem.
- **Direitos de uso:** o repositório do app é público. Use fotos próprias ou com licença livre (Unsplash, Pexels), sem pessoas identificáveis sem autorização.

## Ponto de foco de cada foto (`foco.json`)

No celular o cartão mostra só uma faixa vertical da foto. `foco.json` diz onde essa faixa fica, por foto:
`"0% 50%"` = encostada na esquerda, `"50% 50%"` = centro, `"100% 50%"` = encostada na direita.
Valores de 02/10/2026: escolhidos comparando o recorte central com o automático, foto a foto, para manter a
pessoa (ou o assunto) dentro do cartão. Foto nova sem linha no `foco.json` fica centralizada.

## Situação atual (02/10/2026)

As 16 fotos estão aqui em WebP (1024 × 1536, qualidade 80, 109 a 248 KB cada). Os PNG originais enviados por Wagner ficam guardados fora do repositório, em `design/fotos-interesses-originais/` (inclui `fotografia_nao_usar.png`, que não é usada).
