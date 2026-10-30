# Vivarc — fork pessoal

Este projeto mantém o fork `gulin-desigenr/vivarc` para o Vivaldi no macOS. O estado e as instruções de operação estão em `ESTADO.md`. Preserve as personalizações locais, o histórico do fork e os dados do perfil; nunca execute o instalador original sobre a instalação vinculada.

- `origin` é o fork pessoal; `upstream` é `KASOGIT/vivarc` para comparação e integração consciente.
- O código-fonte está na raiz, conforme o repositório original. `~/.vivarc/app` aponta para este checkout; dados, configurações e backups continuam em `~/.vivarc`.
- Antes de editar, inspecione `git status` e preserve alterações não relacionadas. Teste com `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests`.
- Para aplicar alterações ao Vivaldi, execute `python3 vivarc.py apply` e reinicie o navegador quando necessário. Não use `sudo`. Mudanças no navegador podem interromper a sessão.
- O comando `update` usa `git pull --ff-only` do branch atual e reinstala a partir deste checkout. Não faça reset, force-push ou substituição silenciosa de código local.
