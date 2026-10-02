# Fotos da tela "Do que vocês gostam?"

Coloque aqui uma foto para cada interesse, com o **nome do arquivo exatamente como na lista** abaixo.
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
| Shows e esportes | `shows-e-esportes.webp` |
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
