# Compartilhar perfis entre usuários

**Data:** 2026-05-24
**Status:** Design aprovado, aguardando plan de implementação

## Problema

Hoje o app é single-user: cada conta Google é uma ilha. Famílias que cuidam de
crianças (ou idosos) precisam que **mais de um adulto** acompanhe os mesmos
remédios, vacinas e consultas — e que possam **cobrar um ao outro** quando
alguém esquece de marcar uma dose.

Caso de uso primário:

- **Casal cuidando de um filho.** Lucas e Maria precisam ver os mesmos
  lembretes do "Filho1", marcar doses, ver quem deu, e ser cobrados se ninguém
  marcou no horário.

Caso de uso secundário:

- **Cuidador externo (babá, avó).** A babá cuida só dos filhos, não deve ver
  remédios do Lucas e da Maria.

## Modelo conceitual

A unidade de compartilhamento é o **perfil** (não a conta inteira). Dois modos
de convite, ambos compartilham perfis por baixo dos panos:

- **Parceiro(a):** atalho UX que compartilha *todos os perfis atuais e
  futuros* do convidante com o convidado. Cada user tem no máximo 1 parceiro.
- **Cuidador:** compartilha um subconjunto explícito de perfis. Sem limite de
  cuidadores por perfil.

## Permissões

| Papel | Ver | Marcar dose | Editar reminders | Adicionar reminders | Editar/deletar perfil |
|---|---|---|---|---|---|
| Owner | ✓ | ✓ | ✓ | ✓ | ✓ |
| Parceiro | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cuidador | ✓ | ✓ | — | — | — |

Owner = quem criou o perfil. Apenas owner pode remover cuidadores ou parceiro,
e apenas owner pode deletar o perfil.

### Enforcement na API (CRÍTICO — não deixar pra UI)

O controle de permissão **não pode ser só na UI**. Todo endpoint de mutação precisa
verificar o papel do caller antes de executar. Implementar um helper:

```ts
async function requireProfileAccess(
  callerSub: string,
  profileId: string,
  minRole: "viewer" | "editor" | "owner",
): Promise<Profile> // lança 403 se acesso insuficiente
```

Mapeamento por endpoint:

| Endpoint | minRole exigido |
|---|---|
| GET /api/reminders | viewer |
| POST /api/reminders | editor |
| PATCH /api/reminders/[id] | editor |
| DELETE /api/reminders/[id] | editor |
| PATCH /api/reminders/[id]/status (one-shot) | editor |
| DELETE /api/profiles/[id] | owner |
| POST /api/log | viewer (marcar dose é permitido a cuidador) |

O helper busca o Profile em `user#<ownerSub>/profile#<id>` e verifica se
`callerSub === ownerSub` (owner) ou se `sharedWith` contém o caller com role
suficiente. Retorna 403 se não. Todos os handlers de mutação devem chamar esse
helper — não é opcional.

> Risco sem isso: cuidador com sessão válida pode chamar a API diretamente via
> curl e editar/deletar reminders de perfis que não controla.

## Modelo de dados (DynamoDB)

Tabela single-table mantida. Mudanças:

### Profile (existente, + campos novos)

```ts
type Profile = {
  id: string;
  name: string;
  color: ProfileColor;
  isDefault?: boolean;
  createdAt: number;
  // novos:
  ownerSub: string;                              // quem criou
  sharedWith: { sub: string; role: "partner" | "caregiver"; addedAt: number }[];
};
```

**Atenção — write races em `sharedWith`:** qualquer operação que modifica
`sharedWith` (aceitar convite, remover cuidador) deve usar `TransactWriteItems`
para escrever atomicamente tanto o link record do viewer quanto o update do
`sharedWith` no Profile. Sem transação, a leitura-modificação-escrita do array
pode perder uma entrada se duas operações concorrem. Usar um campo de versão
(`version: number`) na condição do TransactWrite para evitar lost update:

```
ConditionExpression: "version = :expectedVersion"
UpdateExpression: "SET sharedWith = :newList, version = version + 1"
```

### Partição muda: reminders e logs vivem em `profile#<profileId>`

Hoje:
- `pk: user#<sub>, sk: reminder#<id>`
- `pk: user#<sub>, sk: log#<date>`
- `pk: user#<sub>, sk: notified#<date>`

