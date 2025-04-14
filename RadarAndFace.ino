/*
 * ESP32 CAM Radar and Face Tracking System
 * 
 * Required Libraries:
 * - ESP32Servo (Install via Arduino Library Manager)
 * - WiFi.h (Built-in with ESP32)
 * - WebSocketsClient.h (Install via Arduino Library Manager)
 * 
 * Pin Connections:
 * - Trigger Pin: IO2
 * - Echo Pin: IO14
 * - Up/Down Servo: IO15
 * - Radar Servo: IO12
 * - Left/Right Servo: IO13
 */

#include <ESP32Servo.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// WiFi credentials
const char* ssid = "Thu Nam";     // Replace with your WiFi SSID
const char* password = "thunam12345"; // Replace with your WiFi password

// WebSocket server settings
const char* wsHost = "192.168.1.100";    // Replace with your server IP address
const uint16_t wsPort = 8000;            // Server port
const char* wsPath = "/ws/esp32";        // WebSocket path

// Pin definitions for ESP32 CAM
const int radarServoPin = 12; // Changed from 11 to IO12
const int trigPin = 2;        // Changed from 9 to IO2
const int echoPin = 14;       // Changed from 10 to IO14
const int left_rightPin = 13; // Remains IO13
const int up_downPin = 15;    // Changed from 12 to IO15

// Variables
long duration;
int distance;
String inputString;
boolean objectDetected = false;
boolean isShootMode = false;  // Thêm biến theo dõi chế độ bắn

// Timing variables
unsigned long lastDetectionTime = 0;
unsigned long lastCommandTime = 0;
unsigned long currentMillis = 0;
unsigned long shootModeStartTime = 0; // Thời gian bắt đầu chế độ bắn

// Detection counter for debounce
int detectionCounter = 0;

// Last detected position for radar servo
int lastDetectedAngle = 90;
int currentRadarAngle = 15; // Vị trí hiện tại của servo radar
int radarSweepDirection = 1; // 1: tăng dần, -1: giảm dần

// Timeout and threshold constants
const unsigned long DETECTION_DEBOUNCE = 500;  // 500ms consistent detection required
const unsigned long COMMAND_TIMEOUT = 5000;    // 5s without command returns to radar mode
const unsigned long SHOOT_MODE_DURATION = 3000; // Thời gian ở chế độ bắn (3s)
const int CONSECUTIVE_DETECTIONS = 3;          // Number of consecutive detections required
const int DETECTION_DISTANCE = 40;             // cm - detection distance threshold
const int RADAR_DELAY = 30;                   // Delay time (ms) giữa các bước góc servo radar
const int MIN_RADAR_ANGLE = 15;               // Góc tối thiểu của servo
const int MAX_RADAR_ANGLE = 165;              // Góc tối đa của servo

// Servo objects
Servo radarServo;
Servo left_right;
Servo up_down;

// WebSocket client
WebSocketsClient webSocket;
bool websocketConnected = false;

void setup() {
  // Setup servo motors with ESP32 specific settings
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
  
  radarServo.setPeriodHertz(50);  // Standard 50Hz servo
  left_right.setPeriodHertz(50);  // Standard 50Hz servo
  up_down.setPeriodHertz(50);     // Standard 50Hz servo
  
  radarServo.attach(radarServoPin, 500, 2400);
  left_right.attach(left_rightPin, 500, 2400);
  up_down.attach(up_downPin, 500, 2400);
  
  // Setup ultrasonic sensor
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  
  // Initialize serial communication (keep for debugging)
  Serial.begin(115200);
  
  // Initial message
  Serial.println("ESP32 CAM System initializing");
  
  // Connect to WiFi
  connectToWiFi();
  
  // Configure and connect WebSocket client
  setupWebSocket();
  
  // Set initial position for radar servo
  radarServo.write(MIN_RADAR_ANGLE);
  currentRadarAngle = MIN_RADAR_ANGLE;
  radarSweepDirection = 1;
  delay(500); // Give time for the servo to move
  
  // Notify server that system is initialized
  if (websocketConnected) {
    sendMessage("ESP32 CAM System initialized, starting radar scan mode");
  }
}

