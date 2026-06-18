# device — firmware do mostrador físico da timeline

Firmware pra **LilyGo T5 4.7" V2.4 (ESP32-S3)** que mostra a timeline do
`lembrar-remedio` numa tela e-paper, **em retrato**, na geladeira. Busca os dados
de `GET /api/device/timeline` por WiFi e redesenha sozinho a cada 5 min.
Lib da tela: [LilyGo-EPD47](https://github.com/Xinyuan-LilyGO/LilyGo-EPD47).

## Pré-requisitos

- PlatformIO Core (`~/.platformio/penv/bin/pio`) ou a extensão PlatformIO IDE no VS Code.
- Cabo **USB-C de dados** (não serve cabo só-carga).
- `src/config.h` — copie de `src/config.h.example` e preencha WiFi (2.4GHz),
  `DEVICE_BASE_URL` e `DEVICE_TOKEN`. O token sai de **Ajustes → mostrador** no app
  (ou `POST /api/device/token`). **Não vai pro git.**

## Compilar e gravar

```bash
cd device
~/.platformio/penv/bin/pio run -t upload     # compila + grava
~/.platformio/penv/bin/pio device monitor    # logs (115200)
```

## Estrutura

- `platformio.ini` — board json + flags + libs (espelha o projeto oficial da LilyGo).
- `boards/T5-ePaper-S3.json` — definição da placa (S3, 16MB, OPI PSRAM).
- `src/main.cpp` — WiFi → busca timeline → render **retrato** (blitter que gira a
  fonte 90°, já que a lib não rotaciona). Doses do dia + consultas/vacinas de hoje.
- `src/font_p.h` — fonte mono rasterizada (gerada por `tools/gen_font.py`).
- `tools/gen_font.py` — regenera `font_p.h` a partir de uma TTF mono (precisa Pillow).

## Notas

- A tela mostra só o **acionável**: o servidor já filtra fora doses tomadas e
  atrasadas +4h. Perfis aparecem como **iniciais** (ex.: LM, PP).
- Esta placa (versão "Without Touch, Solder Pin") **não tem botão populado** — o
  firmware é só leitura/exibição. Marcar dose continua pelo app/Telegram. O código
  de botão (GPIO21/GPIO0 via Button2) está pronto pra quando soldar um.
- Orientação: o conteúdo é desenhado girado; monte a placa em retrato (USB-C
  embaixo). Pra inverter, troque o mapeamento em `pset()`.
