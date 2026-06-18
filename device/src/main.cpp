/**
 * Mostrador físico da timeline — LilyGo T5 4.7" V2.4 (ESP32-S3).
 *
 * Fluxo: conecta WiFi -> GET /api/device/timeline -> desenha doses + eventos.
 * 1 botão (GPIO 21, BUTTON_1 na lib): toque = próxima dose · segurar = marcar.
 * Auto-atualiza a cada REFRESH_MS. (Deep sleep fica pra versão a bateria.)
 */
#include <Arduino.h>
#include <ctype.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include "epd_driver.h"
#include "font_p.h"
#include "Button2.h"

#include "config.h"   // WIFI_SSID, WIFI_PASS, DEVICE_BASE_URL, DEVICE_TOKEN
#include "esp_sleep.h"

#ifndef BOARD_HAS_PSRAM
#error "Habilite a PSRAM (build_flags -DBOARD_HAS_PSRAM)"
#endif

// ── estado ──────────────────────────────────────────────────────────────────
static const int SLEEP_MINUTES = 15; // acorda, atualiza e dorme de novo
static const int MAX_DOSES = 16;
static const int MAX_EVENTS = 8;

struct Dose {
  char slotKey[48];
  char time[6];
  char title[40];
  char who[24];
  char state[8];   // done | now | missed | ahead
  bool taken;
};
struct Event {
  char title[40];
  char who[24];
  char date[11];   // YYYY-MM-DD
  int daysAway;
};

static uint8_t *framebuffer = nullptr;
static Dose doses[MAX_DOSES];
static int doseCount = 0;
static Event events[MAX_EVENTS];
static int eventCount = 0;
static char headerDate[12] = "--/--";   // DD/MM
static char nowClock[6] = "--:--";
static int cursor = 0;
static bool wifiOk = false;
static uint32_t lastFetch = 0;

// Robustez: escuta o botão da lib (GPIO21) E o BOOT (GPIO0). Qualquer um serve.
Button2 btn(BUTTON_1);
Button2 btnBoot(0);

// ── render girado (RETRATO) ───────────────────────────────────────────────────
// A tela é 960x540 (paisagem). Tratamos um canvas RETRATO de PW=540 x PH=960 e
// mapeamos cada pixel girando 90°: portrait (px,py) -> painel (py, 539-px).
// O texto usa a fonte mono gerada (font_p.h), desenhada pixel a pixel já girada.
static const int PW = EPD_HEIGHT;   // 540 (largura do retrato)
static const int PH = EPD_WIDTH;    // 960 (altura do retrato)

static inline void pset(int px, int py, uint8_t color) {
  if ((unsigned)px >= (unsigned)PW || (unsigned)py >= (unsigned)PH) return;
  epd_draw_pixel(py, (EPD_HEIGHT - 1) - px, color, framebuffer);
}

static int pglyph(int px, int py, char c) {
  if (c < PFONT_FIRST || c > PFONT_LAST) return PFONT_W;
  const unsigned char *bmp = &PFONT_BMP[(c - PFONT_FIRST) * PFONT_W * PFONT_H];
  for (int cy = 0; cy < PFONT_H; cy++)
    for (int cx = 0; cx < PFONT_W; cx++) {
      uint8_t a = bmp[cy * PFONT_W + cx];        // tinta 0..255
      if (a > 40) pset(px + cx, py + cy, 255 - a);
    }
  return PFONT_W;
}

static void ptext(int px, int py, const char *s) {
  int x = px;
  for (; *s; s++) { pglyph(x, py, *s); x += PFONT_W; }
}
static int ptextw(const char *s) { return (int)strlen(s) * PFONT_W; }

static void phline(int px, int py, int len) {
  for (int i = 0; i < len; i++) pset(px + i, py, 0);
}

static void truncCopy(char *dst, size_t dstsz, const char *src, int maxch) {
  int n = maxch < (int)dstsz - 1 ? maxch : (int)dstsz - 1;
  if (n < 0) n = 0;
  int i = 0;
  for (; src[i] && i < n; i++) dst[i] = src[i];
  dst[i] = 0;
}

// Iniciais: 1a letra do 1o nome + 1a letra do último (se houver). "Lucas Matos"->"LM".
static void initials(const char *name, char *out) {
  out[0] = 0;
  const char *p = name;
  while (*p == ' ') p++;
  if (!*p) return;
  int n = 0;
  out[n++] = toupper((unsigned char)*p);
  const char *last = nullptr;
  for (const char *q = p; *q; q++) {
    if (*q != ' ' && (q == p || q[-1] == ' ')) last = q;  // início de cada token
  }
  if (last && last != p) out[n++] = toupper((unsigned char)*last);
  out[n] = 0;
}

