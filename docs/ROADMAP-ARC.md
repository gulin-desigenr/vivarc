# Roadmap — experiência Arc no Vivarc

Pesquisa e prioridades registradas em 4 de novembro de 2026 para o fork pessoal. A ordem é uma proposta e pode mudar conforme o uso. Não pressupõe que recursos históricos do Arc continuem disponíveis em todas as versões.

## Já disponível no fork

- Sidebar com favoritos, fixados, pastas e abas; spaces baseados em workspaces do Vivaldi.
- Cores e textura independentes por space; troca por Ctrl+1 a Ctrl+9 e transição visual.
- Command palette com busca, ações, temas claro/escuro e tamanho responsivo; barra de endereço acima dos favoritos.
- Peek opcional com movimento personalizado e agrupamento nativo ao promovê-lo; Split View por comandos.

## Feito depois da pesquisa

- **Little Arc → Little Vivarc** (novembro de 2026): janela compacta na tela do ponteiro, links de outros apps, atalho global ⌥⌘N e "Open in Vivarc". Detalhes em `ESTADO.md`.
- **Arquivamento de abas** (novembro de 2026): arquivo manual pesquisável pela command bar, restauração no space de origem, Clear arquivando e arquivamento automático configurável (padrão 12 h).
- **Command palette** (novembro de 2026): mover a aba para outro space, trocar de space pelo nome, fixar em uma pasta, renomear a aba e voltar à página original do fixado.
- **Backup das personalizações** (novembro de 2026): exportar/importar arquivo e cópia diária automática em `~/.vivarc/backups`, com temas associados aos spaces pelo nome.
- **Tidy Tabs, versão local** (novembro de 2026): agrupar abas soltas em pilhas com nome por site, origem e palavras do título, com Undo. Uma versão com IA (Claude por chave de API, ou LM Studio local) fica como próximo passo, se a local não bastar.
- **Personalização de spaces** (novembro de 2026): editor do space com nome, emoji e tema em degradê de até 3 cores; reordenar arrastando; criar space pelo "+". Combinação com papel de parede ficou de fora.

## Backlog

- **Redesign das configurações do Vivarc** (pedido em 2026-11-09): a janela "Vivarc Settings" é uma lista longa de interruptores com textos longos. Agrupar por assunto (aparência, sidebar, command bar, abas, Little Vivarc), encurtar os textos e seguir o visual novo (DM Sans, cantos maiores). Fazer o desenho no Figma antes.
1. **Tradução para português:** interface do Vivarc em pt-BR (command bar, menus, ajustes, avisos, Little Vivarc), seguindo o idioma do Vivaldi e mantendo o inglês como fallback. Hoje todos os textos estão em inglês dentro dos módulos; centralizar as strings antes de traduzir.

## Ignorados

Decisão do usuário em 2026-11-07: não serão implementados.

- **Live Folders:** pasta que se atualiza com pull requests e issues do GitHub (e depois ClickUp, Notion, Drive). [Apresentação do Arc](https://www.youtube.com/watch?v=x1TV6rBi_jM).
- **Boosts:** CSS local por domínio, com prévia, desativação e exportação. [Boosts no Arc](https://start.arc.net/paint-the-internet).

## Ideias guardadas

- **Pilha com a aba de origem como linha do grupo** (ramo `design/stack-tab-header`, commit `7e1b555`): a primeira aba da pilha é a própria linha, com "2 ›" no fim para dobrar, e as outras recuadas embaixo. Ficou guardada; a versão em uso (título que só dobra, origem dentro, Save as Pinned Folder) é a atual. Pode virar um ajuste para escolher o estilo.

## Usar o que já existe

O Vivaldi oferece [Picture-in-Picture](https://help.vivaldi.com/desktop/media/pop-out-video/), [regras de workspace](https://help.vivaldi.com/desktop/tabs/workspaces/), [abas inativas](https://help.vivaldi.com/desktop/tabs/window-panel/) e [Quick Commands](https://help.vivaldi.com/desktop/shortcuts/quick-commands/). Confirmar disponibilidade e integração na versão instalada antes de planejar uma solução própria.
