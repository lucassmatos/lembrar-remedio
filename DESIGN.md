---
name: lembrar-remedio
description: PWA de cuidado — horários de remédio, vacinas, retornos e diário do bebê, pra você e pra quem você cuida.
colors:
  paper: "oklch(0.985 0.005 75)"
  paper-2: "oklch(0.965 0.006 75)"
  edge: "oklch(0.905 0.008 75)"
  edge-2: "oklch(0.86 0.009 70)"
  ink: "oklch(0.22 0.012 60)"
  ink-soft: "oklch(0.48 0.012 60)"
  ink-faint: "oklch(0.62 0.012 65)"
  sage: "oklch(0.62 0.07 145)"
  sage-soft: "oklch(0.92 0.035 145)"
  amber: "oklch(0.74 0.13 75)"
  amber-soft: "oklch(0.95 0.06 80)"
  clay: "oklch(0.62 0.1 35)"
  clay-soft: "oklch(0.94 0.04 40)"
  violet: "oklch(0.55 0.13 295)"
  sky: "oklch(0.6 0.1 230)"
  sand: "oklch(0.6 0.07 80)"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "44px"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "-0.01em"
    fontVariation: "'opsz' 32, 'SOFT' 60"
  headline:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "'ss01', 'cv11'"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0.16em"
  numeric:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    fontFeature: "'tnum', 'cv01'"
rounded:
  input: "0.5rem"
  card: "1rem"
  pill: "9999px"
spacing:
  label-gap: "0.75rem"
  card-pad: "1.25rem"
  section-gap: "2.5rem"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "16px 24px"
  chip:
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.pill}"
    padding: "6px 14px"
  chip-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "6px 14px"
  card:
    backgroundColor: "{colors.paper-2}"
    rounded: "{rounded.card}"
    padding: "{spacing.card-pad}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    padding: "8px 14px"
---

# Design System: lembrar-remedio

## 1. Overview: O Caderno de Cuidado

**Creative North Star: "O Caderno de Cuidado"**

A tela é uma página de caderno quente, não um painel de app. Quem usa é mãe, pai ou
cuidador, muitas vezes com uma mão só, às vezes às 3h da manhã com o bebê no colo. O
sistema precisa ser calmo, legível de relance e respeitoso com o cansaço de quem cuida.
A serifa Fraunces dá voz humana aos títulos e aos nomes do que aconteceu ("Soneca",
"Mamadeira"); a Inter cuida do trabalho de leitura miúda. O fundo é papel levemente
creme, nunca branco clínico; o texto é grafite quente, nunca preto duro.

O sistema rejeita explicitamente o que o dono chamou de "app chinês": telas sem seções
claras, hierarquia chapada, e poluição de ícone emoji (😴🤱🍼) usados como decoração. No
lugar disso: rótulos em caixa-alta espaçada que anunciam cada seção, réguas finas que
separam blocos, e uma bolinha de cor discreta no lugar do emoji. Cor é rara e sempre
carrega significado; quando tudo grita, nada se ouve.

A densidade é baixa e o respiro é generoso. Existe um tema noturno automático (20h–08h)
que troca a paleta inteira por tons dim e quentes, porque parte real do uso é de
madrugada e luz forte na cara de quem acabou de acordar é crueldade de design.

**Key Characteristics:**
- Papel quente + grafite quente; zero branco/preto puro.
- Serifa Fraunces pra voz; Inter pra leitura; tabular pra números.
- Seções sempre anunciadas (rótulo caixa-alta + régua ou card).
- Acento de cor ≤10% da tela, sempre semântico.
- Plano por padrão; profundidade por camada tonal, não por sombra.
- Ciente da madrugada (tema noturno automático).

## 2. Colors: A Paleta de Papel

Neutros quentes carregam a tela; três acentos suaves carregam o significado; tudo em
OKLCH, e nada puro nos extremos.

### Primary
- **Grafite Quente** (`oklch(0.22 0.012 60)`, token `ink`): o texto principal E a
  superfície das ações primárias (botões cheios). É o "preto" do sistema, mas tingido de
  quente. `ink-soft` (`oklch(0.48 0.012 60)`) é texto secundário; `ink-faint`
  (`oklch(0.62 0.012 65)`) é rótulo, legenda e placeholder.

### Secondary
Acentos semânticos. Cada um tem um par `-soft` (fundo/realce claro) e some no resto.
- **Sálvia** (`oklch(0.62 0.07 145)`, token `sage`): sono/soneca e estados positivos. É a
  bolinha das sonecas no Diário.
