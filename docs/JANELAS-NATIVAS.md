# Janelas nativas do Vivaldi

Levantamento de 18/11/2026 (Vivaldi 8.3.4191.44) de tudo o que o Vivaldi abre por conta própria: diálogos, balões, popups, barras e sobreposições. O objetivo é aplicar o visual do Vivarc em cada um. A lista saiu do `bundle.js` e do `style/common.css` do próprio Vivaldi (componentes, classes e textos de título) e foi cruzada com `src/css/` para ver o que o Vivarc já cobre.

O padrão visual de referência é o cartão da command bar, usado em `18-page-dialogs.css` e `22-page-prompts.css`. Os tokens `--cmd-*` vêm das listas no topo de `16-command-bar-sizes.css`, e um prompt novo entra nessas listas.

Prioridade: **A** aparece no uso diário; **B** aparece às vezes; **C** é raro ou de recurso desligado.

## Como o Vivaldi monta essas telas

- **Diálogos modais**: um componente único desenha `#modal-bg.<classe> > .modal-wrapper > .dialog-header/.dialog-title, .dialog-content, .dialog-footer`. A classe diz o diálogo, e `slide`, `float` ou `anchor` dizem a animação e a posição. Por isso, uma base comum em `#modal-bg .modal-wrapper` cobre quase todos de uma vez, e cada um só precisa de ajustes de conteúdo.
- **Balões da barra de endereço**: `.addressfield-popup-container > .addressfield-popup > .addressfield-popup-header/-content`.
- **Popups de botão** (barra de ferramentas, barra de status, painéis): `.button-popup` com `.button-popup-arrow-*`, `.button-popup-pos-*` e animações `button-popup-enter/appear`.
- **Barras na página**: `.infobars > .page-confirm-info-bar > label + .infobar-controls`, que são as infobars do Chromium desenhadas em HTML.

## Já com o visual do Vivarc

| Tela | Classe | Arquivo |
| --- | --- | --- |
| Alert, confirm e prompt de página | `.dialog-javascript` | `18-page-dialogs.css` |
| Busca na página (Cmd+F) | `.find-in-page` | `22-page-prompts.css` |
| Pedido de download | `.dialog-download` | `22-page-prompts.css` |
| Pedido de permissão (localização, câmera, notificações…) | `.permission-popup` | `22-page-prompts.css` |
| Alternador de abas (Ctrl+Tab) | `.modal-tabswitcher`, `.tabswitcher` | `17-tab-cycler.css` |
| Apagar dados de navegação | `#modal-bg` com `.dialog-clear-data` | `23-modal-dialogs.css` |
| Salvar e abrir sessão | `#modal-bg` com `.save-session`, `.open-session`, `.dialog-session` | `23-modal-dialogs.css` |
| Abrir vários links, ativar workspaces e abrir sessão com workspaces | `.dialog-checkbox` dentro de `#modal-bg` | `23-modal-dialogs.css` |
| Confirmações de exclusão (pasta, senha, cookies, permissões) | `#modal-bg` com `.dialog-delete-folder-name`, `.dialog-delete-password`, `.dialog-delete-cookies` | `23-modal-dialogs.css` |
| Editor de favorito e pasta de favoritos | `#modal-bg` com `.edit-bookmark` ou `.dialog-add-folder-name` | `23-modal-dialogs.css` |
| Adicionar mecanismo de busca | `#modal-bg` com `.dialog-addsearch` | `23-modal-dialogs.css` |
| Compartilhar por QR code (diálogo da página) | `#modal-bg` com `.qr-share-dialog` | `23-modal-dialogs.css` |
| Extensão alterada ou desativada | `#modal-bg.disabledExtensionsPopup` | `23-modal-dialogs.css` |
| Importar dados (navegadores, Arc) | `#modal-bg.import-data-dialog`, `#modal-bg.welcome-import-data-dialog` | `23-modal-dialogs.css` |
| Ativar navegação por cursor (F7) | `#modal-bg` com `.dialog-caret-browsing` | `23-modal-dialogs.css` |
| Teclas de acesso | `#modal-bg.page-access-keys` com `.dialog-access-keys` | `23-modal-dialogs.css` |
| Adicionar à nota | `#modal-bg.note-selection-dialog` | `23-modal-dialogs.css` |
| Restaurar padrões (atalhos, gestos, buscas, barras, configurações) | `#modal-bg` com `.dialog-restore-shortcuts`, `.dialog-restore-search`, `.dialog-restore-settings` | `23-modal-dialogs.css` |
| Editor e prévia de barra | `#modal-bg.toolbar-editor` com `.dialog-preview` | `23-modal-dialogs.css` |
| Parceiro de busca | `#modal-bg.search-partner-dialog` | `23-modal-dialogs.css` |
| Outros diálogos do componente modal, inclusive avisos de mídia, Razer Chroma e perfil em repositório Git | `#modal-bg` com `.modal-wrapper` | `23-modal-dialogs.css` |
| Painéis da direita, inclusive "Customize Panel" | `#panels-container`, `.CustomizePanelPopup` | `21-panels.css` |
| Quick Commands do Vivaldi | `.quick-command*` | substituídos pela command bar do Vivarc |
| Configurações do Vivaldi | `.vivaldi-settings` | `25-vivaldi-settings.css` |

