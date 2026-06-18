/**
 * Mostrador físico da timeline — LilyGo T5 4.7" V2.4 (ESP32-S3).
 *
 * Fluxo: conecta WiFi -> GET /api/device/timeline -> desenha doses + eventos.
 * 1 botão (GPIO 21, BUTTON_1 na lib): toque = próxima dose · segurar = marcar.
 * Auto-atualiza a cada REFRESH_MS. (Deep sleep fica pra versão a bateria.)
 */
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include "epd_driver.h"
#include "firasans.h"
#include "Button2.h"

#include "config.h"   // WIFI_SSID, WIFI_PASS, DEVICE_BASE_URL, DEVICE_TOKEN

#ifndef BOARD_HAS_PSRAM
#error "Habilite a PSRAM (build_flags -DBOARD_HAS_PSRAM)"
#endif

// ── estado ──────────────────────────────────────────────────────────────────
static const uint32_t REFRESH_MS = 5UL * 60UL * 1000UL; // re-busca a cada 5 min
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

// ── util de texto ─────────────────────────────────────────────────────────────
static void text(int x, int y, const char *s) {
  int32_t cx = x, cy = y;
  writeln((GFXfont *)&FiraSans, s, &cx, &cy, framebuffer);
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

// ── desenho ──────────────────────────────────────────────────────────────────
static const int ROW_H = 66;
static const int DOSE_Y0 = 100;
static const int MAX_DOSE_ROWS = 5;

static const int MARGIN = 46;
static const int RIGHT = EPD_WIDTH - MARGIN;   // 914

static void render(bool full) {
  memset(framebuffer, 0xFF, EPD_WIDTH * EPD_HEIGHT / 2);

  // cabeçalho: "Hoje  DD/MM" à esquerda, relógio à direita
  text(MARGIN, 58, "Hoje");
  text(210, 58, headerDate);
  text(800, 58, nowClock);
  if (!wifiOk) text(560, 58, "sem wifi");
  epd_draw_hline(MARGIN, 80, EPD_WIDTH - 2 * MARGIN, 0, framebuffer);

  // só as doses do dia
  if (doseCount == 0) {
    text(MARGIN, DOSE_Y0 + 44, "Sem doses pra hoje :)");
  }
  int rows = doseCount < MAX_DOSE_ROWS ? doseCount : MAX_DOSE_ROWS;
  for (int i = 0; i < rows; i++) {
    Dose &d = doses[i];
    int y = DOSE_Y0 + i * ROW_H;
    int base = y + 46;
    text(MARGIN, base, d.time);
    char line[70];
    if (strlen(d.who) > 0) snprintf(line, sizeof(line), "%s  (%s)", d.title, d.who);
    else snprintf(line, sizeof(line), "%s", d.title);
    text(210, base, line);

    // status ancorado na borda direita (glifo + palavra)
    if (d.taken) {
      epd_draw_line(RIGHT - 36, base - 12, RIGHT - 26, base - 2, 0, framebuffer);
      epd_draw_line(RIGHT - 26, base - 2, RIGHT - 6, base - 28, 0, framebuffer);
      text(RIGHT - 130, base, "feito");
    } else if (strcmp(d.state, "now") == 0) {
      epd_fill_circle(RIGHT - 16, base - 12, 9, 0, framebuffer);
      text(RIGHT - 130, base, "agora");
    } else if (strcmp(d.state, "missed") == 0) {
      epd_draw_circle(RIGHT - 16, base - 12, 9, 0, framebuffer);
      text(RIGHT - 170, base, "atrasado");
    } else {
      epd_draw_circle(RIGHT - 16, base - 12, 9, 0, framebuffer);
    }

    // régua de largura cheia: dá estrutura e usa o espaço lateral
    epd_draw_hline(MARGIN, y + ROW_H, EPD_WIDTH - 2 * MARGIN, 0, framebuffer);
  }
  if (doseCount > MAX_DOSE_ROWS) {
    char more[24];
    snprintf(more, sizeof(more), "+%d doses", doseCount - MAX_DOSE_ROWS);
    text(MARGIN, DOSE_Y0 + rows * ROW_H + 40, more);
  }

  // "tambem hoje": consultas/vacinas SÓ de hoje (daysAway==0), sem "Proximos"
  int todayEv = 0;
  for (int i = 0; i < eventCount; i++) if (events[i].daysAway == 0) todayEv++;
  if (todayEv > 0) {
    int ey = DOSE_Y0 + rows * ROW_H + 50;
    text(MARGIN, ey, "Tambem hoje");
    ey += 44;
    for (int i = 0; i < eventCount && ey < 510; i++) {
      if (events[i].daysAway != 0) continue;
      char line[70];
      if (strlen(events[i].who) > 0) snprintf(line, sizeof(line), "%s  (%s)", events[i].title, events[i].who);
      else snprintf(line, sizeof(line), "%s", events[i].title);
      text(MARGIN, ey, line);
      ey += 42;
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
  text(40, 260, "Conectando...");
  epd_draw_grayscale_image(epd_full_screen(), framebuffer);
  epd_poweroff();

  fetchTimeline();
  render(true);
}

void loop() {
  btn.loop();
  btnBoot.loop();
  if (millis() - lastFetch > REFRESH_MS) {
    if (fetchTimeline()) render(true);
    else lastFetch = millis(); // evita martelar em caso de falha
  }
  delay(10);
}
