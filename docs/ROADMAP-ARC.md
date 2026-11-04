# Roadmap — experiência Arc no Vivarc

Pesquisa e prioridades registradas em 4 de novembro de 2026 para o fork pessoal. A ordem é uma proposta e pode mudar conforme o uso. Não pressupõe que recursos históricos do Arc continuem disponíveis em todas as versões.

## Já disponível no fork

- Sidebar com favoritos, fixados, pastas e abas; spaces baseados em workspaces do Vivaldi.
- Cores e textura independentes por space; troca por Ctrl+1 a Ctrl+9 e transição visual.
- Command palette com busca, ações, temas claro/escuro e tamanho responsivo; barra de endereço acima dos favoritos.
- Peek opcional com movimento personalizado e agrupamento nativo ao promovê-lo; Split View por comandos.

## Próximo: Little Arc

Uma janela compacta e temporária para consultar links sem ocupar a janela principal. Diferente do Peek, deve funcionar como uma janela separada. A experiência desejada inclui fechar a janela, enviar a página para a janela principal e, posteriormente, escolher o space de destino. Abrir links recebidos de outros apps e oferecer um atalho global precisam de investigação específica no macOS; não presumir que possam ser implementados apenas com uma modificação da interface do Vivaldi.

Começar com uma versão acionada explicitamente a partir do Vivarc, com isolamento por perfil, destino seguro e sem alterar o navegador padrão. Avaliar tratamento de links de autenticação, janelas já fechadas, múltiplos monitores e janelas. Fontes: [Arc: Little Arc](https://start.arc.net/master-multitasking) e [Chrome: API de janelas](https://developer.chrome.com/docs/extensions/reference/api/windows).

## Backlog

1. **Arquivamento de abas:** primeiro criar arquivo manual pesquisável com restauração por space; depois avaliar prazo automático configurável e exclusões para fixados, favoritos, áudio, formulários e outros estados sensíveis. Não confundir com hibernação: o [Memory Saver do Vivaldi](https://help.vivaldi.com/desktop/tabs/memory-saver/) mantém a aba aberta.
2. **Command palette:** escolher space/pasta ao mover ou fixar, procurar spaces pelo nome, renomear a aba atual e restaurar a URL original de fixados ou de um space. Verificar o que já existe no Vivaldi antes de duplicar. [Comandos do Arc](https://start.arc.net/command-bar-actions).
3. **Live Folders:** protótipo de pasta para pull requests e issues do GitHub; depois estudar ClickUp, Notion e Drive com permissões e atualização explícitas. [Apresentação do Arc](https://www.youtube.com/watch?v=x1TV6rBi_jM).
4. **Boosts:** gerenciador local de CSS por domínio, com prévia, desativação e exportação; editor visual completo fica para avaliação posterior. [Boosts no Arc](https://start.arc.net/paint-the-internet).
5. **Backup das personalizações:** exportar/importar preferências e temas do Vivarc; estudar sincronização automática e associação segura de spaces em máquinas diferentes. O [Sync do Vivaldi](https://help.vivaldi.com/desktop/tools/sync/) não garante sincronização do armazenamento próprio deste fork.
6. **Personalização de spaces:** gradientes, combinação com papel de parede e melhor acesso a nome, ícone e ordem dos spaces. Verificar funções nativas de [Workspaces do Vivaldi](https://help.vivaldi.com/desktop/tabs/workspaces/).
7. **Easels e capturas vivas:** avaliar um quadro de referências, links e capturas. É uma iniciativa de escopo grande; considerar ferramentas existentes antes de reproduzir. [Easels no Arc](https://start.arc.net/paint-the-internet).

## Usar o que já existe

O Vivaldi oferece [Picture-in-Picture](https://help.vivaldi.com/desktop/media/pop-out-video/), [regras de workspace](https://help.vivaldi.com/desktop/tabs/workspaces/), [abas inativas](https://help.vivaldi.com/desktop/tabs/window-panel/) e [Quick Commands](https://help.vivaldi.com/desktop/shortcuts/quick-commands/). Confirmar disponibilidade e integração na versão instalada antes de planejar uma solução própria.
