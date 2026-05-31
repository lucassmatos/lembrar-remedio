# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`lembrar-remedio` — PWA pra controlar horários de medicamento, vacinas, retornos
médicos e diário do bebê (sonecas + amamentação), pra você e pra quem você cuida.
Notificação por Telegram **e** Web Push (PWA, em paralelo), escaneia receita com
foto (OpenAI BYOK), perfis compartilháveis entre cuidadores.

## Fluxo de entrega (IMPORTANTE)

Padrão pra **qualquer** mudança. Sem PR — o Lucas só revisa o que está na `main`/prod,
então `git push` direto na `main` é o jeito dele ver o trabalho. Não abrir PR a menos
que ele peça.

1. **Desenvolver** a mudança.
2. **Code-review** — rodar `/code-review` (high) no diff e corrigir o que aparecer.
3. **E2E no ambiente** — não é só `npx vitest run` (a suíte cobre `lib/`, não componentes).
   Subir o app local (`LR_DEV_LOCAL=1 npx next dev`) e **dirigir o fluxo real no browser**
   via gstack `/browse` (criar o dado, clicar, validar o estado final). Não há Playwright;
   "e2e" aqui = dogfooding do fluxo de verdade. Rodar `npx vitest run` + `npx tsc --noEmit`
   + `npm run lint` também.
4. **Mandar pra prod** — com tudo verde, commit **direto na `main`** e `git push`
   (a Vercel deploya no push). Se a mudança tocar `lib/notify-one.ts`, `lib/telegram.ts`,
   `lib/push.ts` ou `lib/next-dose.ts`, redeployar o Lambda também (ver AWS / deploy).

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
partição do perfil — são os únicos que o app vivo usa.

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

### Notificações (Telegram + Web Push, em paralelo)

Dois canais, ambos disparados pelo servidor. `lib/next-dose.ts`
(`computeNextDose({profileId, ownerSub})`) calcula slots devidos por perfil no
**timezone do owner** (janela de catch-up de 60min). `lib/notify-one.ts`
(`fanOutAndClaim`) faz fan-out por membro pareado: **claim atômico** via
`markNotifiedForProfile` ANTES de enviar (dedup contra disparos concorrentes),
depois manda **Telegram E Web Push** pra cada membro.

- **Telegram** (`lib/telegram.ts`): grava `messages` (chatId+messageId por membro,
  chave base64url via `lib/profile-keys.ts`) pra editar os cards. Ao marcar
  "tomei", `notifyOtherMembersOfTaken` edita o card dos outros pra "✅ fulano
  marcou" (best-effort, limite de 48h do Telegram).
- **Web Push** (`lib/push.ts`, lib `web-push`): manda pra todas as subscriptions
  do membro (`user#<sub>/pushsub#<id>`), poda as mortas (404/410).
- **Falha total** (nenhum canal alcançou ninguém) → solta o claim
  (`unmarkNotifiedForProfile`) e o handler do Lambda **lança erro** → EventBridge
  re-tenta (2x/300s, dentro do catch-up). Sucesso parcial mantém o claim (sem
  reenvio duplicado). Sem isso, um blip de rede perdia a dose calado.
- **Credencial:** `sendMessage`/`editMessage` chamam `ensureTelegramToken()` e
  `sendWebPush` chama `ensureVapid()` — vêm de env (Vercel) ou Secrets Manager
  (Lambda). Não chame `token()` sem garantir: foi o bug que silenciava TODA
  notificação de dose no Lambda (token só carregava se alguém chamasse ensure).

O webhook (`app/api/telegram/webhook/route.ts`) resolve o perfil de um callback via
`findReminder(sub, reminderId)` e re-checa `requireProfileAccess` antes de marcar.