void loop() {
  // Keep WebSocket connection alive
  webSocket.loop();
  
  // Check WebSocket connection status
  if (!websocketConnected) {
    // Try to reconnect if connection is lost
    static unsigned long lastReconnectAttempt = 0;
    unsigned long now = millis();
    if (now - lastReconnectAttempt > 5000) {
      lastReconnectAttempt = now;
      Serial.println("Attempting to reconnect WebSocket...");
      setupWebSocket();
    }
  }
  
  currentMillis = millis(); // Get current time

  // Check for WebSocket commands
  checkWebSocketCommands();

  if (isShootMode) {
    // Nếu đang ở chế độ bắn
    if (currentMillis - shootModeStartTime > SHOOT_MODE_DURATION) {
      // Hết thời gian bắn, chuyển về chế độ thích hợp
      isShootMode = false;
      if (objectDetected) {
        // Quay lại chế độ tracking
        sendMessage("Shoot completed, returning to tracking mode");
      } else {
        // Quay lại chế độ radar
        sendMessage("Shoot completed, returning to radar scan mode");
      }
    } else {
      // Đang trong chế độ bắn, không làm gì cả ngoài đợi
      delay(50);
    }
  } else if (!objectDetected) {
    // Run radar scanning mode
    radarScanMode();
  } else {
    // Check for timeout in face tracking mode
    if (currentMillis - lastCommandTime > COMMAND_TIMEOUT) {
      objectDetected = false;
      detectionCounter = 0;
      
      // Send message through WebSocket instead of Serial
      sendMessage("Timeout: Returning to radar mode");
      
      // KHÔNG reset servo về vị trí ban đầu, giữ nguyên vị trí hiện tại
      // Chỉ cập nhật hướng quét để bắt đầu quét hợp lý
      if (currentRadarAngle >= MAX_RADAR_ANGLE) {
        radarSweepDirection = -1; // Chuyển sang hướng giảm
      } else if (currentRadarAngle <= MIN_RADAR_ANGLE) {
        radarSweepDirection = 1; // Chuyển sang hướng tăng
      }
    } else {
      // Run face tracking mode only - radar is completely stopped
      faceTrackingMode();
    }
  }
}

// Connect to WiFi network
void connectToWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(ssid);
  
  WiFi.begin(ssid, password);
  
  // Wait for connection
  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 20) {
    delay(500);
    Serial.print(".");
    retries++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("");
    Serial.print("Connected to WiFi. IP address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("");
    Serial.println("Failed to connect to WiFi. Operating in offline mode.");
  }
}

// Setup WebSocket connection
void setupWebSocket() {
  webSocket.begin(wsHost, wsPort, wsPath);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
  
  // Optional: add extra headers
  webSocket.setExtraHeaders("ESP32-Device: RadarAndFace");
  
  Serial.println("WebSocket client configured");
}

// WebSocket event handler
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.println("WebSocket disconnected");
      websocketConnected = false;
      break;
    
    case WStype_CONNECTED:
      Serial.println("WebSocket connected");
      websocketConnected = true;
      
      // Send initial status
      sendMessage("ESP32 CAM System connected via WebSocket");
      break;
    
    case WStype_TEXT:
      // Handle incoming message
      handleIncomingMessage(payload, length);
      break;
  }
}

