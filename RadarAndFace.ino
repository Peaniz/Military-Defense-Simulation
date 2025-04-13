#include <Servo.h>

// Pin definitions
const int radarServoPin = 11;
const int trigPin = 9;
const int echoPin = 10;
const int left_rightPin = 13;
const int up_downPin = 12;

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

void setup() {
  // Setup servo motors
  radarServo.attach(radarServoPin);
  left_right.attach(left_rightPin);
  up_down.attach(up_downPin);
  
  // Setup ultrasonic sensor
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  
  // Initialize serial communication
  Serial.begin(9600);
  
  // Initial message
  Serial.println("System initialized, starting radar scan mode");
  
  // Set initial position for radar servo
  radarServo.write(MIN_RADAR_ANGLE);
  currentRadarAngle = MIN_RADAR_ANGLE;
  radarSweepDirection = 1;
  delay(500); // Give time for the servo to move
}

void loop() {
  currentMillis = millis(); // Get current time

  // Kiểm tra lệnh từ Serial (ưu tiên)
  checkSerialCommands();

  if (isShootMode) {
    // Nếu đang ở chế độ bắn
    if (currentMillis - shootModeStartTime > SHOOT_MODE_DURATION) {
      // Hết thời gian bắn, chuyển về chế độ thích hợp
      isShootMode = false;
      if (objectDetected) {
        // Quay lại chế độ tracking
        Serial.println("Shoot completed, returning to tracking mode");
      } else {
        // Quay lại chế độ radar
        Serial.println("Shoot completed, returning to radar scan mode");
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
      Serial.println("Timeout: Returning to radar mode");
      
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

// Kiểm tra các lệnh đặc biệt từ Serial
void checkSerialCommands() {
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\r');
    
    if (command == "SHOOT") {
      // Kích hoạt chế độ bắn
      isShootMode = true;
      shootModeStartTime = currentMillis;
      Serial.println("SHOOT command activated");
    }
    else if (command.startsWith("SET_ANGLE:")) {
      // Lệnh SET_ANGLE:90 sẽ đặt góc servo thành 90 độ
      int angle = command.substring(10).toInt();
      if (angle >= MIN_RADAR_ANGLE && angle <= MAX_RADAR_ANGLE) {
        radarServo.write(angle);
        currentRadarAngle = angle;
        Serial.print("Radar angle set to: ");
        Serial.println(angle);
      }
    }
    else if (objectDetected && command.indexOf(',') > 0) {
      // Đây là tọa độ tracking
      inputString = command;
      lastCommandTime = currentMillis; // Update last command time
      
      // Xử lý trong faceTrackingMode()
      faceTrackingMode();
    }
  }
}

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
      
      // Gửi dữ liệu góc và khoảng cách
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
            
            // Stop radar and fully switch to face tracking mode
            Serial.print("Object detected at angle ");
            Serial.print(i);
            Serial.print(" and distance ");
            Serial.print(distance);
            Serial.println(" cm, switching to face tracking mode");
            
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
      
      // Kiểm tra lệnh từ Serial trong khi quét
      checkSerialCommands();
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
      
      // Gửi dữ liệu góc và khoảng cách
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
            
            // Stop radar and fully switch to face tracking mode
            Serial.print("Object detected at angle ");
            Serial.print(i);
            Serial.print(" and distance ");
            Serial.print(distance);
            Serial.println(" cm, switching to face tracking mode");
            
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
      
      // Kiểm tra lệnh từ Serial trong khi quét
      checkSerialCommands();
    }
    
    // Đã đến giới hạn, đổi hướng
    radarSweepDirection = 1;
  }
}

// Hàm riêng để gửi dữ liệu góc và khoảng cách
void sendRadarData(int angle, int dist) {
  Serial.print(angle);
  Serial.print(",");
  Serial.print(dist);
  Serial.print(".");
  
  // Thêm thông tin hướng quét để web app dễ theo dõi
  Serial.print(" DIR:");
  Serial.println(radarSweepDirection);
}

void faceTrackingMode() {
  // Parse coordinates (đã được đọc trong checkSerialCommands)
  if (inputString.length() > 0 && inputString.indexOf(',') > 0) {
    int x_axis = inputString.substring(0, inputString.indexOf(',')).toInt();
    int y_axis = inputString.substring(inputString.indexOf(',') + 1).toInt();
    
    // Map to servo angles
    int y = map(y_axis, 0, 1080, 0, 180);
    int x = map(x_axis, 0, 1920, 0, 180);
    
    // Move servos
    left_right.write(x);
    up_down.write(y);
    
    // Send feedback
    Serial.print("Face tracking - X: ");
    Serial.print(x);
    Serial.print(", Y: ");
    Serial.println(y);
    
    // Clear input string
    inputString = "";
  }
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