- **Âmbar** (`oklch(0.74 0.13 75)`, token `amber`): mamada/alimentação, "ao vivo" e
  atenção. É a bolinha das mamadas e a cor do pulso do cronômetro.
- **Barro** (`oklch(0.62 0.1 35)`, token `clay`): erro e ação destrutiva. Mensagens de
  validação e o hover de "apagar".

### Tertiary
- **Identidade de perfil** (`violet` `oklch(0.55 0.13 295)`, `sky` `oklch(0.6 0.1 230)`,
  `sand` `oklch(0.6 0.07 80)`, mais sage/amber/clay reusados): cor de cada pessoa que você
  cuida. Aparece só como bolinha no chip e como preenchimento do chip ativo.

### Neutral
- **Papel** (`oklch(0.985 0.005 75)`, token `paper`): fundo da página.
- **Papel 2** (`oklch(0.965 0.006 75)`, token `paper-2`): superfície de card/seção, um
  degrau acima do fundo.
- **Fio** (`oklch(0.905 0.008 75)`, token `edge`): régua e divisória entre itens.
- **Fio 2** (`oklch(0.86 0.009 70)`, token `edge-2`): borda de controle (chip, input,
  stepper), um pouco mais presente que a régua.

### Named Rules
**A Regra da Voz Rara.** Os acentos (sage/amber/clay) ocupam ≤10% de qualquer tela e
nunca são decoração. A ação primária é grafite (`ink`), não colorida. A raridade do
acento é o que faz ele significar algo.

**A Regra do Neutro Quente.** Todo neutro puxa pro hue 60–75 (quente). `#000` e `#fff`
são proibidos: o fundo é papel creme, o texto é grafite quente. Cinza puro nunca.

## 3. Typography

**Display Font:** Fraunces (variável, com fallback Georgia, serif)
**Body Font:** Inter (com fallback system-ui)
**Numeric:** Inter com `tabular-nums` (classe `.tnum`)

**Character:** Fraunces é a voz humana e calorosa do caderno: títulos de tela, nomes de
seção e o nome do que aconteceu. Inter é a mão discreta que cuida da leitura miúda,
botões e rótulos. O contraste serifa/sans é o principal motor de hierarquia, junto com a
escala.

### Hierarchy
- **Display** (Fraunces 400, 44px, line-height 1.05, opsz 32 / SOFT 60): título da tela
  ("Diário", "Lembretes"). Um por tela.
- **Headline** (Fraunces 400, 24px): cabeçalho de pivô dentro da tela, como o rótulo de
  dia no Diário ("Hoje", "Ontem").
- **Title** (Fraunces 400, 18px): nome de um item na lista ("Soneca", "Mamadeira"),
  evento da timeline.
- **Body** (Inter 400, 15px, line-height 1.5): texto corrido, opções de botão. Linha
  máxima 65–75ch.
- **Label** (Inter 400, 12px, letter-spacing 0.16em, minúsculas em caixa-alta): rótulo de
  seção ("pessoas", "soneca", "alimentação"). O anunciador de seção do sistema.
- **Numeric** (Inter `tnum`, 13px): horários, durações e volumes (ml). Alinham em coluna.

### Named Rules
**A Regra do Serif com Parcimônia.** Fraunces só em título de tela, nome de seção (headline)
e nome de item. Corpo, botões e rótulos são Inter. Serifa em texto miúdo vira ruído.

**A Regra do Número Tabular.** Todo horário, duração e volume usa `.tnum`. Números que
pulam de largura entre 1h e 11h denunciam falta de cuidado.

## 4. Elevation

O sistema é **plano por padrão**. Profundidade vem de camada tonal, não de sombra: o
fundo é `paper`, a superfície de seção é `paper-2` (um degrau mais escuro), e bordas
(`edge`/`edge-2`) desenham os limites. Não há sombra de descanso em lugar nenhum.

### Shadow Vocabulary
- **Pulso âmbar** (`box-shadow` animado via `@keyframes ring-pulse`, anel 0→6px de
  `amber` 30%→0%): único uso de sombra, e é movimento, não elevação. Sinaliza um estado
  "ao vivo/atenção" (ex.: o cronômetro de soneca em andamento). Estático nunca.

### Named Rules
**A Regra do Plano por Padrão.** Superfícies são planas em repouso. A única "sombra" é o
pulso âmbar, e só como resposta a um estado vivo. Card com drop-shadow de descanso é
proibido — use o degrau tonal `paper → paper-2 → edge`.

## 5. Components

### Buttons
- **Shape:** cápsula (`rounded-full`, 9999px).
- **Primary:** fundo grafite (`ink`), texto papel, padding generoso (`px-6 py-4` em ação
  de bloco; `px-6 py-3` em ação inline). É a única superfície escura cheia da tela.
