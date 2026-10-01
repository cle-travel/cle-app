# Clé

Planeje e viva a viagem conversando com o Marco, seu agente de viagens.

**Abrir o app:** https://cle-travel.github.io/cle-app/
No celular, abra o endereço no Chrome (Android) ou no Safari (iPhone) e use **Instalar app** / **Adicionar à Tela de Início**. Depois da primeira abertura, funciona sem internet.

O app é instalado vazio. Cada pessoa cria a sua viagem com o Marco ou abre um arquivo da viagem. Os dados ficam só no aparelho e no arquivo da viagem; nada fica guardado neste repositório.

## Para quem colabora

| Pasta | O que é |
|---|---|
| `prototipo/app.html` | O molde do app (telas, estilos e lógica) |
| `prototipo/carteira/` | O módulo Carteira |
| `prototipo/montar.mjs` | Gera o app publicado em `app/` |
| `prototipo/servidor.mjs` | Servidor local para testar em `http://localhost:8090` |
| `app/` | O app publicado (gerado; não editar à mão) |

Fluxo:
1. Edite `prototipo/app.html` (ou a Carteira).
2. Rode `node prototipo/montar.mjs` e teste com `node prototipo/servidor.mjs`.
3. Crie um branch, faça o commit e abra um Pull Request. A publicação acontece quando o Pull Request é aprovado.

Antes de cada commit, `prototipo/verificar-publico.mjs` confere que nenhuma chave de API ou dado pessoal vai para este repositório público.
