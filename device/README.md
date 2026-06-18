# device — firmware do mostrador físico da timeline

Firmware pra **LilyGo T5 4.7" V2.4 (ESP32-S3)** que mostra a timeline do
`lembrar-remedio` numa tela e-paper. Lib: [LilyGo-EPD47](https://github.com/Xinyuan-LilyGO/LilyGo-EPD47).

## Pré-requisitos

- PlatformIO Core (instalado em `~/.platformio/penv/bin/pio`) **ou** a extensão
  PlatformIO IDE no VS Code.
- A placa ligada por um cabo **USB-C de dados** (não serve cabo só-carga).

## Compilar e gravar (CLI)

```bash
cd device
~/.platformio/penv/bin/pio run                 # compila
~/.platformio/penv/bin/pio run -t upload       # compila + grava na placa
~/.platformio/penv/bin/pio device monitor      # vê os logs (Serial 115200)
```

> No VS Code: abra a pasta `device/` (Pick a folder) e use os botões
> ✓ (Build) e → (Upload) da barra do PlatformIO.

## Estrutura

- `platformio.ini` — config da placa (board json + flags + libs). Espelha o
  projeto oficial da LilyGo (única combinação garantida pra essa placa).
- `boards/T5-ePaper-S3.json` — definição da placa (S3, 16MB, OPI PSRAM).
- `src/main.cpp` — o sketch. Hoje: Hello World. Depois: busca a timeline e desenha.

## Roadmap

- [x] Hello World na tela
- [ ] Conectar no WiFi
- [ ] Baixar `GET /api/device/timeline` e renderizar
- [ ] Botões: marcar dose (`POST /api/device/dose`)
- [ ] Deep sleep + acordar periódico