Vira:
- `pk: profile#<profileId>, sk: reminder#<id>`
- `pk: profile#<profileId>, sk: log#<date>`
- `pk: profile#<profileId>, sk: notified#<date>`

O perfil em si (metadata) continua em `pk: user#<ownerSub>, sk: profile#<id>`
(só o owner é dono dos metadados).

### Link records pra discovery

Pra um user X listar "perfis aos quais tenho acesso" sem precisar de GSI,
mantém-se um link record por perfil compartilhado:

```
pk: user#<viewerSub>, sk: shared#<ownerSub>#<profileId>
  → { ownerSub, profileId, role: "partner" | "caregiver", addedAt }
```

Listar perfis acessíveis = `Query pk = user#<sub>` + `begins_with(sk, "profile#")`
(próprios) + `begins_with(sk, "shared#")` (compartilhados, depois fetch dos
metadados na partição do owner).

### Partner record (atalho UX)

```
pk: user#<sub>, sk: partner
  → { partnerSub, partnerName, partnerEmail, since }
```

Quando user A tem partner B, **criar um novo perfil em A** automaticamente
adiciona B em `sharedWith` com role `partner`.

### Convite (reusa o padrão de `pair#<token>` já existente)

```
pk: pair#<token>, sk: pair
  → {
      ownerSub,
      mode: "partner" | "caregiver",
      profileIds?: string[],         // só pra mode=caregiver
      inviteeEmail?: string,         // opcional pra parceiro, obrigatório pra cuidador
      ttl: now + 24h
    }
```

**Segurança do token:** o token não é vinculado a um email específico por
padrão, o que significa que qualquer pessoa autenticada que receba o link pode
aceitar. Para convites de cuidador (que dão acesso a dados médicos de crianças),
`inviteeEmail` deve ser exigido. Na tela de confirmação (passo 5 do fluxo),
verificar `session.user.email === inviteeEmail` antes de mostrar o botão de
aceitar; se diferente, exibir "Este convite foi gerado para outro email."

> Sem isso: link compartilhado num grupo de WhatsApp dá acesso ao histórico
> médico de crianças para qualquer membro do grupo que clicar.

### takenBy no log

```ts
type DayLog = Record<string, {
  taken: boolean;
  takenAt: number;
  takenBy?: string;   // sub de quem marcou
}>;
```

## Discovery: como o app sabe quais perfis mostrar

`listProfilesForUser(sub)`:

1. Query próprios: `pk = user#<sub>, sk begins_with "profile#"`
2. Query shared links: `pk = user#<sub>, sk begins_with "shared#"`
3. Pra cada link, BatchGet em `user#<ownerSub>, sk = profile#<profileId>`
4. Mescla, anota `accessRole` em memória (não persiste).

`listReminders(profile)`: `pk = profile#<id>, sk begins_with "reminder#"`. Não
muda em função do user que está olhando — controle de permissão é na camada
de API (ver seção Enforcement acima; nunca só na UI).

### deleteProfileCascade — precisa ser atualizada

O atual `deleteProfileCascade(sub, profileId)` em `lib/ddb.ts` chama
`listReminders(sub)` que busca em `user#<sub>/reminder#*` — após a migração
isso retorna 0 resultados. Deve ser atualizado para:

```ts
async function deleteProfileCascade(ownerSub: string, profileId: string): Promise<void> {
  // 1. Deletar reminders em profile#<profileId>/reminder#*
  // 2. Deletar logs em profile#<profileId>/log#*
  // 3. Deletar notified em profile#<profileId>/notified#*
  // 4. Deletar metadata em user#<ownerSub>/profile#<profileId>
  // 5. Deletar link records de todos em sharedWith (buscar Profile antes de deletar)
}
```

Sem essa atualização, deletar um perfil deixa todos os reminders, logs e
notified na partição `profile#<id>/...` para sempre (sem TTL em reminders) —
violação LGPD e acúmulo de dados órfãos.

## Notificações

### Canal único: Telegram

