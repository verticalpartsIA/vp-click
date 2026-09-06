# Claude Hostinger_Avisos

Nota deixada por uma sessão do Claude Code (rodando direto na VPS `srv1510643`, fora deste repo)
durante e depois da migração do VP Click do hosting compartilhado da Hostinger para a VPS. Não
edito código deste repositório — este arquivo é só um registro do que foi feito por fora, pra
quem estiver mexendo aqui saber que existe. Última atualização: 06/09/2026, mesma noite (~21h30).

## O que foi feito

### 1. Verificação de saúde pós-migração (06/09, só leitura)
Confirmei que o container `vpclick-vpclick-1` (nginx:alpine, `/docker/vpclick/` na VPS) está no
ar, roteado via Traefik em `vpclick.vpsistema.com` com TLS, e que as 6 telas (Dashboard, Lista,
Kanban, Calendário, Gantt, Tabela) carregam rápido com dados reais. Login via SSO central
(`vpsistema.com`) testado e funcionando.

### 2. Motor de notificações via WhatsApp — 🟢 EM PRODUÇÃO
Nasceu como "cobrança de tarefa atrasada" simples e virou, no mesmo dia, um motor de notificações
completo a pedido do Gelson. Vive em `/root/vpclick-cobranca/` na VPS (fora deste repo), rodando
via cron (a cada 15 min + 1x/dia às 07h). **Já está ligado pra valer** (não é mais modo teste) —
qualquer pessoa ativa no VP Click com telefone cadastrado recebe WhatsApp de verdade.

**Detecção 100% determinística** (sem IA, sem custo), lendo direto o schema deste projeto
(Supabase `sfpnjwllcmentoocylow`, via `service_role`):
- **Menção** (`@time`) — tabela `notifications` (`type=team_mention`), já populada pelo próprio app.
- **Conclusão** (individual ou em grupo, se a tarefa tiver `secondary_assignee_ids`) —
  `task_activities` (`type=STATUS_CHANGE`, `new_value` num rótulo `DONE`/`CANCELLED` de
  `task_status_options` — o rótulo de "concluído" varia por lista, por isso o cruzamento).
- **Observador adicionado** — `task_watchers.added_at` (o schema não guarda quem adicionou; uso
  `tasks.created_by` como melhor aproximação disponível).
- **Resumo de tarefas atrasadas** — agregado por responsável (`main_assignee_id`), só dispara
  tarefa NOVA desde o último aviso (não repete o mesmo backlog todo dia).
- **Inatividade** — proxy por última linha em `task_activities` (não existe last-login exposto;
  `rpc/get_users_last_sign_in` retorna vazio via `service_role`), com o mesmo cuidado de não repetir.

**Redação do texto**: Claude Haiku (modelo mais barato, escolha explícita do Gelson) escreve cada
mensagem em lote (até 15 por chamada, `output_config.format=json_schema`), sempre abrindo com
"📋 *VP Click aqui!*" e citando o primeiro nome de quem recebe e de quem causou o evento — pedido
explícito do Gelson pra deixar claro remetente/destinatário.

**Regra de horário comercial** (adicionada 06/09 à noite): só envia seg-sex, 07h-18h, horário de
São Paulo (`zoneinfo`, servidor continua em UTC), pulando feriados nacionais de verdade (pacote
`holidays`, calcula até feriado móvel — não é lista fixa). Fora do horário, nada é descartado: o
evento fica represado e sai assim que o expediente reabrir.

**Cobertura de telefone**: cruzando com o roster de contatos internos (`internal_contacts`, o
mesmo que o atendente Verti usa), a maioria batia por nome só parcialmente — usei uma
[issue neste repo (#216)](https://github.com/verticalpartsIA/005_vpclick/issues/216) pro Gelson
confirmar os casos duvidosos, e depois corrigi diretamente o cadastro oficial (`internal_contacts`)
onde havia gente que já saiu da empresa com o número reaproveitado por outra pessoa, sem o nome
ter sido atualizado.

## Por que isso importa pra quem mexe neste repo

O motor de notificações **depende diretamente do schema** de `tasks`, `profiles`,
`task_status_options`, `task_activities`, `task_watchers` e `notifications` deste projeto (lidos
via REST/`service_role`, fora deste código-fonte). Se algum nome de coluna, o significado de
`status`/`type` em `task_status_options`, a semântica de `main_assignee_id`/
`secondary_assignee_ids`, ou o formato de `task_activities.type` mudar, o motor pode parar de
funcionar ou notificar errado — vale avisar/coordenar antes de uma migration que mexa nessas
tabelas.

Também notei, olhando o histórico deste repo, que já existe trabalho em andamento pra tarefa
individual ganhar rota própria (`/tarefa/<slug>-<id>`, commit `b778ba8`) e uma fase 2 de motor de
recorrência (`5ac6a2e`, issue #184) — nada conflita com a automação de notificações, só registrando
pra contexto.

## Onde ficam os detalhes completos

Registrado na memória do Claude Code (fora deste repo, não versionado aqui):
`verticalparts-vpclick-cobranca-whatsapp` (motor de notificações completo) e
`verticalparts-vpclick` (memória de projeto geral, inclui a migração pra VPS).
