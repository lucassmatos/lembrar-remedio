# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`lembrar-remedio` — PWA pra controlar horários de medicamento, vacinas, retornos
médicos e diário do bebê (sonecas + amamentação), pra você e pra quem você cuida.
Notificação por Telegram, escaneia receita com foto (OpenAI BYOK), perfis
compartilháveis entre cuidadores.

## Commands

```bash
npm run dev            # Next dev server (use LR_DEV_LOCAL=1 para mock DDB em memória)
npm test               # vitest run (toda a suíte)
npx vitest run <file>  # um arquivo: npx vitest run lib/sharing.test.ts
npx vitest run -t "nome do teste"   # um teste por nome
npm run lint           # next lint
npx tsc --noEmit       # type check (ver gotchas abaixo)
```

**Rodar local sem AWS:** `LR_DEV_LOCAL=1 npm run dev`. Isso ativa `lib/dev-store.ts`,
um stand-in de DynamoDB em memória (Put/Get/Delete/Query/Update com avaliador
de ConditionExpression). `requireSession()` retorna um usuário fake (`dev-user`),
então as rotas de API e telas client funcionam sem login. **Os testes usam o mesmo
dev-store** via `vi.hoisted(() => { process.env.LR_DEV_LOCAL = "1" })` antes de
importar `./ddb`, e `_resetDevStore()` no `beforeEach`.

## Architecture

Next.js 15 (App Router) · NextAuth v5 (Google) · DynamoDB single-table · AWS
Lambda + EventBridge Scheduler · Telegram Bot API · Tailwind v4 · PWA.

### DynamoDB single-table (`lib/ddb.ts`)

Uma tabela, partições por prefixo de `pk`:
- `user#<sub>` — config, metadados de perfil (`profile#<id>`), share links
  (`shared#<owner>#<profileId>`), partner record (`partner`), e **activities do
  diário** (`activity#<date>#<id>`).
- `profile#<profileId>` — **reminders, logs, notified, e um sentinela `meta`**
  (`{ownerSub, profileId}`). Reminders/logs/notified migraram de `user#` pra
  `profile#` pra suportar compartilhamento. O sentinela `meta` existe porque não
  há GSI `profileId → ownerSub`; o schedule-sync Lambda lê ele.
- `pair#<token>` — tokens de pareamento Telegram (`kind:"telegram"`) e convites de
  sharing (`kind:"generic"`). O `kind` discrimina pra não consumir um pelo outro.
- `chat#<chatId>` — mapeia chat Telegram → sub. `users` — índice de usuários.

`stripKeys()` remove pk/sk antes de devolver. Helpers `*ForProfile` operam na
partição do perfil; os antigos (`getLog`, `listReminders` por sub) estão
`@deprecated` mas mantidos pra compatibilidade do script de migração.

### Compartilhamento de perfis (`lib/sharing.ts`)

A unidade de compartilhamento é o **perfil** (uma pessoa que você cuida), não a
conta. Dois papéis: **parceiro** (acesso total, igual owner) e **cuidador**
(só ver + marcar dose, em perfis específicos). Convite é um token com TTL 24h,
**email-bound nos dois modos** (`inviteeEmail` obrigatório).

- `requireProfileAccess(callerSub, profileId, minRole)` é o gate de autorização —
  **toda rota de mutação chama ele**, nunca confia só na UI. Roles: caregiver(1)
  < partner(2) < owner(3) vs minRole viewer(1)/editor(2)/owner(3).
- Consistência dupla: `Profile.sharedWith[]` (pra notificação fan-out) E um
  link record por viewer `user#<viewer>/shared#...` (pra discovery sem GSI).
  Toda mudança de membership mexe nos dois. Escritas sequenciais (sem transação);
  `putProfile` dedup `sharedWith` por sub pra mitigar race.
- `listProfilesForUser(sub)` mescla perfis próprios + compartilhados (via link
  records → GetItem na partição do owner).

### Notificações (Telegram-only)