Notificações são entregues **somente via Telegram**. Push do PWA foi
descontinuado por entregar mal (especialmente iOS + browser fechado). Membros
sem Telegram pareado não recebem aviso ativo — veem os lembretes só ao abrir
o app. A tela de Ajustes deve deixar isso explícito ("pareia Telegram pra
receber").

### Lambda `notify-user` (renomear pra `notify-dose`)

Hoje: dispara reminders por user.
Vira: dispara por perfil. Pra cada slot devido, busca todos os subs com acesso
(owner + sharedWith), busca chatId de cada via `getConfig`, envia. Membros sem
chatId são ignorados (sem fallback web push).

Race no marcar: o `markNotified` atômico já existe (ConditionalCheckFailedException)
— continua válido, mas vira por-perfil (`pk: profile#<id>, sk: notified#<date>`).

### Cobrança contínua

Mesmo padrão atual: se ninguém marcou em X minutos, novo lembrete. Mas agora
**todos os membros** recebem novo nudge.

### Marcar one-shot (vacina/consulta) também dispara cross-member edit

A atualização de status (`agendei` / `fiz`) em vacinas e consultas muda
`reminder.status` via `PATCH /api/reminders/[id]`. Assim como "marcar dose"
para medicamentos, essa ação deve disparar `editMessageText` para os outros
membros que receberam a notificação desse occurrence.

O `occurrenceKey` do one-shot (`${reminderId}#${date}#d${lead}`) está no
`notified#<date>` da mesma forma que slotKeys de medicamentos — usar o mesmo
mecanismo de lookup de `messages` para encontrar os chatId+messageId dos
outros membros e editar as mensagens.

Sem isso, o parceiro/cuidador que marcou "já agendei" não impede que o owner
receba outro nudge, e o owner fica sem saber que alguém já agiu.

### Atualização cross-membro quando alguém marca

Quando user X marca "tomou":

1. Atualiza log do perfil
2. Pra cada outro membro com acesso e com chatId: enviar `editMessageText` no
   chat (Telegram) atualizando a última mensagem do bot pra
   `"✅ Maria marcou às 14:23"` (em vez de manter o card de cobrança).

Pra isso precisamos guardar referência da última mensagem enviada por
(profile, slotKey, sub). Adiciona campo:

```
pk: profile#<id>, sk: notified#<date>
  → {
      keys: string[],
      messages: { [`${sanitizedKey}`]: { chatId, messageId } },  // novo
      ttl
    }
```

Onde `sanitizedKey` = base64url(`${slotKey}#${sub}`) para evitar caracteres
especiais (`@`, `:`, `|`, `#`) que causam falha em DDB UpdateExpression paths.
Guardar o mapeamento inverso não é necessário — a chave é reconstruída
on-the-fly a partir de `slotKey` e `sub` ao escrever.

**Write strategy:** usar um `UpdateCommand` separado e não-condicional para
persistir a referência da mensagem **depois** que o `sendMessage` do Telegram
retornou com sucesso e devolveu o `messageId`:

```ts
UpdateExpression: "SET messages.#key = :val"
ExpressionAttributeNames: { "#key": sanitizedKey }
ExpressionAttributeValues: { ":val": { chatId, messageId } }
```

Isso é separado do `markNotified` condicional — nunca misturar os dois numa
única UpdateExpression, pois o `markNotified` usa condição competitiva e falha
intencionalmente em races.

**Falha no editMessageText:** Telegram só permite editar mensagens até 48h
após o envio. Se `editMessageText` falhar (mensagem muito antiga, bot bloqueado
pelo usuário, mensagem deletada), a falha deve ser **ignorada silenciosamente**
(log de warning). O log da dose é salvo independentemente do status do
Telegram. Nunca propagar erro de Telegram para o response HTTP do endpoint
"marcar dose".

## Lambda + DDB stream

Hoje `schedule-sync` reage a mudanças em `user#*/reminder#*` pra atualizar
EventBridge schedules per-user.

Muda pra reagir a mudanças em `profile#*/reminder#*`. O target do
EventBridge passa a ser por-perfil em vez de per-user. O Lambda
`notify-dose` recebe `{ profileId, ownerSub }` (não `sub`) e descobre membros
a partir de `Profile.sharedWith` no item `user#<ownerSub>/profile#<profileId>`.

**O payload `ownerSub` no schedule é obrigatório.** Sem ele, o Lambda só tem
`profileId` e não consegue fazer o GetItem do Profile (não há GSI em profileId).
O `schedule-sync` deve incluir ambos ao criar/atualizar o EventBridge schedule:

```json
{ "profileId": "abc123", "ownerSub": "google-oauth2|456" }
```

**Timezone do notify-dose:** usar o timezone do owner (`getConfig(ownerSub).timezone`)
para computar "hoje" e verificar slots devidos. Cuidadores e parceiros recebem
notificações no horário local do owner — documentar isso explicitamente na UI.

**Schedules antigos `lr-user-*`:** ao fazer deploy, os schedules antigos
continuam existindo e dispararão o Lambda com o payload `{ sub }` antigo.
Para evitar notificações duplicadas durante a janela de migração, o plano de
deploy deve incluir um passo explícito de cleanup:

```
1. Migração de dados (script)
2. CDK deploy (novo Lambda + stream filter atualizado)
3. Script de cleanup: listar e deletar todos os schedules com prefixo `lr-user-`
```

Sem o passo 3, usuários recebem notificações em duplicata até o schedule
antigo expirar naturalmente (nunca, para medicamentos sem data de fim).

## UI

### Tela nova: Ajustes → "Compartilhar e cuidadores"

Três cards:

1. **Parceiro(a)**
   - Vazio: botão "Convidar parceiro"
   - Preenchido: nome + email + "Remover parceiro"
2. **Cuidadores (das suas crianças/cuidados)**
   - Lista: nome do cuidador, perfis com acesso, "Remover"
   - Botão "Adicionar cuidador" → step 1: seleciona perfis (checklist) → step 2: gera link/QR
3. **Você é cuidador em**
   - Lista de owners + perfis a que você tem acesso como cuidador
   - Botão "Sair" por linha

### Fluxo de convite

1. Owner clica "Convidar parceiro" / "Adicionar cuidador"
2. POST cria token → retorna link `https://app/casa/entrar?token=XXX`
3. Tela mostra link, QR, botão "Copiar", botão "Compartilhar" (Web Share API)
4. Convidado abre o link → se não logado, login Google
5. `GET /casa/entrar?token=XXX` valida token, mostra tela de confirmação:
   - "Lucas (lucas@email.com) quer compartilhar 2 perfis com você: **Filho1**,
     **Filho2**."
   - Modo parceiro adiciona: "Vocês vão compartilhar **todos** os perfis um do
     outro, atuais e futuros."
6. Convidado aceita → POST consume token atomicamente via `TransactWriteItems`:
   - Delete `pair#<token>`
   - Put `user#<viewerSub>/shared#<ownerSub>#<profileId>` para cada profile
   - Update `Profile.sharedWith` (append viewerSub) com versão condicional
   - Put partner record (se modo partner) em ambos os lados
   Redireciona pra home com toast.

   **Importante:** o `sharedWith` update e o link record devem estar na mesma
   transação DDB. Se apenas o link record for criado e o `sharedWith` não for
   atualizado, o owner não vê o cuidador na UI e o `notify-dose` não notifica
   o novo membro.

Nice-to-have fora dessa entrega: notificar o convidante via Telegram quando
o convite é aceito.

### Perfis na home / listas

Perfis compartilhados aparecem com **badge sutil** indicando o owner ou
cuidador. Badge não quebra layout — pequeno ícone discreto + tooltip.

Quando você abre detalhe de uma dose marcada: mostra **"Marcado por Maria às
14:23"** (em vez do `takenAt` puro).

### Apagar conta

Se você é owner de perfis com cuidadores/parceiro:

- Se você **tem parceiro**: "Transferir os 3 perfis pra Maria (parceira)" ou
  "Apagar tudo (cuidadores e parceiro perderão acesso)".
- Se você **não tem parceiro**, só cuidadores: só a opção "Apagar tudo
  (cuidadores perderão acesso)". Cuidador não é promovido a owner — quem
  quiser continuar precisa cadastrar do zero ou receber convite de outro
  owner.

Transferir = sequência de operações via `TransactWriteItems` por perfil:
1. Put `user#<newOwner>/profile#<id>` com `ownerSub = newOwner`
2. Delete `user#<oldOwner>/profile#<id>`
3. Delete link record `user#<newOwner>/shared#<oldOwner>#<profileId>` (o newOwner
   era parceiro — agora é dono, não precisa de link record)
4. Para cada cuidador em `sharedWith`: atualizar o link record deles de
   `user#<cuidador>/shared#<oldOwner>#<profileId>` para
   `user#<cuidador>/shared#<newOwner>#<profileId>`. **Isso não cabe num único
   TransactWrite se há muitos cuidadores.** Usar um loop com retry, ou assumir
   que link records de cuidadores com ownerSub stale resultam em um 404 no
   BatchGet (perfil some da lista deles), o que é aceitável na prática porque
   o novo owner pode re-convidar.
5. Limpar o partner record em `user#<newOwner>/partner` (oldOwner foi embora).
6. Não precisa adicionar oldOwner como cuidador (ele está apagando a conta).

**Limitação documentada:** cuidadores de perfis transferidos podem perder
acesso temporariamente se o link record não for atualizado atomicamente. Eles
precisam ser re-convidados pelo novo owner. Documentar isso na UI de transferência:
"Os cuidadores precisarão ser reconvidados pelo novo dono."

Se você é cuidador em casas alheias: apagar conta = sair de todas as casas.
Para cada link record em `user#<sub>/shared#*`:
1. Remover `sub` de `Profile.sharedWith` via UpdateExpression no profile do owner
2. Deletar o link record próprio

Se owner tem um parceiro (não você): o partner record `user#<owner>/partner`
aponta pro sub do owner que está saindo como cuidador — isso não acontece
(parceiro não é cuidador). Sem problema adicional.

## Migração de dados existentes

Script one-shot em `infra/scripts/migrate-profiles-to-shared.ts`.

### Problema de idempotência real

A flag `migratedAt` no config do user não é suficiente para idempotência porque
a migração trabalha item a item. Se o script crashar depois de copiar metade dos
reminders mas antes de setar `migratedAt`, na segunda execução vai re-copiar
sobre itens já escritos (ok) mas não vai re-deletar originais que já foram
deletados (ok). O problema é o sentido contrário: se o script deletar o original
**antes** de escrever a cópia e crashar no meio, o dado é perdido.

**Regra de ouro: NUNCA deletar o original antes de confirmar que a cópia existe.**

### Protocolo de três passes

Para cada user existente:

**Passe 1 — COPY (idempotente via ConditionExpression):**
1. Adiciona `ownerSub = sub`, `sharedWith = []`, `version = 0` ao Profile.
   PutItem com merge (não sobrescreve campos novos se já existirem).
2. Para cada reminder em `user#<sub>/reminder#<id>`: PutItem em
   `profile#<profileId>/reminder#<id>` com
   `ConditionExpression: attribute_not_exists(pk)` (pula se já copiado).
3. Para cada log em `user#<sub>/log#<date>`: extrai `reminderId` do `slotKey`
   (`${reminderId}@${time}`), cruza com a lista de reminders para descobrir
   o `profileId`. Agrupa entradas por profile e faz PutItem em
   `profile#<profileId>/log#<date>` — **preservar o `ttl` original** (não
   recalcular; o item `log#` já tem ttl de 60 dias, copiar o valor existente).
   Entradas de log com `reminderId` sem reminder correspondente (reminder
   deletado) são descartadas — documentar isso como perda aceitável.
4. Para cada notified em `user#<sub>/notified#<date>`: idem, distribuir por
   profile. Preservar `ttl` original.

Ao final do Passe 1, setar `migrationCopyDone = true` no config do user.

**Passe 2 — VERIFY:**
Confirmar que para cada reminder original existe a cópia no destino (GetItem).
Se qualquer cópia estiver faltando, abortar e reportar — não avançar para
o Passe 3.

**Passe 3 — DELETE (só depois do verify passar):**
Deletar os itens originais em `user#<sub>/reminder#*`, `user#<sub>/log#*`,
`user#<sub>/notified#*`. Setar `migratedAt = now` no config do user.

### Janela de escrita durante a migração

O código novo e o código antigo **não podem rodar ao mesmo tempo** para o
mesmo user. O protocolo de deploy é:

```
1. Colocar app em modo de manutenção (ou fazer deploy fora do horário de pico)
2. Rodar o script de migração completo (todos os 3 passes)
3. CDK deploy (novo código web + lambdas)
4. Cleanup dos schedules lr-user-* antigos
5. Tirar do modo de manutenção
```

"Rodar manualmente antes do deploy" só é realista se o volume de usuários for
pequeno e a janela de manutenção for garantida. Para N > ~1000 usuários, usar
feature flag por user (código novo checa `migratedAt` no config e serve do
schema novo; código legado serve do schema antigo). Nessa entrega, assume-se
volume pequeno.

## Fora de escopo nessa entrega (YAGNI)

- Permissões granulares por perfil (parceiro sempre = tudo; cuidador sempre =
  marcar+ver). Se precisar mais tarde, adiciona campo `permissions` em
  `sharedWith[i]`.
- Múltiplos parceiros. Hoje 1.
- Sincronizar config (timezone, leadDays) entre membros. Continua per-user.
- Histórico/auditoria detalhada além de `takenBy` no log.
- Notificação Telegram pro owner quando convite é aceito (nice to have, fica
  pra fase 2).

## Decisões e limitações documentadas

Itens abaixo são problemas conhecidos com decisão tomada explicitamente
(não "vamos ver depois").

### Timezone para notify-dose

`notify-dose` usa o timezone do **owner do perfil** para computar "hoje" e
verificar slots devidos. Cuidadores e parceiros que moram em outro fuso
recebem notificações no horário local do owner. Documentar na tela de
Ajustes → Compartilhar: "Os lembretes são enviados no horário configurado
pelo dono do perfil."

### OpenAI BYOK em perfis compartilhados

Escanear receita usa a chave OpenAI do **usuário autenticado** (não do owner).
Se o usuário não tiver chave configurada, o botão de scan é desabilitado mesmo
em perfis compartilhados. Não há fallback para a chave do owner.

### isDefault em perfis compartilhados

`isDefault` é significativo apenas para o owner. O picker de perfis no
formulário "adicionar reminder" deve listar somente perfis onde o caller tem
role `editor` ou superior (owner ou parceiro). Perfis compartilhados como
cuidador não aparecem no picker de criação de reminders.

### Cuidadores perdem acesso após transferência de ownership

Ao transferir perfis para o parceiro (no fluxo de apagar conta), os link
records dos cuidadores ficam com `ownerSub` stale e causam 404 no BatchGet.
Decisão: aceitar essa perda. O novo owner pode reconvidar os cuidadores.
A UI de transferência deve exibir: "Os cuidadores precisarão ser reconvidados
pelo novo dono."

### Entradas de log para reminders deletados são descartadas na migração

Ao dividir o `DayLog` por profile na migração, entradas cujo `reminderId`
não corresponde a nenhum reminder existente (reminder foi deletado antes da
migração) são descartadas. Isso resulta em perda de histórico de adesão
para reminders deletados. Decisão: aceitar — o TTL de 60 dias significa
que esses logs expirariam em breve de qualquer forma.

### Limite de 48h do Telegram editMessageText

Mensagens enviadas há mais de 48h não podem ser editadas. A chamada
`editMessageText` nesse caso retorna erro 400 do Telegram. Esse erro é
ignorado silenciosamente (log de warning). O log da dose é salvo
independentemente. Usuário pode ver o status atualizado abrindo o app.

## Testes a cobrir no plan

- Unitários:
  - `listProfilesForUser` mescla próprios + compartilhados
  - `Profile.ownerSub` e `sharedWith` populados ao criar
  - Partner record auto-adiciona em novos perfis
  - Permissões: cuidador não pode editar reminder (API retorna 403)
  - Consume de token atômico (race entre dois aceites do mesmo token)
- Integração:
  - Aceitar convite parceiro: dados de ambos os lados ficam linkados
  - Marcar dose: log é atualizado, ambos veem `takenBy`
  - Lambda notify-dose: dispara pra todos chatIds, edita mensagem ao marcar
  - Sair: link records removidos, dados ficam intactos
  - Apagar conta com cuidadores ativos: bloqueado ou transferência limpa
- Migração:
  - Script idempotente (rodar 2x, mesmo resultado)
  - User sem reminders/logs: migra só perfis
  - User com 2 perfis: logs e reminders separados corretamente