- **Hover / Focus:** `opacity: 0.9` no hover; `disabled` é `opacity: 0.5`. Transição de
  cor suave; sem mudança de layout.
- **Ghost / link:** ações terciárias (editar, cancelar) são texto `ink-soft` com
  sublinhado fino (`decoration-edge-2`, underline-offset 4), hover vira `ink`. "Apagar" é
  `ink-faint` com hover `clay`.

### Chips
- **Style:** cápsula; inativo é texto `ink-soft` com borda `edge-2` (1px) e, quando é
  perfil, uma bolinha de cor (8px) antes do nome.
- **State:** ativo preenche com `ink` (ou a cor do perfil) e texto papel; a bolinha some
  porque o fundo já é a cor. "+ pessoa" usa borda tracejada.

### Cards / Containers
- **Corner Style:** `rounded-2xl` (16px).
- **Background:** `paper-2`, um degrau acima do fundo.
- **Shadow Strategy:** nenhuma (ver Elevation). Profundidade é tonal.
- **Border:** 1px `edge`.
- **Internal Padding:** `p-5` (1.25rem).
- **Anúncio:** todo card de seção abre com um rótulo Label (caixa-alta 0.16em
  `ink-faint`), `mb-3`.

### Inputs / Fields
- **Style:** borda `edge-2` (1px), fundo `paper` (ou transparente em campos inline),
  `rounded-lg` (campos) ou `rounded-full` (campos pílula).
- **Focus:** borda escurece pra `ink` (`focus:border-ink`); sem glow.
- **Segmented control:** cápsula com borda `edge-2` e `p-1`; o segmento ativo preenche
  `ink` com texto papel. Usado pra escolher peito/mamadeira/extração.

### Navigation
- **Style:** abas de texto no topo (Timeline · Lembretes · Diário · Ajustes), Inter.
  Inativa `ink-soft`/`ink-faint`, ativa `ink`. Sem pílula de fundo, sem ícone.

### Day Stepper (componente-assinatura)
O navegador de dia do Diário: cabeçalho serif do dia ("Hoje"/"Ontem"/data) à esquerda,
e um par de chevrons SVG agrupados num único pílula com borda `edge-2` e divisória fina
no meio, à direita. Régua `edge` embaixo separa o cabeçalho do log. Botão de passo tem
alvo de 44px; o chevron de avançar fica `opacity-30` (desabilitado) quando já é hoje. É o
padrão de "controle agrupado" do sistema: nunca setas soltas flutuando.

### Category Dot (componente-assinatura)
Bolinha de 8px (`size-2 rounded-full`) que precede o nome serif de cada registro do
Diário, no lugar de emoji: `sage` pra sono, `amber` pra mamada. A linha de detalhe
(horário/duração) fica indentada `18px` pra alinhar sob o nome. É o substituto canônico
do emoji em qualquer lista de tipos.

## 6. Do's and Don'ts

### Do:
- **Do** anunciar toda seção com um rótulo Label (Inter 12px caixa-alta, letter-spacing
  0.16em, `ink-faint`) e separar blocos com régua `edge` ou card `paper-2`.
- **Do** usar a bolinha de categoria (8px, `sage`/`amber`) pra diferenciar tipos numa
  lista.
- **Do** manter a ação primária em grafite (`ink`); reserve cor pra significado semântico.
- **Do** usar `.tnum` em todo horário, duração e volume.
- **Do** agrupar controles relacionados num só contêiner com borda (stepper, segmented),
  com divisória fina entre eles.
- **Do** respeitar o tema noturno: cores via token, nunca hex fixo, pra a paleta dim valer
  de madrugada.

### Don't:
- **Don't** usar emoji como ícone de categoria (`😴` `🤱` `🍼` `🥛`). Use a bolinha de cor.
- **Don't** deixar a tela virar "app chinês": blocos empilhados sem rótulo, sem régua, sem
  hierarquia. Toda seção tem anúncio.
- **Don't** usar `#000`/`#fff` nem cinza puro. Neutro é sempre quente (hue 60–75).
- **Don't** botar setas soltas flutuando; agrupe navegação num pílula único.
- **Don't** colocar drop-shadow de descanso em card. Profundidade é tonal (`paper` →
  `paper-2` → `edge`); a única sombra é o pulso âmbar de estado vivo.
- **Don't** usar serifa (Fraunces) em texto miúdo, botão ou rótulo. Serifa é voz, não
  corpo.
- **Don't** pintar mais que ~10% da tela com acento. Se tudo é colorido, nada significa.
