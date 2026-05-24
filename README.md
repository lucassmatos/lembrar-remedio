# lembrar-remedio

App pra controlar horários de medicamento, vacinas e retornos médicos — pra você
e pra quem você cuida (filho, avô, etc). Marca quando tomou, recebe notificação
no horário, escaneia receita com foto.

## O que tem

- **Medicamentos** com intervalo diário (8/8h, 12/12h, horários específicos,
  duração do tratamento).
- **Vacinas e retornos** com data marcada e avisos antes (30/15/7 dias) +
  cobrança depois ("já agendou?").
- **Múltiplos perfis** — cadastra medicamentos pra você, esposa, filho, mãe.
- **Compartilhar perfis** — divida o cuidado de uma pessoa com um parceiro
  (vê tudo) ou um cuidador/babá (vê só os perfis que você escolher). Quem
  marcar a dose, todo mundo vê.
- **Notificação por Telegram** quando chega a hora. Botão pra marcar tomado
  direto no chat. Quando um membro marca, o card dos outros vira "✅ fulano
  marcou".
- **Escanear receita** com a câmera — OpenAI lê a posologia e cadastra os
  medicamentos (você usa sua própria chave).

## Stack

Next.js 15 (App Router) · NextAuth v5 (Google) · DynamoDB · AWS Lambda +
EventBridge Scheduler · Tailwind v4 · PWA + Service Worker.

## Login

Login com Google obrigatório. A gente guarda `email`, `nome`, `sub` do Google,
mais o que você cadastra (medicamentos, horários, perfis, log de adesão, chat do
Telegram se você parear, timezone).

Tudo fica em DynamoDB na AWS (us-east-1). Logs de adesão expiram em 60 dias
por TTL automático.

## Notificações

Aviso é **só por Telegram**. Sem Telegram pareado você não recebe nada ativo,
só vê os lembretes ao abrir o app. Parear em **Ajustes → Conectar Telegram**.

Num perfil compartilhado, todos os membros pareados recebem o aviso. Quando
um marca a dose, o card dos outros é editado pra "✅ fulano marcou" — sem
cobrança fantasma.

## Compartilhar

Em **Ajustes → Compartilhar**:

- **Parceiro(a)** — compartilha *todos* os seus perfis, atuais e futuros.
  Caso clássico: casal cuidando do filho. Ambos editam, marcam dose, veem tudo.
- **Cuidador** — compartilha perfis específicos. A babá vê só os filhos, não
  os seus remédios. Cuidador pode marcar dose, mas não edita nem adiciona.

O convite é um link com código (válido 24h), igual ao pareamento do Telegram.
Qualquer um pode sair ou ser removido depois. Convite de cuidador é amarrado
ao email de quem você convidou.

## Rodar local

```bash
npm install
npm run dev
```

Variáveis de ambiente:

```bash
# Auth
AUTH_SECRET=…                       # gera com `openssl rand -hex 32`
AUTH_GOOGLE_ID=…
AUTH_GOOGLE_SECRET=…

# DynamoDB (renomeado pra evitar collision com env reservada do Vercel)
LR_AWS_REGION=us-east-1
LR_AWS_ACCESS_KEY_ID=…
LR_AWS_SECRET_ACCESS_KEY=…
DDB_TABLE_NAME=lembrar-remedio

# Telegram (opcional, mas o app é meio capenga sem)
TELEGRAM_BOT_TOKEN=…
TELEGRAM_BOT_USERNAME=…
TELEGRAM_WEBHOOK_SECRET=…           # qualquer string aleatória
APP_SECRET=…                        # protege /api/telegram/setup
```

`http://localhost:3000`.

## Deploy

App na Vercel, infra (DynamoDB + Lambdas + EventBridge) via CDK em
`infra/`. Os Lambdas escutam o stream do DDB e mantêm os schedules de
notificação atualizados.

```bash
cd infra
npm install
npx cdk deploy --all
```

Variáveis CDK esperadas no `cdk.json` ou ambiente. Veja `infra/bin/app.ts`.

## Estrutura

```
app/
  page.tsx                    hoje (doses do dia)
  upcoming/page.tsx           vacinas + retornos
  medications/page.tsx        cadastro de medicamentos
  settings/page.tsx           perfil, timezone, Telegram, receita
  login/page.tsx              Google sign-in
  api/
    reminders/                CRUD de medicamento/vacina/retorno
    profiles/                 CRUD de perfis
    config/                   timezone, chatId
    log/                      marcar dose tomada/pulada
    telegram/                 webhook + pareamento
    auth/                     NextAuth handler
  _components/                forms, listas, telegram panel
lib/
  schedule.ts                 geração de slots, timezone
  next-dose.ts                cálculo da próxima ocorrência por perfil
  ddb.ts                      DynamoDB wrapper (partição por perfil)
  sharing.ts                  acesso a perfil, convite, papéis
  profile-keys.ts             chaves de mapa DDB sanitizadas
  notify-one.ts               envio de notificação a todos os membros do perfil
  openai.ts                   parser de receita
  telegram.ts                 cliente Telegram Bot API
  api.ts                      wrapper client-side
infra/
  bin/app.ts                  entry CDK
  lib/data-stack.ts           DDB table + stream
  lib/compute-stack.ts        Lambdas + IAM
  lambda/notify-dose/         dispara as notificações pendentes de um perfil
  lambda/schedule-sync/       reage ao DDB stream, mantém schedule por perfil
  scripts/                    migração + cleanup de schedules
public/
  sw.js                       service worker (cache + notification click)
  manifest.webmanifest
```

## Dados que coletamos

Pra cumprir LGPD, eis a lista honesta do que fica guardado:

- **Da conta Google**: email, nome, ID estável (`sub`).
- **Lembretes**: nome, dosagem, horários, duração, perfil associado.
- **Adesão**: quais doses você marcou como tomadas/puladas, e quem marcou
  (nome) em perfil compartilhado (expira em 60d).
- **Compartilhamento**: com quem você divide cada perfil e qual o papel
  (parceiro/cuidador). Sai ao remover o membro ou apagar a conta.
- **Telegram**: o `chat_id` se você parear (pode desvincular a qualquer
  momento mandando `/desvincular` no bot).
- **Receita escaneada**: a foto vai pra OpenAI usando *sua* chave (BYOK) e
  o resultado parseado é guardado. A imagem não é persistida no nosso lado.

Pra apagar tudo: **Ajustes → Apagar minha conta**.

## Limitações

- Notificação ativa só via Telegram. Sem parear, você só vê os lembretes ao
  abrir o app.
- Escanear receita só faz sentido em português brasileiro (o prompt é
  hard-coded em pt-BR).