// ── WiFi ──────────────────────────────────────────────────────────────────────
static bool connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf(">> WiFi conectando em '%s'", WIFI_SSID);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(300);
    Serial.print(".");
  }
  wifiOk = WiFi.status() == WL_CONNECTED;
  if (wifiOk) {
    Serial.print(" OK ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.printf(" FALHOU (status=%d)\n", WiFi.status());
    Serial.println(">> redes visiveis (enc: 0=aberta 3=WPA2 6=WPA3 7=WPA2/3):");
    int n = WiFi.scanNetworks();
    for (int i = 0; i < n; i++) {
      Serial.printf("   %2d) %-28s rssi=%d enc=%d ch=%d\n",
                    i, WiFi.SSID(i).c_str(), WiFi.RSSI(i),
                    (int)WiFi.encryptionType(i), WiFi.channel(i));
    }
  }
  return wifiOk;
}

// HTTPClient apontando pro nosso app (http ou https), com o token no header.
static bool httpBegin(HTTPClient &http, WiFiClientSecure &secure, WiFiClient &plain,
                      const String &url) {
  bool https = url.startsWith("https");
  if (https) {
    secure.setInsecure();           // hobby: pula validação de cert
    return http.begin(secure, url);
  }
  return http.begin(plain, url);
}

// ── buscar timeline ───────────────────────────────────────────────────────────
static bool fetchTimeline() {
  if (!connectWifi()) return false;
  WiFiClientSecure secure;
  WiFiClient plain;
  HTTPClient http;
  String url = String(DEVICE_BASE_URL) + "/api/device/timeline";
  if (!httpBegin(http, secure, plain, url)) {
    Serial.println(">> http.begin falhou");
    return false;
  }
  http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
  int code = http.GET();
  Serial.printf(">> GET timeline -> %d\n", code);
  if (code != 200) {
    http.end();
    return false;
  }
  String body = http.getString();
  http.end();

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    Serial.printf(">> JSON erro: %s\n", err.c_str());
    return false;
  }

  // header: data DD/MM + relógio HH:MM
  const char *date = doc["date"] | "";          // YYYY-MM-DD
  if (strlen(date) == 10) snprintf(headerDate, sizeof(headerDate), "%c%c/%c%c", date[8], date[9], date[5], date[6]);
  int nm = doc["nowMinutes"] | 0;
  snprintf(nowClock, sizeof(nowClock), "%02d:%02d", nm / 60, nm % 60);

  doseCount = 0;
  for (JsonObject d : doc["doses"].as<JsonArray>()) {
    if (doseCount >= MAX_DOSES) break;
    Dose &x = doses[doseCount];
    strlcpy(x.slotKey, d["slotKey"] | "", sizeof(x.slotKey));
    strlcpy(x.time, d["time"] | "", sizeof(x.time));
    strlcpy(x.title, d["title"] | "", sizeof(x.title));
    strlcpy(x.who, d["who"] | "", sizeof(x.who));
    strlcpy(x.state, d["state"] | "ahead", sizeof(x.state));
    x.taken = d["taken"] | false;
    doseCount++;
  }
  eventCount = 0;
  for (JsonObject e : doc["events"].as<JsonArray>()) {
    if (eventCount >= MAX_EVENTS) break;
    Event &x = events[eventCount];
    strlcpy(x.title, e["title"] | "", sizeof(x.title));
    strlcpy(x.who, e["who"] | "", sizeof(x.who));
    strlcpy(x.date, e["date"] | "", sizeof(x.date));
    x.daysAway = e["daysAway"] | 0;
    eventCount++;
  }
  if (cursor >= doseCount) cursor = 0;
  Serial.printf(">> %d doses, %d eventos\n", doseCount, eventCount);
  lastFetch = millis();
  return true;
}

// ── marcar dose ────────────────────────────────────────────────────────────────
static bool postDose(const char *slotKey, bool taken) {
  if (!connectWifi()) return false;
  WiFiClientSecure secure;
  WiFiClient plain;
  HTTPClient http;
  String url = String(DEVICE_BASE_URL) + "/api/device/dose";
  if (!httpBegin(http, secure, plain, url)) return false;
  http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
  http.addHeader("content-type", "application/json");
  String body = String("{\"slotKey\":\"") + slotKey + "\",\"taken\":" + (taken ? "true" : "false") + "}";
  int code = http.POST(body);
  Serial.printf(">> POST dose -> %d\n", code);
  http.end();
  return code == 200;
}

// ── desenho (retrato) ──────────────────────────────────────────────────────────
static const int PM = 24;                          // margem
static const int PMAXCH = (PW - 2 * PM) / PFONT_W; // chars por linha (~30)
static const int PROW = PFONT_H + 14;              // altura de uma linha (~48)
static const int PMAX_DOSES = 16;