## Ainda com o visual do Vivaldi

### Balões da barra de endereço

| Prio | Tela | Classe | Quando aparece |
| --- | --- | --- | --- |
| A | Informações do site (cadeado: certificado, permissões, cookies) | `.SiteInfo-*`, `.SiteInfo-Field-Permissions` | clique no cadeado |
| A | Adicionar ou editar favorito (estrela) | `.BookmarkPopup`, `.Bookmark-Added-Popup`, `.bookmark-folder-picker` | Cmd+D ou estrela |
| B | Traduzir página | `.TranslatePopup` | página em outro idioma |
| B | Conteúdo bloqueado e popups bloqueados | `.addressfield-popup-header.blocked-content`, `.popupblocker-blocked-pages`, `.block-popups` | site abre pop-up ou rastreador bloqueado |
| B | Bloqueador de anúncios e rastreadores (opções e exceções) | `.ContentBlocker-OptionsDialog`, `.ContentBlocker-Exception`, `.ContentBlocker-SourcePopup` | escudo da barra |
| B | Instalar web app (PWA) | `.PwaInstallPopup`, `.PwaInstallButton` | site instalável |
| C | Serviço de localização do macOS desligado | `.addressfield-popup.system-location-service` | site pede localização com o serviço desligado |
| C | Aviso de endereço disfarçado | `.UrlBar-UrlObfuscationWarning` | URL suspeita |
| C | Aviso nas sugestões de busca | `.search-suggestion-warning` | — |

### Diálogos modais (`#modal-bg`)

| Prio | Tela | Classe | Quando aparece |
| --- | --- | --- | --- |
| C | Prévia de tema | `ThemePreview-*` | Configurações |
| C | Conta Vivaldi (login e sincronização) | `.AccountSheet`, `.account-dialog`, `.sync-setup` | login no Sync |

### Popups de botão e de barra

| Prio | Tela | Classe | Quando aparece |
| --- | --- | --- | --- |
| A | Popup de extensão (o conteúdo é da extensão, a moldura é do Vivaldi) | `.extension-popup`, `.button-popup` | ícone de extensão |
| A | Perfil e sincronização | `.profile-popup`, `.sync-anchor`, `.SyncStatus` | avatar no canto inferior |
| B | Botões ocultos da barra | `.overflow-button-popup` | barra estreita |
| B | Abas sincronizadas e compartilhadas | `.synced-tab-dialog`, `.TabButtonPopup` | botão de abas de outros dispositivos |
| B | Compartilhar por QR code (popup) | `.create-qr-code` | botão de QR code |
| B | Workspaces do Vivaldi (lista e editor) | `.WorkspacePopup`, `.Workspace-Editor` | o Vivarc tem editor próprio, mas o do Vivaldi ainda pode abrir |
| B | Editor de pilha (nome e cor) | `.StackEditor` | renomear pilha pelo Vivaldi |
| B | Atualização do Vivaldi | `.UpdatePopup`, `.popup-warning`, `.update-status` | atualização disponível |
| C | Relógio e alarmes da barra de status | `.ClockPopup`, `.timeslice-bubble` | relógio da barra de status |
| C | Pausa ("Take a Break") | `.BreakModePopup` | — |
| C | Compartilhar o Vivaldi, prévias promocionais | `.ShareVivaldiPopup`, `.PromotePreviewPopup`, `.GamePreviewPopup`, `.popup-vpn-intro` | promoções do Vivaldi |
| C | Esconder a barra automaticamente | `.AutoHideButtonPopup` | — |
| C | Adicionar painel web | `.AddWebPanelPopup` | "+" dos painéis |
| C | Lista de leitura (popup) | `.reading-list-dialog` | botão da lista de leitura |
| C | Editar link no editor de notas | `.link-dialog` | seleção de link na nota |
| C | Pedido de doação | `.donation-partner-prompt` | promoções do Vivaldi |

