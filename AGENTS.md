# Vivarc — fork pessoal

Este projeto mantém o fork `gulin-desigenr/vivarc` para o Vivaldi no macOS. O estado e as instruções de operação estão em `ESTADO.md`. Preserve as personalizações locais, o histórico do fork e os dados do perfil; nunca execute o instalador original sobre a instalação vinculada.

- `origin` é o fork pessoal; `upstream` é `KASOGIT/vivarc` para comparação e integração consciente.
- O código-fonte está na raiz, conforme o repositório original. `~/.vivarc/app` aponta para este checkout; dados, configurações e backups continuam em `~/.vivarc`.
- Antes de editar, inspecione `git status` e preserve alterações não relacionadas. Teste com `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests`.
- Desenvolva e teste no **Vivaldi Dev** (`tools/dev-vivaldi.sh setup|apply|restart|quit`), uma cópia separada com perfil próprio e DevTools da UI em `127.0.0.1:9555`. O Vivaldi principal é usado para trabalho: só aplique nele (`python3 vivarc.py apply` + reinício) quando o usuário pedir. Não use `sudo`.
- Para publicar uma versão, siga `docs/RELEASE.md` e só faça isso quando o usuário pedir.
- O comando `update` usa `git pull --ff-only` do branch atual e reinstala a partir deste checkout. Não faça reset, force-push ou substituição silenciosa de código local.