**Web Push setup:** chave VAPID pública hardcoded em `lib/vapid-public.ts`
(client-safe); privada em env `VAPID_PRIVATE_KEY` (Vercel) ou secret
`lembrar-remedio/vapid-private-key` via `VAPID_PRIVATE_KEY_SECRET_ARN` (Lambda).
SW `public/sw.js` (handlers `push`+`notificationclick`) registrado em
`app/_components/providers.tsx`. Opt-in em Ajustes (`push-opt-in.tsx` →
`/api/push/subscribe`); **iOS só recebe com o PWA na tela inicial** (16.4+). Botão
"enviar teste" → `/api/notify/test`.

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

### Frontend & estado de domínio

- **Hub de lembretes:** tudo numa rota `/lembretes` (`app/lembretes/page.tsx`) com
  seletor de tipo via `?tipo=medication|appointment|vaccine` (`lib/reminder-kinds.ts`).
  `/medications`, `/appointments`, `/vaccines` são só `redirect()` pra lá. Nav em
  4 itens (`app/_components/nav.tsx`): Timeline · Lembretes · Diário · Ajustes.
- **`Reminder.status`** (`unscheduled→scheduled→done`, só one-shot consulta/vacina):
  guia o fan-out (`sendOneShot` só dispara pre-lead enquanto unscheduled, post-lead
  quando scheduled) e a Timeline (done some). Reversível na UI (desmarcar/reabrir)
  e editável no `one-shot-form.tsx`.
- **`Profile.aindaMama`** — bebê que ainda mama; gateia a seção de mamada no Diário
  (soneca segue pra todos). Set no editar perfil (`profiles-panel.tsx`).
- **`Config.startScreen`** (`timeline|diario`) — tela inicial; `/` redireciona pro
  Diário uma vez por sessão (sessionStorage) quando = diario.
- **Tema noturno automático** (20h–08h): `app/_components/night-theme.tsx` seta
  `data-theme="night"` no `<html>` (script inline no `layout.tsx` evita flash);
  paleta dim em `globals.css` sob `html[data-theme="night"]`, vence o
  light/dark do sistema.

## AWS / deploy

- **Conta:** `lembrar-remedio` vive na conta AWS **`lucas-pessoal`** (us-east-1).
  Pra acessar: `assume lucas-pessoal --export` (Granted/SSO), depois
  `aws --profile lucas-pessoal ...` ou `AWS_PROFILE=lucas-pessoal` pra scripts.
  Não está nas contas Rune/Institucional.
- **App na Vercel**, lê DDB via chaves `LR_AWS_ACCESS_KEY_ID`/`LR_AWS_SECRET_ACCESS_KEY`
  (renomeadas pra não colidir com env reservada da Vercel). Infra via CDK em
  `infra/` (`npx cdk deploy --all`). Secrets do Lambda: `lembrar-remedio/telegram-bot-token`
  e `lembrar-remedio/vapid-private-key` (Secrets Manager, grant na role do notify-dose).
- **Deploy é dividido:** o app/webhook roda na **Vercel** (git push → deploy), o
  pipeline de notificação roda em **Lambda** (`notify-dose`/`schedule-sync`, bundla
  `lib/`). Mexeu em `lib/notify-one.ts`, `lib/telegram.ts`, `lib/push.ts` ou
  `lib/next-dose.ts`? Afeta os DOIS — `git push` (Vercel) **e**
  `cd infra && AWS_PROFILE=lucas-pessoal npx cdk deploy LembrarRemedioCompute` (Lambda).
  Web Push pelo servidor da Vercel exige o env `VAPID_PRIVATE_KEY` lá.
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
- **`tsc --noEmit` deixa um ruído pré-existente:** erro em `app/layout.tsx`
  (import side-effect de `globals.css`). Filtra com `grep -v "globals.css"` ao
  checar erros reais.
- **Vitest usa alias `@/`** (configurado em `vitest.config.ts`) e exclui
  `.claude/worktrees/**` (worktrees Conductor paralelos têm testes próprios).
- **`ItemCount` do DynamoDB é aproximado** (atualiza a cada ~6h) — não confie pra
  contagem exata.