### Na página e sobre a janela

| Prio | Tela | Classe | Quando aparece |
| --- | --- | --- | --- |
| A | Infobars (restaurar abas, navegador padrão, depuração, avisos do Chromium) | `.infobars`, `.page-confirm-info-bar`, `.infobar-controls` | início, avisos |
| A | Dicas flutuantes (tooltips da UI) | `.tooltip`, `.vivaldi-tooltip`, `.HintTooltip` | hover em botões e abas |
| B | Captura de tela (área, nome do arquivo) | `.CaptureArea`, `.CaptureRect`, `.capture-name-template` | botão de captura |
| B | Organização de abas lado a lado | `.tiling-editor-overlay` | split view |
| B | Carregando o modo leitura | `.reader-loading-overlay` | modo leitura |
| C | Seletor de elemento (bloqueador) | `.dom-picker` | bloquear elemento |
| C | Dropdowns e seletores próprios do Vivaldi | `.VivaldiDropdown-DropdownMenu`, `.VivaldiSelector__menu`, `.DatePickerPopup`, `.ColorEditor` | configurações e painéis |

### Telas cheias e janelas internas

| Prio | Tela | Classe | Observação |
| --- | --- | --- | --- |
| B | Gerenciadores (favoritos, notas, histórico, downloads em aba) | `.manager-editor`, `.NotesManager-*`, `.download-*` | páginas `vivaldi://` desenhadas pela UI |
| B | Editor de tema | `.ThemeEditor*` | em Configurações; o Vivarc tem o próprio editor de tema por space |
| C | Boas-vindas e onboarding | `.welcome-*`, `.onboarding` | primeiro uso |
| C | Mail, Calendar e Feeds | `.MailAccountSheet`, `.CalendarAccountSheet`, `.CalendarEventBubble`, `.CalendarNotifications`, `.StatusPopup`, `.calendar-dialog`, `.dialog-add-feed` | recursos desligados nos painéis do Vivarc; só valem se forem ligados |

## Fora do alcance do CSS (desenhadas pelo macOS ou pelo Chromium)

Estas telas não estão no HTML da UI do Vivaldi, então o Vivarc não consegue mudá-las com CSS. A lista sai do que *não* aparece no bundle e precisa de confirmação ao vivo, uma por uma:

- **Menus de contexto e menus da barra**: no macOS são menus nativos (NSMenu). O Menu Editor do Vivaldi muda o conteúdo, não o visual. As classes `.menu` e `.menubar` do CSS do Vivaldi servem ao menu horizontal do Windows e do Linux.
- **Janelas do sistema**: salvar e abrir arquivo, impressão do macOS, compartilhamento do macOS e notificações do sistema.
- **Balões nativos do Chromium**: salvar senha, preencher formulário e cartão, passkeys e WebAuthn, login HTTP (usuário e senha do site), instalar extensão, abrir em app externo (`mailto:`, `zoom:`…), acesso a arquivos (File System Access) e escolha de dispositivo (USB, Bluetooth, serial, HID).
- **Páginas do Chromium (`chrome://`)**: prévia de impressão, Gerenciador de Tarefas, certificados, avisos de segurança (página insegura, certificado inválido), `chrome://extensions`. São páginas web separadas, que só mudariam com CSS injetado nelas, um caminho diferente do que o Vivarc usa.

## Ordem sugerida

1. **Base comum dos diálogos modais**: estilizar `#modal-bg .modal-wrapper` e os `.dialog-*` com o cartão do Vivarc, tirando proveito do que `18-page-dialogs.css` já faz. Isso cobre de uma vez quase todos os diálogos da seção "Diálogos modais".
2. **Base comum dos balões da barra de endereço** (`.addressfield-popup-container`): Informações do site, Favorito, Traduzir, Bloqueados e PWA. O pedido de permissão já está pronto e serve de modelo.
3. **Base comum dos popups de botão** (`.button-popup`): extensões, perfil, botões ocultos, atualização.
4. Infobars e tooltips.
5. Telas grandes (Configurações e gerenciadores), uma de cada vez, porque mudam muita coisa.
6. Confirmar ao vivo a lista "fora do alcance" e decidir se vale estilizar alguma página `chrome://`.