Push do PWA foi descontinuado — **só Telegram**. `lib/next-dose.ts`
(`computeNextDose({profileId, ownerSub})`) calcula slots devidos por perfil
usando o **timezone do owner**. `lib/notify-one.ts` faz fan-out: manda pra todos
os membros pareados do perfil, claim atômico via `markNotifiedForProfile`, e grava
`messages` (chatId+messageId por membro, chave sanitizada via `lib/profile-keys.ts`
base64url) pra editar os cards depois. Quando um membro marca "tomei",
`notifyOtherMembersOfTaken` edita o card dos outros pra "✅ fulano marcou"
(best-effort, swallow erro do `editMessageText` — limite de 48h do Telegram).

O webhook (`app/api/telegram/webhook/route.ts`) resolve o perfil de um callback via
`findReminder(sub, reminderId)` e re-checa `requireProfileAccess` antes de marcar.

### Lambdas + EventBridge (`infra/`)

Um schedule EventBridge **por perfil** (`lr-profile-<id>`), payload
`{profileId, ownerSub}`. `notify-dose` dispara as doses devidas e se reagenda.
`schedule-sync` reage ao DDB stream (`profile#*/reminder#*` muda → atualiza
schedule; `profile#<id>/meta` REMOVE → deleta schedule), resolvendo ownerSub via
o sentinela `meta`. CDK em `infra/lib/compute-stack.ts` (cuidado: dança de ARN
estático pra quebrar o ciclo NotifyFn ↔ SchedulerRole — preservar ao editar).

### Diário do bebê (`lib/activity.ts`, domínio `Activity`)

Sonecas (cronômetro ao vivo) + amamentação. Feed tem método: peito (lado),
mamadeira (ml + conteúdo, conta como mamada), extração (ml + lado, soma à parte,
não é mamada). Legados sem `method` = peito (`feedMethod()`). Activities vivem na
partição `user#<sub>` (não migraram pra profile#), mas `deleteProfileCascade`
limpa as do perfil deletado.

## AWS / deploy

- **Conta:** `lembrar-remedio` vive na conta AWS **`lucas-pessoal`** (us-east-1).
  Pra acessar: `assume lucas-pessoal --export` (Granted/SSO), depois
  `aws --profile lucas-pessoal ...` ou `AWS_PROFILE=lucas-pessoal` pra scripts.
  Não está nas contas Rune/Institucional.
- **App na Vercel**, lê DDB via chaves `LR_AWS_ACCESS_KEY_ID`/`LR_AWS_SECRET_ACCESS_KEY`
  (renomeadas pra não colidir com env reservada da Vercel). Infra via CDK em
  `infra/` (`npx cdk deploy --all`). `TELEGRAM_BOT_TOKEN` vem do Secrets Manager
  no Lambda.
- **Migração profile-scoped:** `infra/scripts/migrate-profiles-to-shared.ts` move
  reminders/logs/notified de `user#` pra `profile#`. 3 fases idempotentes
  (COPY → VERIFY → DELETE). Runbook completo em `infra/scripts/README.md`.
  **Ordem crítica:** a fase DELETE só roda APÓS o deploy do código novo (em
  maintenance window) — senão o app live lê a partição `user#` já apagada.
  Rodar dry-run primeiro: `AWS_PROFILE=lucas-pessoal npx tsx infra/scripts/migrate-profiles-to-shared.ts --dry-run --phase=copy`.

## Gotchas

- **`/casa/entrar` (aceitar convite) não roda em dev-local** — é Server Component
  que usa `auth()` real do NextAuth; sem creds Google locais o `/api/auth/signin`
  dá 500. Funciona em prod. O resto do app usa `requireSession()` (com bypass dev).
- **`tsc --noEmit` deixa ruído pré-existente:** um erro em `app/layout.tsx`
  (import side-effect de `globals.css`) e warnings de `@deprecated` nos helpers
  antigos do ddb. Filtra com `grep -v "globals.css"` ao checar erros reais.
- **Vitest usa alias `@/`** (configurado em `vitest.config.ts`) e exclui
  `.claude/worktrees/**` (worktrees Conductor paralelos têm testes próprios).
- **`ItemCount` do DynamoDB é aproximado** (atualiza a cada ~6h) — não confie pra
  contagem exata.
