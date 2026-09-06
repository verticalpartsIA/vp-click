# Claude Hostinger_Avisos

Nota deixada por uma sessão do Claude Code (rodando direto na VPS `srv1510643`, fora deste repo)
em 06/09/2026, durante a migração do VP Click do hosting compartilhado da Hostinger para a VPS.
Não editei nenhum código deste repositório — este arquivo é só um registro do que foi feito por
fora, pra quem estiver mexendo aqui saber que existe.

## O que foi feito

1. **Verificação de saúde pós-migração** (só leitura, sem alterar nada): confirmei que o container
   `vpclick-vpclick-1` (nginx:alpine, `/docker/vpclick/` na VPS) está no ar, roteado via Traefik em
   `vpclick.vpsistema.com` com TLS, e que as 6 telas (Dashboard, Lista, Kanban, Calendário, Gantt,
   Tabela) carregam rápido com dados reais. Login via SSO central (`vpsistema.com`) testado e
   funcionando.

2. **Nova automação externa, fora deste repo — "cobrança de tarefas atrasadas via WhatsApp"**:
   um script Python rodando na própria VPS (`/root/vpclick-cobranca/`, cron diário às 07h BRT) que:
   - Lê a tabela `tasks` deste projeto (Supabase `sfpnjwllcmentoocylow`) via `service_role`,
     procurando tarefas cujo `due_date` foi ontem e cujo `status` não é um rótulo terminal
     (cruza com `task_status_options.type IN ('DONE','CANCELLED')`, já que o rótulo de "concluído"
     varia por lista).
   - Resolve o responsável (`tasks.main_assignee_id` → `profiles.name`) e cruza o nome com o
     cadastro de telefones internos (tabela `internal_contacts` do projeto Supabase do pv360),
     pra achar o WhatsApp de quem deve ser cobrado.
   - Envia uma mensagem de texto simples (sem IA/custo) via Evolution API (instância `pv360`,
     mesma usada pelo atendente Verti — canal de saída, sem misturar lógica de atendimento).
   - **Ainda em modo teste**: todas as mensagens vão só pro Gelson, com a anotação de quem seria o
     destinatário real. Ninguém mais recebe nada até isso ser destravado.

## Por que isso importa pra quem mexe neste repo

Esse script **depende diretamente do schema** de `tasks`, `profiles` e `task_status_options` deste
projeto (lidos direto do Postgres via REST, com `service_role`, fora deste código-fonte). Se algum
desses nomes de coluna, o significado de `status`/`type` em `task_status_options`, ou a semântica de
`main_assignee_id` mudar, o script de cobrança pode parar de funcionar ou pegar tarefa errada — vale
avisar/coordenar antes de uma migration que mexa nessas tabelas.

Também notei, olhando o histórico deste repo, que já existe trabalho em andamento pra tarefa
individual ganhar rota própria (`/tarefa/<slug>-<id>`, commit `b778ba8`) — isso é ótimo e alinhado
com uma conversa que tive com o Gelson sobre rotas nomeadas por espaço/lista (`/suprimentos/importacao/kanban`
etc., que já existem) trazerem benefício de link direto, refresh preservando contexto e
compartilhamento.

## Onde ficam os detalhes completos

Registrado na memória do Claude Code (fora deste repo): `verticalparts-vpclick-cobranca-whatsapp`
e atualização em `verticalparts-vpclick` (memória de projeto do Gelson, não versionada aqui).
