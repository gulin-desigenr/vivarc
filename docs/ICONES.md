# Ícones do Vivaldi

Levantamento de 18/11/2026 (Vivaldi 8.3.4191.45) de todos os ícones que a interface do Vivaldi desenha, para redesenhá-los no estilo do Vivarc. Os ícones aparecem em `docs/icones/catalogo-vivaldi.html` (abra no navegador), agrupados por área, com o número de cada um e as pistas de onde ele aparece.

## Onde os ícones ficam

- **Todos os ícones da UI** são SVGs soltos em `background-common-bundle.js`, cada um num módulo do webpack (`<número>:e=>{e.exports='<svg …>'}`). São **583 SVGs, 582 diferentes**. Um índice no mesmo arquivo os exporta com nomes minificados (`$II`, `g0V`…), às vezes em trios `{small, medium, large}`. O `bundle.js` da janela usa esses nomes. Os números dos módulos e os nomes minificados mudam entre versões do Vivaldi, então servem para o levantamento, nunca como seletor no código.
- O React insere o SVG como marcação dentro do botão. Por isso, o caminho para trocar um ícone é o que o Vivarc já usa nos painéis (`21-panels.css`) e em Voltar, Avançar e Abas (`01-vivaldi-toolbar.css`): esconder o `svg` do Vivaldi e desenhar o nosso com `mask` (em `::before` ou no próprio botão) a partir de um SVG em `data:`, pintado com `currentColor`. O seletor é o do elemento estável em volta do ícone (`[data-name="…"]`, classe do botão, `title`), nunca o desenho.
- Tamanhos: 249 ícones são de 16 × 16 (listas, menus, campos), 65 de 28 × 28 (botões das barras e dos painéis), 22 de 18 × 18 (categorias das Configurações, coloridos) e o resto varia. Os 145 sem tamanho declarado têm só `viewBox`.

## Números

| Área (estimada) | Ícones |
| --- | --- |
| Na janela principal, com o Vivarc ativo | 59 (38 visíveis ao mesmo tempo) |
| Navegação (voltar, avançar, recarregar, início) | 11 |
| Barra de endereço (site, favorito, leitor, traduzir, bloqueios) | 11 |
| Abas, pilhas e lado a lado | 27 |
| Painéis | 45 |
| Barra de status e ferramentas (extensões, captura, zoom, sync, perfil) | 72 |
| Favoritos, downloads, histórico, notas | 36 |
| Diálogos e popups | 9 |
| Configurações | 51 |
| Editor de texto (notas e mail) | 30 |
| Mail, Calendar, Feeds e Contatos | 130 |
| Sem contexto, a identificar ao vivo | 143 |
| Não usados pela janela | 18 |

A área vem de uma estimativa automática: os textos em volta de cada uso do ícone em `bundle.js` (nomes de botões, comandos, classes, rótulos). Ela erra nos ícones usados em vários lugares. A lista "Na janela principal" é a confiável: veio do DOM do Vivaldi Dev, comparando o desenho de cada `svg` da tela com o catálogo.

## Já redesenhados pelo Vivarc

- Barra de painéis: Favoritos, Downloads, Histórico, Notas, Traduzir, Janela, Lista de leitura, Mail, Contatos, Calendar, Tarefas, Feeds, painéis web e "+" (`21-panels.css`).
- Barra das abas: Voltar, Avançar e o botão de abas (`01-vivaldi-toolbar.css`).
- Grupo 1 (`24-icons.css`): Extensões, Recarregar e Parar na linha de cima da sidebar; Alternar painel, Downloads e Atualização na linha de baixo; Feeds, Modo de leitura, Traduzir e Favorito (vazio e preenchido) na barra de endereço; o fechar dos painéis.
- Grupo 2 (`24-icons.css`): barras dos painéis (adicionar, remover, nova pasta, limpar, pausar, retomar, marcar como lido, opções), barra do editor de notas (captura, anexo, Markdown, abrir em aba) e a seta de todos os menus suspensos (`.select-wrapper::after`), nos painéis, nos diálogos e nas Configurações.
- Grupo 3 (`24-icons.css` e `21-panels.css`): balões da barra e do endereço. Informações do site (cadeado, cookies, configurações, link externo, JavaScript, relatório de privacidade, engrenagem e a seta das linhas), Traduzir (fechar, opções), perfil (seta, gerenciar perfis, convidado) e o seletor de pasta do favorito (busca, pastas e chevrons das árvores, os mesmos dos painéis).
- Grupo 4 (`24-icons.css`): Configurações. Os 22 ícones coloridos das seções viraram ícones de linha numa cor só, escolhidos pelo fim do id da linha (`[id$="__general"]` etc.), e os botões de dentro das páginas (adicionar, remover, subir e descer item, fechar o aviso de doação) são achados pelo desenho do Vivaldi.
- Tudo o que o Vivarc desenha por conta própria: sidebar, command bar, pastas, Little Vivarc, configurações do Vivarc (`src/js/10-sidebar/12-icons.js` e glifos no CSS).

