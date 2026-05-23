# lembrar-remedio

App simples pra controlar horários de remédio. Cadastra o remédio, define
de quantas em quantas horas, marca no checkbox quando tomou. Notificação
local via Web Notifications API enquanto o app estiver aberto (ou instalado
como PWA e ativo).

**Tudo no navegador.** Sem backend, sem banco, sem login. Os dados ficam
em `localStorage` no seu device.

Stack: Next.js 15 (App Router), Tailwind v4, Service Worker pra PWA,
Notifications API.

## Rodar local

```bash
npm install
npx next dev
```

Abre em `http://localhost:3000`.

## Deploy na Vercel

1. Cria um repo, importa na Vercel.
2. Deploy. Não precisa de variável de ambiente nenhuma.
3. Abre a URL no celular, vai em **Ajustes**, libera notificação, instala
   como PWA ("Adicionar à Tela de Início" no iOS, "Instalar app" no Android).

## Como funcionam as notificações

Enquanto a aba estiver aberta (ou o PWA estiver rodando), o app checa a
cada 30s se tem dose dentro da janela atual (15 min antes/depois) que
ainda não foi marcada e não foi notificada hoje. Se sim, dispara um
`Notification` via Service Worker (ou direto se SW não estiver pronto).

**Limitação importante:** com o app totalmente fechado, navegador não
roda nada em background. Pra alarme "garantido" mesmo com tudo fechado
você precisaria de Web Push com servidor (backend + VAPID) ou alarme
nativo do celular. Pro uso prático (abrir de manhã, deixar instalado),
funciona bem.

| Plataforma | Com aba/PWA aberto | Com tudo fechado |
|---|---|---|
| Chrome desktop | ✓ | – |
| Android Chrome (PWA instalada) | ✓ | – |
| iOS Safari (PWA instalada, 16.4+) | ✓ | – |
| Firefox | ✓ | – |

## Estrutura

```
app/
  page.tsx                    hoje (lista de doses do dia)
  medications/page.tsx        cadastro de remédios
  settings/page.tsx           permissão, instalar, fuso, apagar dados
  _components/                shell, nav, dose list, formulário, banner
  globals.css
  layout.tsx
lib/
  storage.ts                  wrapper de localStorage + eventos
  schedule.ts                 geração de horários do dia
  types.ts
public/
  sw.js                       service worker (cache + notification click)
  icon.svg
  manifest.webmanifest        (em app/ via Next.js, exposto na raiz)
```

## Dados

Tudo em `localStorage`, prefixo `lr.`:

- `lr.meds.v1` — lista de remédios
- `lr.config.v1` — fuso horário
- `lr.log.YYYY-MM-DD` — quais doses do dia foram marcadas como tomadas
- `lr.notified.YYYY-MM-DD` — quais doses do dia já dispararam notificação

Logs com mais de 60 dias são limpos automaticamente.
