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

Primeira vez, logo depois de baixar o projeto, ligue a trava de publicação:

```
git config core.hooksPath .githooks
```

### Regra de colaboração (design)

Colaboradores atuam **só no design**: cores, espaçamentos, tipografia, ícones, imagens, disposição e textos das telas. Lógica, segurança, servidor do Marco, nuvem e rotinas de publicação só mudam com aprovação prévia do Wagner, inclusive voltar a uma versão anterior.

Ninguém envia direto para o `main`. O caminho é este:

1. Faça uma cópia do repositório na sua conta (**Fork**, no topo da página do GitHub) e trabalhe nela.
2. Edite os estilos e as telas em `prototipo/app.html` (ou na Carteira).
3. Suba o último número da versão em `prototipo/versao.json` (ex.: `1.1.1` → `1.1.2`).
4. Rode `node prototipo/montar.mjs` e teste com `node prototipo/servidor.mjs` (http://localhost:8090).
5. Envie para a sua cópia e abra a proposta (**Pull request**) para o `main` daqui.

Ao abrir a proposta, o GitHub compara automaticamente as funcionalidades da sua versão com a versão corrente:
- **Só design:** a proposta entra sozinha e o app publicado se atualiza em cerca de 2 minutos.
- **Muda o funcionamento:** nada é substituído. A proposta fica guardada, recebe a marca **"análise necessária"** e o Wagner é avisado com a lista do que mudou. Ela só entra depois da aprovação dele.

Antes de cada commit, `prototipo/testar.mjs` (testes automáticos) e `prototipo/verificar-publico.mjs` conferem que nada quebrou e que nenhuma chave de API ou dado pessoal vai para este repositório público. Arquivos de viagem para testes ficam na pasta `exemplos/` (que nunca é publicada); a trava usa esses arquivos para saber o que não pode sair.