## Prioridade para redesenhar

1. **Janela principal** (os 59 marcados em azul no catálogo): recarregar, extensões, informações do site, estrela de favorito, traduzir, modo leitura, alternar painel, atualização, nova aba, pastas e chevrons das árvores, downloads.
2. **Balões e diálogos** que já ganharam o visual do Vivarc: site, favorito, traduzir, permissões, download, sessões.
3. **Painéis abertos**: barras de ferramentas internas de Favoritos, Downloads, Histórico, Notas e Janela (ordenar, nova pasta, apagar, buscar).
4. **Configurações**: os 18 × 18 coloridos das categorias e os ícones das seções.
5. **Mail, Calendar e Feeds**: só se forem ligados, porque estão desligados nos painéis do Vivarc.

## Família visual

- **Grade de 16 px, traço de 1,5 px**: tudo o que fica na sidebar, na barra de endereço (desenhado a 14 px), nos painéis e nos diálogos. É a grade dos chevrons de Voltar e Avançar.
- **Grade de 24 px, traço de 1,6 px, desenhada a 20 px**: só a barra de painéis da direita, como já é.
- Pontas e junções arredondadas, sem preenchimento (um estado ligado pode preencher, como o favorito), cor do texto (`currentColor`) pela máscara, a 80% na sidebar e a 75% na barra de endereço, 100% no hover.
- Ícones coloridos das Configurações: viram monocromáticos, como o resto.
- Ícones que mostram estado em cor ficam com o Vivaldi até haver um desenho que mostre o mesmo estado: hoje, o escudo de informações do site (segurança e nível de bloqueio).

## Fora do alcance

- Ícones dos sites (favicons) e dos apps web.
- Ícones de menus nativos do macOS e de balões nativos do Chromium (as mesmas telas da seção "Fora do alcance do CSS" de `JANELAS-NATIVAS.md`).
- Páginas `chrome://`, que têm ícones próprios.

## Ícone do app (Dock)

O ícone do Vivarc foi desenhado no Figma ([GULIN.CO] APPs, página Vivarc, nó 74:2): o ícone do Vivaldi com o degradê roxo e rosa do Vivarc. O SVG exportado está em `src/icon/vivarc-icon.svg`; o `src/icon/Vivarc.icns` o põe na grade de ícones do macOS (824 de 1024 px), para ter o mesmo tamanho dos outros apps no Dock. Para trocar, exporte o SVG de novo, gere o `.icns` e rode `apply`. `install`, `apply` e a reinstalação automática (`reapply_quietly`) o colocam no `Vivaldi.app` como ícone personalizado do pacote, pelo `NSWorkspace setIcon` (JavaScript for Automation, sem dependências). Uma atualização do Vivaldi troca o pacote e leva o ícone junto; a reinstalação automática o devolve, no mesmo fluxo que reinjeta o Vivarc. O `Assets.car` e o `app.icns` do Vivaldi não são tocados, e o `uninstall` tira o ícone. O Vivaldi Dev fica com o ícone do Vivaldi, para os dois não se confundirem no Dock. O Dock mostra o ícone novo quando o Vivaldi reabre.