static void render(bool full) {
  memset(framebuffer, 0xFF, EPD_WIDTH * EPD_HEIGHT / 2);

  // cabeçalho: "Hoje DD/MM" à esquerda, relógio à direita
  char head[24];
  snprintf(head, sizeof(head), "Hoje  %s", headerDate);
  ptext(PM, 16, head);
  ptext(PW - PM - ptextw(nowClock), 16, nowClock);
  phline(PM, 16 + PFONT_H + 6, PW - 2 * PM);

  int y = 16 + PFONT_H + 18;

  if (doseCount == 0) ptext(PM, y + 10, "Sem doses pra hoje :)");
  if (!wifiOk) ptext(PM, PH - 36, "sem wifi");

  int shown = doseCount < PMAX_DOSES ? doseCount : PMAX_DOSES;
  for (int i = 0; i < shown && y + PROW < PH - 40; i++) {
    Dose &d = doses[i];
    const char *st = strcmp(d.state, "now") == 0 ? "agora"
                    : strcmp(d.state, "missed") == 0 ? "atras." : "";
    char ini[4];
    initials(d.who, ini);
    // direita (justificada): "status INI" — ou só um deles
    char right[16];
    if (st[0] && ini[0]) snprintf(right, sizeof(right), "%s %s", st, ini);
    else snprintf(right, sizeof(right), "%s", ini[0] ? ini : st);
    int rw = (int)strlen(right);

    char left[64];
    snprintf(left, sizeof(left), "%s %s", d.time, d.title);
    char ltr[64];
    truncCopy(ltr, sizeof(ltr), left, PMAXCH - (rw ? rw + 1 : 0));
    ptext(PM, y, ltr);
    if (rw) ptext(PW - PM - rw * PFONT_W, y, right);

    phline(PM, y + PFONT_H + 4, PW - 2 * PM);
    y += PROW;
  }
  if (doseCount > shown) {
    char more[24];
    snprintf(more, sizeof(more), "+%d doses", doseCount - shown);
    ptext(PM, y + 4, more);
    y += PROW;
  }

  // consultas/vacinas SÓ de hoje (daysAway==0)
  int todayEv = 0;
  for (int i = 0; i < eventCount; i++) if (events[i].daysAway == 0) todayEv++;
  if (todayEv > 0 && y + PROW < PH - 20) {
    y += 8;
    ptext(PM, y, "Tambem hoje");
    y += PROW;
    for (int i = 0; i < eventCount && y + PROW < PH - 10; i++) {
      if (events[i].daysAway != 0) continue;
      char ini[4];
      initials(events[i].who, ini);
      int rw = (int)strlen(ini);
      char t[64];
      truncCopy(t, sizeof(t), events[i].title, PMAXCH - (rw ? rw + 1 : 0));
      ptext(PM, y, t);
      if (rw) ptext(PW - PM - rw * PFONT_W, y, ini);
      y += PROW;
    }
  }

  epd_poweron();
  if (full) epd_clear();
  epd_draw_grayscale_image(epd_full_screen(), framebuffer);
  epd_poweroff();
}

// ── botão ────────────────────────────────────────────────────────────────────
static void onTap(Button2 &) {
  if (doseCount == 0) return;
  cursor = (cursor + 1) % doseCount;
  render(false);
}
static void onLong(Button2 &) {
  if (doseCount == 0) { fetchTimeline(); render(true); return; }
  Dose &d = doses[cursor];
  Serial.printf(">> marcando %s -> %s\n", d.slotKey, d.taken ? "desmarcar" : "tomar");
  if (postDose(d.slotKey, !d.taken)) {
    fetchTimeline();
    render(true);
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println(">> mostrador da timeline iniciando");

  framebuffer = (uint8_t *)ps_calloc(sizeof(uint8_t), EPD_WIDTH * EPD_HEIGHT / 2);
  if (!framebuffer) { Serial.println(">> PSRAM falhou"); while (1) delay(100); }
  memset(framebuffer, 0xFF, EPD_WIDTH * EPD_HEIGHT / 2);
  epd_init();

  btn.setClickHandler(onTap);       // toque curto = próxima dose
  btn.setLongClickTime(700);
  btn.setLongClickHandler(onLong);  // segurar = marcar/desmarcar
  btnBoot.setClickHandler(onTap);
  btnBoot.setLongClickTime(700);
  btnBoot.setLongClickHandler(onLong);

  // tela de boas-vindas enquanto conecta
  epd_poweron(); epd_clear();
  ptext(PM, 240, "Conectando...");
  epd_draw_grayscale_image(epd_full_screen(), framebuffer);
  epd_poweroff();

  fetchTimeline();
  render(true);

  // Dorme até a próxima atualização. O e-paper segura a imagem sem energia; no
  // deep sleep o chip reinicia do zero ao acordar, então tudo roda no setup().
  Serial.printf(">> deep sleep por %d min\n", SLEEP_MINUTES);
  Serial.flush();
  esp_sleep_enable_timer_wakeup((uint64_t)SLEEP_MINUTES * 60ULL * 1000000ULL);
  esp_deep_sleep_start();
}

void loop() {}
