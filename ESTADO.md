# Estado do Vivarc

Atualizado em 29/10/2026.

## Projeto e instalação

- Fork: https://github.com/gulin-desigenr/vivarc
- Original: https://github.com/KASOGIT/vivarc
- Checkout: `/Users/pedrogulin/Developer/produtos/vivarc`
- Instalação: `~/.vivarc/app` aponta para o checkout. Dados, ajustes, Peek e backups permanecem em `~/.vivarc`.
- O botão Update Vivarc e `python3 ~/.vivarc/app/vivarc.py update` usam o checkout Git, executam `git pull --ff-only` do branch e reaplicam o código. O atualizador não integra mudanças de `upstream` automaticamente.
- Após atualizar o Vivaldi, reabra o Vivarc com Update Vivarc ou feche o navegador, rode `python3 vivarc.py apply` e abra-o novamente. A alteração do instalador original pode remover a injeção.

## Personalizações

- Troca de spaces vazios usa a ativação nativa do workspace; relatada na issue upstream #54.
- Clique duplo dentro da barra lateral não aciona o comando nativo de nova aba; relatado na issue upstream #55.
- Pastas expandem e recolhem em 220 ms, respeitando `prefers-reduced-motion`.
- O acionamento interno de workspace depende de implementação privada do Vivaldi e deve ser revalidado após atualizações do navegador.

## Verificação

`python3 vivarc.py status` verifica a injeção e o perfil. Os testes automatizados são executados com `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests`; testes de interface devem cobrir pastas, Cmd+T e troca de spaces.