// Handle incoming WebSocket messages
void handleIncomingMessage(uint8_t * payload, size_t length) {
  // Convert payload to string for easier handling
  String message = String((char*)payload);
  Serial.print("Received message: ");
  Serial.println(message);
  
  // Parse JSON message
  DynamicJsonDocument doc(256);
  DeserializationError error = deserializeJson(doc, message);
  
  if (error) {
    Serial.print("JSON parsing failed: ");
    Serial.println(error.c_str());
    return;
  }
  
  // Process command from server
  String command = doc["command"].as<String>();
  
  if (command == "SHOOT") {
    // Activate shoot mode
    isShootMode = true;
    shootModeStartTime = currentMillis;
    sendMessage("SHOOT command activated");
  }
  else if (command == "SET_ANGLE") {
    // Set radar servo angle
    int angle = doc["angle"];
    if (angle >= MIN_RADAR_ANGLE && angle <= MAX_RADAR_ANGLE) {
      radarServo.write(angle);
      currentRadarAngle = angle;
      
      // Send confirmation
      DynamicJsonDocument response(128);
      response["type"] = "angle_set";
      response["angle"] = angle;
      sendJsonMessage(response);
    }
  }
  else if (command == "TRACK" && objectDetected) {
    // Handle tracking coordinates
    int x_axis = doc["x"];
    int y_axis = doc["y"];
    
    // Update tracking data
    inputString = String(x_axis) + "," + String(y_axis);
    lastCommandTime = currentMillis;
    
    // Process in faceTrackingMode()
    faceTrackingMode();
  }
}

// Replace Serial commands with WebSocket communication
void checkWebSocketCommands() {
  // Nothing to do here as commands are now handled in webSocketEvent
}

// Modified radarScanMode to use WebSocket
void radarScanMode() {
  // Duy trì hướng quét hiện tại (không cần reset về 15 độ)
  if (radarSweepDirection > 0) {
    // Quét tăng dần
    for (int i = currentRadarAngle; i <= MAX_RADAR_ANGLE; i++) {
      if (isShootMode || objectDetected) return; // Thoát nếu có sự kiện ngắt
      
      radarServo.write(i);
      currentRadarAngle = i;
      delay(RADAR_DELAY); // Delay đồng bộ với web app
      
      distance = calculateDistance(); // Get distance reading
      
      // Send radar data via WebSocket instead of Serial
      sendRadarData(i, distance);
      
      // Check if an object is detected - with debounce
      if (distance < DETECTION_DISTANCE) {
        currentMillis = millis();
        
        // First detection or continuing detection
        if (detectionCounter == 0 || (currentMillis - lastDetectionTime < DETECTION_DEBOUNCE)) {
          detectionCounter++;
          lastDetectionTime = currentMillis;
          
          // If we have enough consecutive detections, switch modes
          if (detectionCounter >= CONSECUTIVE_DETECTIONS) {
            objectDetected = true;
            lastCommandTime = currentMillis; // Initialize command timer
            lastDetectedAngle = i; // Save the angle where the object was detected
            
            // Notify via WebSocket instead of Serial
            DynamicJsonDocument doc(256);
            doc["type"] = "object_detected";
            doc["angle"] = i;
            doc["distance"] = distance;
            sendJsonMessage(doc);
            
            // Stop the radar servo at current position
            // No more radar movement until timeout
            return; // Exit function immediately to stop all radar activity
          }
        } else {
          // Too much time elapsed between detections, reset counter
          detectionCounter = 1;
          lastDetectionTime = currentMillis;
        }
      } else {
        // No detection, gradually decrease counter (more resistant to noise)
        if (currentMillis - lastDetectionTime > DETECTION_DEBOUNCE && detectionCounter > 0) {
          detectionCounter--;
        }
      }
      
      // Check for WebSocket messages while scanning
      webSocket.loop();
    }
    
    // Đã đến giới hạn, đổi hướng
    radarSweepDirection = -1;
  }
  
  if (radarSweepDirection < 0) {
    // Quét giảm dần
    for (int i = currentRadarAngle; i >= MIN_RADAR_ANGLE; i--) {
      if (isShootMode || objectDetected) return; // Thoát nếu có sự kiện ngắt
      
      radarServo.write(i);
      currentRadarAngle = i;
      delay(RADAR_DELAY); // Delay đồng bộ với web app
      
      distance = calculateDistance(); // Get distance reading
      
      // Send radar data via WebSocket instead of Serial
      sendRadarData(i, distance);
      
      // Check if an object is detected - with debounce
      if (distance < DETECTION_DISTANCE) {
        currentMillis = millis();
        
        // First detection or continuing detection
        if (detectionCounter == 0 || (currentMillis - lastDetectionTime < DETECTION_DEBOUNCE)) {
          detectionCounter++;
          lastDetectionTime = currentMillis;
          
          // If we have enough consecutive detections, switch modes
          if (detectionCounter >= CONSECUTIVE_DETECTIONS) {
            objectDetected = true;
            lastCommandTime = currentMillis; // Initialize command timer
            lastDetectedAngle = i; // Save the angle where the object was detected
            
            // Notify via WebSocket instead of Serial
            DynamicJsonDocument doc(256);
            doc["type"] = "object_detected";
            doc["angle"] = i;
            doc["distance"] = distance;
            sendJsonMessage(doc);
            
            // Stop the radar servo at current position
            // No more radar movement until timeout
            return; // Exit function immediately to stop all radar activity
          }
        } else {
          // Too much time elapsed between detections, reset counter
          detectionCounter = 1;
          lastDetectionTime = currentMillis;
        }
      } else {
        // No detection, gradually decrease counter (more resistant to noise)
        if (currentMillis - lastDetectionTime > DETECTION_DEBOUNCE && detectionCounter > 0) {
          detectionCounter--;
        }
      }
      
      // Check for WebSocket messages while scanning
      webSocket.loop();
    }
    
    // Đã đến giới hạn, đổi hướng
    radarSweepDirection = 1;
  }
}

