/*
========================================================================================
  INDUSTRIAL EFFLUENT MONITORING & AUTOMATIC DISCHARGE SAFETY CONTROLLER (ESP32)
  HARDWARE: ESP32 DevKit V1
  SENSORS:
    1. Industrial pH Sensor Kit 4502C (Analog Pin GPIO 34)
    2. Analog TDS Sensor V1.0 (Analog Pin GPIO 35)
    3. Gravity Analog Turbidity Sensor (Analog Pin GPIO 32)
    4. DS18B20 Digital Waterproof Temperature Sensor (OneWire GPIO 4)
    5. YF-S201 Hall-Effect Water Flow Sensor (Interrupt Pin GPIO 27)
  ACTUATORS & INDICATORS:
    - Discharge Cutoff Solenoid Valve Relay (GPIO 25 - Active HIGH/LOW)
    - Safety Cutoff Contactor Relay (GPIO 26)
    - System Status RGB LED / Buzzer (GPIO 33)
========================================================================================
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ====================================================================
// NETWORK & BACKEND CONFIGURATION
// ====================================================================
const char* WIFI_SSID = "YOUR_INDUSTRIAL_WIFI_SSID";
const char* WIFI_PASS = "YOUR_INDUSTRIAL_WIFI_PASSWORD";

// SCADA Backend Ingestion Endpoint
const char* BACKEND_SERVER_URL = "http://YOUR_SERVER_IP:3000/api/sensors/data";
const char* DEVICE_ID = "ESP32-STATION-01";

// ====================================================================
// HARDWARE PIN DEFINITIONS
// ====================================================================
#define PH_PIN            34
#define TDS_PIN           35
#define TURBIDITY_PIN     32
#define ONE_WIRE_BUS      4
#define FLOW_SENSOR_PIN   27

#define VALVE_RELAY_PIN   25
#define SAFETY_RELAY_PIN  26
#define BUZZER_PIN        33

// ====================================================================
// SENSOR OBJECTS & STATE VARIABLES
// ====================================================================
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature tempSensors(&oneWire);

volatile unsigned long pulseCount = 0;
float flowRateLMin = 0.0;
unsigned long oldTime = 0;
const float FLOW_CALIBRATION_FACTOR = 7.5; // YF-S201: pulses per second per L/min

void IRAM_ATTR pulseCounterISR() {
  pulseCount++;
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=================================================");
  Serial.println("EFFLUENT DASHBOARD — ESP32 RTU TELEMETRY ENGINE");
  Serial.println("=================================================");

  // Pin Modes
  pinMode(PH_PIN, INPUT);
  pinMode(TDS_PIN, INPUT);
  pinMode(TURBIDITY_PIN, INPUT);
  pinMode(FLOW_SENSOR_PIN, INPUT_PULLUP);

  pinMode(VALVE_RELAY_PIN, OUTPUT);
  pinMode(SAFETY_RELAY_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  // Initial State: Valve OPEN, Relay INACTIVE
  digitalWrite(VALVE_RELAY_PIN, LOW);
  digitalWrite(SAFETY_RELAY_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);

  // Initialize Temperature & Flow Interrupts
  tempSensors.begin();
  attachInterrupt(digitalPinToInterrupt(FLOW_SENSOR_PIN), pulseCounterISR, FALLING);

  // Connect to WiFi
  connectToWiFi();
}

void connectToWiFi() {
  Serial.print("Connecting to Industrial WiFi: ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 20) {
    delay(500);
    Serial.print(".");
    retries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ WiFi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("Signal Strength (RSSI): ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  } else {
    Serial.println("\n⚠️ WiFi Connection Failed! Will retry in main loop.");
  }
}

// ====================================================================
// SENSOR READING & CALIBRATION FORMULAS
// ====================================================================
float readPH() {
  int samples = 10;
  long sum = 0;
  for (int i = 0; i < samples; i++) {
    sum += analogRead(PH_PIN);
    delay(10);
  }
  float voltage = (sum / (float)samples) * (3.3 / 4095.0);
  // Calibration slope: pH 7.0 = 2.5V, delta = -5.70 pH/V
  float phValue = 7.00 + ((2.50 - voltage) * 3.5);
  return constrain(phValue, 0.0, 14.0);
}

float readTDS(float temperature) {
  int samples = 10;
  long sum = 0;
  for (int i = 0; i < samples; i++) {
    sum += analogRead(TDS_PIN);
    delay(10);
  }
  float voltage = (sum / (float)samples) * (3.3 / 4095.0);
  // Temperature compensation formula
  float compensationCoefficient = 1.0 + 0.02 * (temperature - 25.0);
  float compensationVoltage = voltage / compensationCoefficient;
  // Convert voltage to TDS value in ppm
  float tdsValue = (133.42 * pow(compensationVoltage, 3) - 255.86 * pow(compensationVoltage, 2) + 857.39 * compensationVoltage) * 0.5;
  return max(0.0f, tdsValue);
}

float readTurbidity() {
  int samples = 10;
  long sum = 0;
  for (int i = 0; i < samples; i++) {
    sum += analogRead(TURBIDITY_PIN);
    delay(10);
  }
  float voltage = (sum / (float)samples) * (3.3 / 4095.0);
  // Turbidity curve formula for Gravity sensor
  float ntu = 0.0;
  if (voltage < 2.5) {
    ntu = 3000.0;
  } else {
    ntu = -1120.4 * pow(voltage, 2) + 5742.3 * voltage - 4353.8;
  }
  return constrain(ntu, 0.0, 3000.0);
}

float readTemperature() {
  tempSensors.requestTemperatures();
  float tempC = tempSensors.getTempCByIndex(0);
  if (tempC == DEVICE_DISCONNECTED_C || tempC < -10.0 || tempC > 100.0) {
    return 28.5; // Fallback safe default if probe unplugged
  }
  return tempC;
}

float calculateFlowRate() {
  unsigned long now = millis();
  unsigned long duration = now - oldTime;
  if (duration >= 1000) {
    detachInterrupt(digitalPinToInterrupt(FLOW_SENSOR_PIN));
    flowRateLMin = ((1000.0 / duration) * pulseCount) / FLOW_CALIBRATION_FACTOR;
    oldTime = now;
    pulseCount = 0;
    attachInterrupt(digitalPinToInterrupt(FLOW_SENSOR_PIN), pulseCounterISR, FALLING);
  }
  return flowRateLMin;
}

// ====================================================================
// MAIN TELEMETRY LOOP
// ====================================================================
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
  }

  // 1. Read All Physical Sensors
  float temperature = readTemperature();
  float ph = readPH();
  float tds = readTDS(temperature);
  float turbidity = readTurbidity();
  float flow = calculateFlowRate();

  Serial.println("\n-------------------------------------------");
  Serial.printf("Telemetry Samples: pH=%.2f | TDS=%.1f ppm | Turb=%.1f NTU | Temp=%.1f C | Flow=%.2f L/min\n",
                ph, tds, turbidity, temperature, flow);

  // 2. Prepare JSON Payload
  StaticJsonDocument<512> doc;
  doc["device_id"] = DEVICE_ID;
  doc["source"] = "ESP32";
  doc["ph"] = ph;
  doc["tds"] = tds;
  doc["turbidity"] = turbidity;
  doc["temperature"] = temperature;
  doc["flow"] = flow;
  doc["rssi"] = WiFi.RSSI();

  String requestBody;
  serializeJson(doc, requestBody);

  // 3. Transmit to Backend SCADA API via HTTP POST
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(BACKEND_SERVER_URL);
    http.addHeader("Content-Type", "application/json");

    int httpResponseCode = http.POST(requestBody);

    if (httpResponseCode > 0) {
      String response = http.getString();
      Serial.printf("✅ Server Response (%d): %s\n", httpResponseCode, response.c_str());

      // Parse safety command response from server
      StaticJsonDocument<512> resDoc;
      DeserializationError error = deserializeJson(resDoc, response);
      if (!error) {
        bool dischargeAllowed = resDoc["dischargeAllowed"] | true;
        const char* status = resDoc["status"] | "SAFE";

        if (!dischargeAllowed || strcmp(status, "CRITICAL") == 0 || strcmp(status, "EMERGENCY") == 0) {
          // Engage Safety Cutoff
          digitalWrite(VALVE_RELAY_PIN, HIGH);   // Close Valve
          digitalWrite(SAFETY_RELAY_PIN, HIGH);  // Cutoff Relay ON
          digitalWrite(BUZZER_PIN, HIGH);        // Alarm ON
          Serial.println("🚨 CRITICAL HAZARD: Discharge valve CLOSED by SCADA command.");
        } else {
          // Normal Operation
          digitalWrite(VALVE_RELAY_PIN, LOW);    // Open Valve
          digitalWrite(SAFETY_RELAY_PIN, LOW);   // Relay OFF
          digitalWrite(BUZZER_PIN, LOW);         // Alarm OFF
        }
      }
    } else {
      Serial.printf("❌ Transmission Error: %s\n", http.errorToString(httpResponseCode).c_str());
    }
    http.end();
  }

  // Sample every 2 seconds
  delay(2000);
}
