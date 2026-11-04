# Estado do Vivarc

Atualizado em 30/10/2026.

## Projeto e instalação

- Fork: https://github.com/gulin-desigenr/vivarc
- Original: https://github.com/KASOGIT/vivarc
- Checkout: `/Users/pedrogulin/Developer/produtos/vivarc`
- Instalação: `~/.vivarc/app` aponta para o checkout. Dados, ajustes, Peek e backups permanecem em `~/.vivarc`.
- O botão Update Vivarc e `python3 ~/.vivarc/app/vivarc.py update` usam o checkout Git, executam `git pull --ff-only` do branch e reaplicam o código. O atualizador não integra mudanças de `upstream` automaticamente.
- Após atualizar o Vivaldi, reabra o Vivarc com Update Vivarc ou feche o navegador, rode `python3 vivarc.py apply` e abra-o novamente. A alteração do instalador original pode remover a injeção.

## Personalizações

- Troca de spaces vazios usa a ativação nativa do workspace e abre a command bar após a ativação; a falha original foi relatada na issue upstream #54.
- Clique duplo dentro da barra lateral não aciona o comando nativo de nova aba; relatado na issue upstream #55.
- Pastas expandem e recolhem em 220 ms, respeitando `prefers-reduced-motion`.
- A opção Sidebar wallpaper usa o papel de parede do tema do Vivaldi somente na barra lateral; pode ser desativada nas configurações do Vivarc.
- O Peek mantém os arquivos originais verificados e recebe uma camada local de movimento em `src/optional/peek-motion.js`, aplicada na montagem do bundle.
- Ao promover uma prévia, `src/optional/peek-groups.js` tenta agrupá-la nativamente com a aba de origem; a barra lateral exibe pilhas e oculta abas temporárias do Peek.
- O acionamento interno de workspace depende de implementação privada do Vivaldi e deve ser revalidado após atualizações do navegador.
- Pesquisa, recursos e prioridades para aproximar o fork do Arc estão em `docs/ROADMAP-ARC.md`; o próximo trabalho escolhido é Little Arc.
- Little Vivarc (`src/js/15-little-arc.js`): o comando "Open Little Vivarc" abre a aba atual numa janela popup compacta, centralizada na tela em que está o ponteiro do mouse; o botão "Open in main window ↗" move a aba de volta à janela de origem, no space ativo. A transferência é executada pela janela de origem (via `BroadcastChannel`), porque a popup se fecha ao perder sua última aba.
- Links de outros apps abrem no Little Vivarc (ajuste "Little Vivarc for other apps", ligado por padrão). O Chromium não marca abas externas: no macOS elas chegam como `link` (testado via histórico), então a aba é considerada externa quando não tem opener, não foi criada pela UI (as chamadas `chrome.tabs/windows.create` da janela são carimbadas), surge mais de 5 s após a abertura do navegador e o primeiro commit é `link`/`auto_toplevel`. Revalidar após atualizações do Vivaldi.
- A tela do ponteiro vem de um helper local (`src/native/pointer.py`, só biblioteca padrão + CoreGraphics): a UI do Vivaldi não tem permissão `nativeMessaging` (conferido em `Secure Preferences`), mas pode fazer `fetch`, então `install`/`apply` copiam o script para `~/.vivarc/native/vivarc-pointer.py` e o mantêm rodando em `127.0.0.1:47391` pela LaunchAgent `com.vivarc.pointer`; `uninstall` remove ambos. O helper recusa Origin de páginas web e Host diferente de localhost. Sem ele, a popup abre na tela da janela de origem.
- A aba externa entra na popup no `chrome.windows.create({ tabId })`, sem recarregar (testado em 04/11/2026). `chrome.tabs.move` e `chrome.tabs.create` para uma popup mandam a aba para uma janela normal; se o `create` falhar ou a aba ficar na janela principal, a popup abre pela URL e a aba original é fechada.
- A barra lateral só se redesenha com eventos de abas da própria janela e adia o redesenho enquanto um botão está pressionado; antes, trocar o DOM entre mousedown e mouseup engolia cliques nos spaces.
- Fechar a aba ativa (ou mandá-la ao Little Vivarc) mantém o space, como no Arc: se o Vivaldi ativar uma aba de outro space, a mais recente do space original volta (`workspaces.stayIn`); se o space ficou vazio, ele é reativado. Ao trocar de space, se o Vivaldi ignorar a ativação (achando que já está no workspace), a aba mais recente do destino é ativada diretamente.
- Semáforo no estilo do Arc (`src/js/09-window-controls.js`, ajuste "Window controls in the sidebar"): com abas na lateral e barra de endereço oculta, o Vivaldi põe os botões numa barra de título que o auto-hide só mostra no topo. O Vivarc esconde o `#header` e a cópia de `#titlebar` que o auto-hide mostra em `.auto-hide-wrapper.top` ao encostar no topo, e força `windowPrivate.setControlButtonsPosition(..., "mediumPadding")`; como parte das chamadas do Vivaldi não passa pelo wrapper, a posição é reafirmada em foco, resize, ponteiro no topo e a cada 2 s. Linha 1 da barra lateral: semáforo, menu de abas, voltar, avançar, recarregar; linha 2: endereço; linha 3: extensões (ordem por CSS). Com um tema de space, a moldura da janela (faixa sob a barra lateral e cantos) usa a mesma cor (`--vm-tint` no `#browser`).
- Barra do Little Vivarc no lugar do título: voltar, avançar, recarregar, endereço editável (URL ou busca no buscador padrão do Vivaldi via `vivaldi.searchEngines`; `chrome.search` não existe na UI) e "Open in Vivarc". Comando "New Little Vivarc" abre em branco com o endereço em foco; "Open Page in Little Vivarc" leva a página atual. O Vivaldi reescreve as classes de `#browser`, então `vm-little-arc` é recolocada a cada `onMark`.
- Atalho global ⌥⌘N (como o Little Arc), registrado pelo helper com Carbon `RegisterEventHotKey` (não pede permissão de Acessibilidade). O helper abre `http://127.0.0.1:47391/little/new` no Vivaldi e o Vivarc troca essa aba por um Little Vivarc em branco com o endereço em foco; com o Vivaldi fechado, o helper o abre e espera 5 s antes. Como é global, o atalho tem prioridade sobre o ⌥⌘N de outros apps (ex.: "Nova Pasta Inteligente" do Finder). `install_pointer_helper` repete o `bootstrap` porque o `bootout` termina de forma assíncrona.

## Verificação

`python3 vivarc.py status` verifica a injeção e o perfil. Os testes automatizados são executados com `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests`; testes de interface devem cobrir pastas, Cmd+T e troca de spaces.