// Send radar data via WebSocket
void sendRadarData(int angle, int dist) {
  if (websocketConnected) {
    DynamicJsonDocument doc(128);
    doc["type"] = "radar";
    doc["angle"] = angle;
    doc["distance"] = dist;
    doc["direction"] = radarSweepDirection;
    
    sendJsonMessage(doc);
  }
  
  // Also send to Serial for debugging
  Serial.print(angle);
  Serial.print(",");
  Serial.print(dist);
  Serial.print(".");
  Serial.print(" DIR:");
  Serial.println(radarSweepDirection);
}

// Modified faceTrackingMode to use WebSocket
void faceTrackingMode() {
  // Parse coordinates
  if (inputString.length() > 0 && inputString.indexOf(',') > 0) {
    int x_axis = inputString.substring(0, inputString.indexOf(',')).toInt();
    int y_axis = inputString.substring(inputString.indexOf(',') + 1).toInt();
    
    // Map to servo angles
    int y = map(y_axis, 0, 1080, 0, 180);
    int x = map(x_axis, 0, 1920, 0, 180);
    
    // Move servos
    left_right.write(x);
    up_down.write(y);
    
    // Send feedback via WebSocket
    DynamicJsonDocument doc(128);
    doc["type"] = "tracking";
    doc["x"] = x;
    doc["y"] = y;
    sendJsonMessage(doc);
    
    // Clear input string
    inputString = "";
  }
}

// Helper function to send JSON messages via WebSocket
void sendJsonMessage(DynamicJsonDocument &doc) {
  if (websocketConnected) {
    String jsonString;
    serializeJson(doc, jsonString);
    webSocket.sendTXT(jsonString);
  }
}

// Helper function to send simple text messages
void sendMessage(const String &message) {
  if (websocketConnected) {
    DynamicJsonDocument doc(256);
    doc["type"] = "message";
    doc["content"] = message;
    
    String jsonString;
    serializeJson(doc, jsonString);
    webSocket.sendTXT(jsonString);
  }
  
  // Also print to Serial for debugging
  Serial.println(message);
}

int calculateDistance() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  
  // Send ultrasonic pulse
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  
  // Read echo
  duration = pulseIn(echoPin, HIGH);
  
  // Calculate distance
  distance = duration * 0.034 / 2;
  return distance;
} 