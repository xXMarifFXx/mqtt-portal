'use strict';

// Generate the exact classroom sketch shown after registration. Keeping this outside
// the EJS template makes the username/topic authorization contract unit-testable.
function cppString(value) {
  return JSON.stringify(String(value));
}

function portalSketch(broker, username) {
  const host = cppString(broker.host);
  const port = Number.parseInt(broker.port, 10) || 8883;
  const user = cppString(username);
  return `#include <WiFi.h>
#include <time.h>
#include <NodeBridge.h>
#include <NodeBridgeCerts.h>

const char* WIFI_NAME = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* MQTT_USERNAME = ${user};
const char* MQTT_PASSWORD = "YOUR_PORTAL_PASSWORD";

NodeBridge bridge;

void setup() {
  Serial.begin(115200);

  // Set the clock so the ESP32 can validate mqtt.mariffb.my's TLS certificate.
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);
  unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 15000) delay(200);
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  started = millis();
  while (time(nullptr) < 1700000000 && millis() - started < 15000) delay(200);

  bridge.wifi(WIFI_NAME, WIFI_PASSWORD)
        .broker(${host}, ${port})
        .secure(NODEBRIDGE_ISRG_ROOT_X1)
        .login(MQTT_USERNAME, MQTT_PASSWORD)
        .keepAlive(60)
        .debug(true);

  // Required by this portal: login username = devices/<username>/# topic namespace.
  bridge.begin(MQTT_USERNAME);
}

void loop() {
  bridge.loop();

  static unsigned long last = 0;
  if (millis() - last >= 2000) {
    last = millis();
    bridge.send("temperature", 24.5);
  }
}`;
}

module.exports = { cppString, portalSketch };
