# Como publicar uma versão do Vivarc

Roteiro para qualquer agente ou pessoa. Siga os passos na ordem. Se um passo falhar, pare e relate o erro em vez de improvisar.

**Só publique quando o usuário pedir.** Uma release é pública e chega às instalações de outras máquinas.

## O que uma versão é

- Um número em `VERSION` (`vivarc.py`, perto da linha 30).
- Uma seção no topo do `CHANGELOG.md`.
- Uma tag `vX.Y.Z` no `origin` (`gulin-desigenr/vivarc`).
- Uma release no GitHub com essa tag.

**Quem recebe:** instalações sem Git, feitas pelo `install.sh`. O Update Vivarc compara `VERSION` com a última release do fork (`RELEASES_LATEST` em `vivarc.py`) e atualiza se ela for mais nova. Com o lembrete ligado, o Vivarc também oferece a nova versão, uma vez por versão.

**Quem não recebe:** a instalação vinculada ao checkout (`~/.vivarc/app` aponta para este repositório). Ela atualiza com `git pull --ff-only` e ignora as releases.

**Pendência conhecida:** o `install.sh` ainda baixa o `main`, não a tag (`install.sh`, bloco `URL=`). Até isso mudar, quem atualiza recebe o `main` do momento, e não exatamente a release. Por isso o `main` nunca deve ficar com trabalho pela metade.

## Numeração

- Use `X.Y.Z`, só com dígitos. Um sufixo como `-beta` faz `is_newer` falhar, e a versão é ignorada pelo atualizador.
- A série do fork começa em **1.0.0**. Nunca use `0.1.x`, porque essas tags são do upstream (`KASOGIT/vivarc`).
- **Z (correção):** só conserta algo que não funcionava.
- **Y (função):** função nova ou mudança visível no uso.
- **X (ruptura):** exige uma ação do usuário, ou muda o formato de dados guardados (`state.json`, `config.json`, backups, o `bootstrap` do store) sem migração automática.
- Suba um número por vez, a partir da última release publicada. Nunca pule nem volte.

## Configuração única (uma vez por clone)

Impede que as tags do upstream entrem no repositório e apaga as que já entraram (elas não existem no `origin`):

```bash
git config remote.upstream.tagOpt --no-tags
git tag -l | while read -r t; do
  git ls-remote --exit-code --tags origin "refs/tags/$t" >/dev/null || git tag -d "$t"
done
```

## Antes de publicar

1. **Branch e sincronia:** esteja no `main`, com a árvore limpa e igual ao `origin`.
   ```bash
   git switch main && git fetch origin && git status -sb
   ```
   A primeira linha deve ser `## main...origin/main`, sem `ahead` nem `behind`, e não deve haver arquivos listados.
2. **Testes:** todos devem passar.
   ```bash
   PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests
   ```
3. **Vivaldi Dev:** rode `tools/dev-vivaldi.sh restart` e confira a sidebar, os spaces, a command bar, o Little Vivarc e as Vivarc Settings. Nunca valide no Vivaldi principal.
4. **O que entra na versão:**
   ```bash
   git log "$(git describe --tags --abbrev=0 --match 'v[1-9]*')"..HEAD --oneline
   ```
   Na **primeira release (1.0.0)** ainda não existe tag do fork. Use a base 0.1.16 do upstream: `git log c0d82c3..HEAD --oneline`. Use também a seção "Personalizações" do `ESTADO.md` para resumir o que o fork mudou.
5. Se nada mudou para quem usa (só documentação, testes ou ferramentas), não publique.

## Passos

Defina o número uma vez e use a variável nos comandos:

```bash
V=1.0.1   # o número escolhido, sem "v"
```

1. **`VERSION`:** em `vivarc.py`, troque para `VERSION = "$V"`.
2. **`CHANGELOG.md`:** acrescente no topo uma seção `## X.Y.Z - AAAA-MM-DD`, com a data de hoje.
   - Escreva em inglês, como o resto do arquivo.
   - Escreva para quem usa: o que muda no uso, e não como foi feito.
   - Função nova: o nome em **negrito**, como aparece na interface.
   - Correção: comece com `Fix:`.
   - Use as seções existentes como modelo.
3. **`ESTADO.md`:** atualize a linha "Atualizado em" (data e versão do Vivaldi) e registre a versão publicada em "Projeto e instalação".
4. **Testes outra vez:** alguns testes leem `VERSION`.
   ```bash
   PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests
   ```
5. **Commit:** a mensagem é exatamente `chore: release X.Y.Z`, sem linhas de coautoria nem de atribuição a IA.
   ```bash
   git add vivarc.py CHANGELOG.md ESTADO.md
   git commit -m "chore: release $V"
   ```
6. **Tag anotada:**
   ```bash
   git tag -a "v$V" -m "Vivarc $V"
   ```
7. **Envio:** primeiro o branch, depois só a tag nova. Nunca use `git push --tags`, que enviaria qualquer tag local, incluindo as do upstream.
   ```bash
   git push origin main
   git push origin "v$V"
   ```
8. **Release no GitHub:** as notas são a seção do CHANGELOG. Não marque como rascunho nem como pré-release: a página `releases/latest`, que o atualizador consulta, ignora as duas.
   ```bash
   NOTES="$(mktemp)"
   awk -v h="## $V " 'index($0, h) == 1 {f = 1; next} /^## / {f = 0} f' CHANGELOG.md > "$NOTES"
   gh release create "v$V" -R gulin-desigenr/vivarc --title "Vivarc $V" --notes-file "$NOTES" --latest
   rm -f "$NOTES"
   ```

## Conferir

```bash
curl -sIL -o /dev/null -w '%{url_effective}\n' https://github.com/gulin-desigenr/vivarc/releases/latest
gh release view "v$V" -R gulin-desigenr/vivarc
```

O primeiro comando deve terminar em `/releases/tag/vX.Y.Z`. Se terminar em `/releases`, não há release publicada (ou ela ficou como rascunho ou pré-release), e o atualizador vai considerar o Vivarc em dia.

## Se algo der errado

- **Antes do `git push`:** corrija o arquivo, refaça o commit com `git commit --amend` e recrie a tag (`git tag -d "v$V"` e depois o passo 6).
- **O push foi feito, mas o `gh release create` falhou:** rode só o passo 8 de novo.
- **Depois de publicada:** nunca apague, mova nem reaproveite uma tag publicada. Instalações que já atualizaram não voltam. Corrija num commit novo e publique a próxima versão de correção.
