import os
import math
import json
import asyncio
import threading
import time
import traceback
import numpy as np
from typing import List, Dict, Any, Optional
import serial
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import mediapipe as mp
import cv2
import base64

# Constants
ARDUINO_COM_PORT = 'COM6'  # Change to your ESP32 port
MIN_RADAR_ANGLE = 15       # Góc tối thiểu của servo radar
MAX_RADAR_ANGLE = 165      # Góc tối đa của servo radar
DETECTION_DISTANCE = 40    # Khoảng cách phát hiện đối tượng (cm) - khớp với ESP32
ARDUINO_DELAY = 30         # Delay time (ms) của ESP32 servo giữa các bước góc

# Initialize FastAPI
app = FastAPI(title="Web Radar Tracking System")

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Setup Jinja2 templates
templates = Jinja2Templates(directory="templates")

# Global variables
serial_port = None
running = True
radar_angle = 90  # Góc khởi đầu ở giữa
radar_direction = 1  # 1: đang tăng góc, -1: đang giảm góc
radar_distance = 0
mode = "RADAR"  # "RADAR" or "TRACKING"
system_message = "Initializing system..."
tracking_position = (0, 0)
tracking_mode = 1  # 1 = Face, 2 = Hand
detected_angle = 0
detected_distance = 0
main_event_loop = None  # Store the main event loop
last_serial_update_time = time.time()  # Thời điểm nhận được dữ liệu serial cuối cùng
using_simulated_values = True  # Mặc định sử dụng giá trị mô phỏng cho radar
last_received_angle = 90  # Góc cuối cùng nhận được từ ESP32
consecutive_static_updates = 0  # Đếm số lần nhận được góc không thay đổi
radar_moving = False  # Flag để xác định khi nào servo đang quay
last_radar_data_time = 0  # Thời gian nhận được dữ liệu radar cuối cùng
is_object_detected = False  # Add this flag to track object detection status
waiting_for_first_radar_data = False  # Flag to indicate waiting for first radar data after mode switch

# Thread safety
serial_lock = threading.Lock()

# Missing libraries check
MISSING_LIBRARIES = []
try:
    import cv2
except ImportError:
    MISSING_LIBRARIES.append("opencv-python")

try:
    import mediapipe as mp
    mp_face_mesh = mp.solutions.face_mesh
    mp_hands = mp.solutions.hands
    mp_drawing = mp.solutions.drawing_utils
except ImportError:
    MISSING_LIBRARIES.append("mediapipe")

# Face/Hand tracking variables
face_detector = None
hand_detector = None
FACE_CENTER_KEYPOINTS = [168, 6, 197, 195, 5]
NOSE_KEYPOINTS = [1, 2, 3, 4, 5, 6, 168, 197, 195]
WRIST_IDX = 0

# Connected WebSocket clients
connected_clients = []

# Camera handling
class CameraThread(threading.Thread):
    def __init__(self, loop):
        threading.Thread.__init__(self)
        self.daemon = True
        self.paused = True
        self.pause_cond = threading.Condition(threading.Lock())
        self.frame = None
        self.camera_initialized = False
        self.object_detected = False
        self.last_position = None
        self.encoded_frame = None
        self.loop = loop  # Store the event loop
        
    def run(self):
        global tracking_position, system_message
        
        print("Camera thread starting...")
        
        try:
            # Initialize detectors
            self.initialize_detectors()
            
            # Main camera thread loop
            while running:
                with self.pause_cond:
                    if self.paused:
                        # Wait for unpause
                        self.pause_cond.wait()
                        
                        # Initialize camera when unpaused
                        if not self.camera_initialized:
                            self.initialize_camera()
                
                # Process camera if in tracking mode
                if not self.paused and self.camera_initialized:
                    try:
                        # Get frame from camera
                        ret, frame = self.capture.read()
                        
                        if not ret:
                            time.sleep(0.1)
                            continue
                            
                        # Flip image horizontally
                        frame = cv2.flip(frame, 1)
                        
                        # Process for detection
                        self.process_frame(frame)
                        
                        # Store frame
                        self.frame = frame
                        
                        # Convert to base64 for websocket
                        _, jpeg = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
                        self.encoded_frame = base64.b64encode(jpeg.tobytes()).decode('utf-8')
                        
                        # Send frame to clients
                        if connected_clients and self.encoded_frame:
                            camera_data = {
                                "type": "camera",
                                "image": self.encoded_frame,
                                "tracking": {
                                    "x": int(tracking_position[0]),
                                    "y": int(tracking_position[1])
                                } if tracking_position != (0, 0) else None
                            }
                            # Use the stored event loop instead of trying to get one in this thread
                            asyncio.run_coroutine_threadsafe(broadcast_message(json.dumps(camera_data)), self.loop)
                    except Exception as e:
                        print(f"Error processing camera frame: {e}")
                        traceback.print_exc()
                        time.sleep(0.1)
                else:
                    time.sleep(0.1)
        except Exception as e:
            print(f"Camera thread error: {e}")
            traceback.print_exc()
        finally:
            # Clean up
            if hasattr(self, 'capture') and self.capture is not None:
                self.capture.release()
            
            print("Camera thread exiting")
    
    def initialize_detectors(self):
        global face_detector, hand_detector, tracking_mode
        
        try:
            # Close any existing detectors
            if face_detector:
                face_detector.close()
            if hand_detector:
                hand_detector.close()
            
            face_detector = None
            hand_detector = None
            
            # Initialize based on mode
            if tracking_mode == 1:
                # Face tracking
                face_detector = mp_face_mesh.FaceMesh(
                    max_num_faces=1,
                    refine_landmarks=True,
                    min_detection_confidence=0.5,
                    min_tracking_confidence=0.5
                )
                print("Face detector initialized")
            else:
                # Hand tracking
                hand_detector = mp_hands.Hands(
                    model_complexity=0,
                    max_num_hands=1,
                    min_detection_confidence=0.5,
                    min_tracking_confidence=0.5
                )
                print("Hand detector initialized")
        except Exception as e:
            print(f"Error initializing detectors: {e}")
            traceback.print_exc()
                
    def initialize_camera(self):
        try:
            # Try to initialize camera (default webcam)
            print("Initializing camera...")
            self.capture = cv2.VideoCapture(0)
                
            # Set resolution
            self.capture.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
            self.capture.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
                
            # Check if camera opened successfully
            if not self.capture.isOpened():
                print("Error: Could not open camera")
                return False
                
            print(f"Camera initialized with resolution: {int(self.capture.get(cv2.CAP_PROP_FRAME_WIDTH))}x{int(self.capture.get(cv2.CAP_PROP_FRAME_HEIGHT))}")
            self.camera_initialized = True
            return True
            
        except Exception as e:
            print(f"Camera initialization error: {e}")
            traceback.print_exc()
            return False
    
    def process_frame(self, frame):
        global tracking_position, tracking_mode, serial_port
        
        if frame is None:
            return
        
        # Convert to RGB for MediaPipe
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        frame_height, frame_width = frame.shape[:2]
        
        self.object_detected = False
        
        try:
            if tracking_mode == 1 and face_detector:
                # Face detection
                results = face_detector.process(rgb_frame)
                
                if results.multi_face_landmarks:
                    self.object_detected = True
                    
                    for face_landmarks in results.multi_face_landmarks:
                        # Calculate nose position
                        nose_x, nose_y = 0, 0
                        for idx in NOSE_KEYPOINTS:
                            nose_x += face_landmarks.landmark[idx].x * frame_width
                            nose_y += face_landmarks.landmark[idx].y * frame_height
                        nose_x /= len(NOSE_KEYPOINTS)
                        nose_y /= len(NOSE_KEYPOINTS)
                        
                        # Save position
                        self.last_position = (nose_x, nose_y)
                        tracking_position = (nose_x, nose_y)
                        
                        # Send to ESP32
                        self.send_coordinates_to_esp32(nose_x, nose_y, frame_width, frame_height)
                        
            elif tracking_mode == 2 and hand_detector:
                # Hand detection
                results = hand_detector.process(rgb_frame)
                
                if results.multi_hand_landmarks:
                    self.object_detected = True
                    
                    for hand_landmarks in results.multi_hand_landmarks:
                        # Get wrist position
                        wrist_x = hand_landmarks.landmark[WRIST_IDX].x * frame_width
                        wrist_y = hand_landmarks.landmark[WRIST_IDX].y * frame_height
                        
                        # Save position
                        self.last_position = (wrist_x, wrist_y)
                        tracking_position = (wrist_x, wrist_y)
                        
                        # Send to ESP32
                        self.send_coordinates_to_esp32(wrist_x, wrist_y, frame_width, frame_height)
        
        except Exception as e:
            print(f"Error in frame processing: {e}")
            traceback.print_exc()
    
    def send_coordinates_to_esp32(self, x, y, frame_width, frame_height):
        global serial_port, system_message
        
        try:
            # Get lock to prevent simultaneous access
            with serial_lock:
                if serial_port is not None and serial_port.is_open:
                    coordinates = f"{int(x)},{int(y)}\r"
                    serial_port.write(coordinates.encode())
                    print(f"Sent to ESP32: X={int(x)}, Y={int(y)}")
                    system_message = f"Tracking: X={int(x)}, Y={int(y)}"
        except Exception as e:
            print(f"Error sending coordinates to ESP32: {e}")
            system_message = f"Tracking error: {str(e)}"
    
    def pause(self):
        with self.pause_cond:
            self.paused = True
            print("Camera thread paused")
    
    def resume(self):
        with self.pause_cond:
            self.paused = False
            self.pause_cond.notify()
            print("Camera thread resumed")
    
    def is_paused(self):
        return self.paused
    
    def cleanup(self):
        try:
            # Release camera
            if hasattr(self, 'capture') and self.capture is not None:
                self.capture.release()
            
            # Close detectors
            if face_detector:
                face_detector.close()
            if hand_detector:
                hand_detector.close()
        except Exception as e:
            print(f"Error in camera cleanup: {e}")

# Initialize camera thread
camera_thread = None

# Setup serial connection
def setup_serial():
    global serial_port, system_message
    
    try:
        serial_port = serial.Serial(ARDUINO_COM_PORT, 115200)  # Updated baud rate for ESP32
        serial_port.timeout = 0.1
        system_message = f"Connected to ESP32 CAM on {ARDUINO_COM_PORT}"
        print(system_message)
        return True
    except serial.SerialException as e:
        system_message = f"Warning: Could not open serial port '{ARDUINO_COM_PORT}': {str(e)}"
        print(system_message)
        return False
    except Exception as e:
        system_message = f"Error with serial port: {str(e)}"
        print(system_message)
        return False

# Serial data processing
async def read_serial():
    global radar_angle, radar_distance, radar_direction, mode, detected_angle, detected_distance
    global system_message, camera_thread, last_serial_update_time, last_received_angle
    global consecutive_static_updates, radar_moving, last_radar_data_time, is_object_detected
    global waiting_for_first_radar_data
    
    if serial_port is None or not serial_port.is_open:
        return
    
    try:
        with serial_lock:
            if serial_port.in_waiting > 0:
                # Read data
                raw_data = serial_port.readline()
                
                try:
                    # Try decoding with different encodings
                    try:
                        radar_data = raw_data.decode('utf-8').strip()
                    except UnicodeDecodeError:
                        radar_data = raw_data.decode('latin-1').strip()
                    
                    print(f"Received from ESP32: {radar_data}")  # Debug: print received data
                    
                    # Check for events or radar data
                    if "Object detected at angle" in radar_data:
                        # Extract angle and distance
                        import re
                        match_angle = re.search(r"angle (\d+)", radar_data)
                        match_distance = re.search(r"distance (\d+)", radar_data)
                        
                        if match_angle and match_distance:
                            detected_angle = int(match_angle.group(1))
                            detected_distance = int(match_distance.group(1))
                            
                            # First broadcast the detection to radar clients
                            await broadcast_message(json.dumps({
                                "type": "object_detected",
                                "angle": detected_angle,
                                "distance": detected_distance
                            }))
                            
                            # Wait a moment to let the client display the detection
                            await asyncio.sleep(0.3)  # Giảm độ trễ
                            
                            # THEN switch to tracking mode
                            if mode != "TRACKING":
                                await switch_to_tracking_mode()
                                
                    elif "Timeout: Returning to radar mode" in radar_data:
                        # Switch back to radar mode
                        if mode != "RADAR":
                            await switch_to_radar_mode()
                            
                    elif "System initialized" in radar_data:
                        mode = "RADAR"
                        system_message = "System initialized, radar scanning active"
                        
                        # Reset for a fresh start
                        radar_angle = 15
                        last_received_angle = 15
                        radar_direction = 1  # Start with increasing angle
                        radar_moving = True  # Mặc định ESP32 bắt đầu với việc quét radar
                            
                    elif '.' in radar_data:
                        # ESP32 sends data in format "angle,distance."
                        # Ensure we parse it correctly
                        try:
                            # Get portion before the dot
                            radar_data = radar_data.split('.')[0].strip()
                            
                            if ',' in radar_data:
                                parts = radar_data.split(',')
                                if len(parts) >= 2:
                                    try:
                                        new_angle = int(parts[0])
                                        new_distance = int(parts[1])
                                        
                                        # Thời gian nhận dữ liệu radar
                                        current_time = time.time()
                                        last_radar_data_time = current_time
                                        
                                        # Kiểm tra nếu góc thay đổi, đánh dấu radar đang di chuyển
                                        if abs(last_received_angle - new_angle) > 1:
                                            radar_moving = True
                                            consecutive_static_updates = 0  # Reset bộ đếm
                                            print(f"Radar is moving. Angle changed from {last_received_angle} to {new_angle}")
                                            
                                            # Determine radar direction based on angle change
                                            if new_angle > last_received_angle:
                                                radar_direction = 1  # Increasing angles (e.g., 15 to 165)
                                            else:
                                                radar_direction = -1  # Decreasing angles (e.g., 165 to 15)
                                        else:
                                            # Góc không thay đổi, tăng bộ đếm
                                            consecutive_static_updates += 1
                                            
                                            # Nếu nhận được nhiều cập nhật liên tiếp với cùng một góc, có thể servo đang dừng
                                            if consecutive_static_updates > 5:
                                                radar_moving = False
                                                print(f"Radar stopped. Angle stable at {new_angle}")
                                        
                                        # Lưu góc nhận được để so sánh lần sau
                                        last_received_angle = new_angle
                                        
                                        # Always update radar values
                                        radar_angle = new_angle
                                        radar_distance = new_distance
                                        last_serial_update_time = current_time
                                        
                                        # Enforce limits
                                        if radar_angle < MIN_RADAR_ANGLE:
                                            radar_angle = MIN_RADAR_ANGLE
                                        elif radar_angle > MAX_RADAR_ANGLE:
                                            radar_angle = MAX_RADAR_ANGLE
                                            
                                        # Check if we should highlight potential object detection
                                        detection_highlight = radar_distance < DETECTION_DISTANCE
                                        
                                        # IMPORTANT: Always broadcast to ensure radar moves
                                        await broadcast_message(json.dumps({
                                            "type": "radar",
                                            "angle": radar_angle,
                                            "distance": radar_distance,
                                            "mode": mode,
                                            "direction": radar_direction,
                                            "detection": detection_highlight,
                                            "moving": radar_moving,
                                            "timestamp": current_time
                                        }))
                                        
                                        if waiting_for_first_radar_data and mode == "RADAR":
                                            waiting_for_first_radar_data = False
                                            system_message = "✅ Radar data received from ESP32, resuming normal operation"
                                            print("✅ First radar data received after mode switch - unfreezing radar")
                                            
                                            # Update detection_highlight correctly using is_object_detected
                                            is_object_detected = detection_highlight
                                            
                                            # IMPORTANT: Always broadcast to ensure radar moves
                                            await broadcast_message(json.dumps({
                                                "type": "radar",
                                                "angle": radar_angle,
                                                "distance": radar_distance,
                                                "mode": mode,
                                                "direction": radar_direction,
                                                "detection": detection_highlight,
                                                "moving": radar_moving,
                                                "timestamp": current_time,
                                                "first_data_after_switch": True,
                                                "resume_animation": True  # Tell frontend to resume animation
                                            }))
                                        
                                    except ValueError:
                                        print(f"Error parsing values: '{parts}'")
                                        pass  # Ignore invalid data
                        except Exception as e:
                            print(f"Error parsing radar data '{radar_data}': {e}")
                except Exception as e:
                    print(f"Error parsing serial data: {e}")
    except Exception as e:
        print(f"Serial communication error: {e}")
        system_message = f"Serial error: {str(e)}"

# Mode switching
async def switch_to_tracking_mode():
    global mode, system_message, camera_thread
    
    mode = "TRACKING"
    system_message = "Object detected! Switching to tracking mode"
    print(system_message)
    
    # Start camera if needed
    if camera_thread and camera_thread.is_paused():
        camera_thread.resume()
    
    # Notify clients
    await broadcast_message(json.dumps({
        "type": "mode_change",
        "mode": "TRACKING",
        "message": system_message
    }))

async def switch_to_radar_mode():
    global mode, system_message, camera_thread, radar_moving, last_radar_data_time, radar_distance
    global detected_distance, detected_angle, is_object_detected, radar_direction
    global waiting_for_first_radar_data, using_simulated_values
    
    mode = "RADAR"
    system_message = "Returning to radar scanning mode - WAITING for radar data from ESP32"
    print(system_message)
    
    # Pause camera
    if camera_thread and not camera_thread.is_paused():
        camera_thread.pause()
    
    # COMPLETELY reset all radar state to ensure no movement
    radar_moving = False
    radar_distance = 200  # Very safe value - no detection visualization
    detected_distance = 0
    detected_angle = 0
    last_radar_data_time = 0
    is_object_detected = False  # Explicitly reset object detection status
    waiting_for_first_radar_data = True  # Set flag to indicate waiting for data
    using_simulated_values = False  # Ensure we're not using simulated values
    
    # Force a complete wait for real ESP32 data
    print("🛑 RADAR FROZEN - Waiting for fresh ESP32 data before resuming")
    
    # Notify clients with current position (HARD FROZEN until we get ESP32 data)
    await broadcast_message(json.dumps({
        "type": "mode_change",
        "mode": "RADAR",
        "message": system_message,
        "moving": False,  # Explicitly tell clients the radar is not moving
        "angle": radar_angle,  # Send current angle to ensure frontend uses this as the fixed position
        "distance": radar_distance,  # Send safe distance to avoid triggering detection
        "waiting_for_data": True,  # Explicitly indicate we're waiting for data
        "hard_freeze": True,  # Force a complete freeze of radar display
        "detection": False,  # Explicitly set detection to false
        "stop_animation": True  # Tell frontend to completely stop animation
    }))

# Broadcast to all WebSocket clients
async def broadcast_message(message):
    for client in connected_clients:
        try:
            await client.send_text(message)
        except Exception as e:
            print(f"Error broadcasting message: {e}")

# Serve main page
@app.get("/", response_class=HTMLResponse)
async def get_index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

# WebSocket endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    # Add to connected clients
    connected_clients.append(websocket)
    
    try:
        # Send initial data
        await websocket.send_json({
            "type": "init",
            "mode": mode,
            "angle": radar_angle,
            "distance": radar_distance,
            "message": system_message,
            "missing_libraries": MISSING_LIBRARIES,
            "direction": radar_direction,  # Ensure direction is sent
            "moving": radar_moving,  # Send radar moving state
            "timestamp": time.time()
        })
        
        # Immediately send a radar update to ensure the client has the latest position
        if mode == "RADAR":
            await websocket.send_json({
                "type": "radar",
                "angle": radar_angle,
                "distance": radar_distance,
                "mode": mode,
                "direction": radar_direction,
                "detection": radar_distance < DETECTION_DISTANCE,
                "moving": radar_moving,  # Include current moving state
                "timestamp": time.time()
            })
        
        # Main client message loop
        while True:
            message = await websocket.receive_text()
            try:
                data = json.loads(message)
                command = data.get("command")
                
                if command == "switch_mode":
                    requested_mode = data.get("mode")
                    if requested_mode == "RADAR" and mode != "RADAR":
                        await switch_to_radar_mode()
                    elif requested_mode == "TRACKING" and mode != "TRACKING":
                        await switch_to_tracking_mode()
                
                elif command == "tracking_type":
                    tracking_type = data.get("type")
                    if tracking_type in [1, 2]:
                        global tracking_mode
                        tracking_mode = tracking_type
                        # Initialize appropriate detector
                        if camera_thread:
                            camera_thread.initialize_detectors()
                        
                        await broadcast_message(json.dumps({
                            "type": "system_message",
                            "message": f"Changed tracking mode to {('Face' if tracking_mode == 1 else 'Hand')} tracking"
                        }))
                        
                elif command == "get_radar_status":
                    # Client is requesting current radar status - useful after page refresh or reconnection
                    await websocket.send_json({
                        "type": "radar",
                        "angle": radar_angle,
                        "distance": radar_distance,
                        "mode": mode,
                        "direction": radar_direction,
                        "detection": radar_distance < DETECTION_DISTANCE,
                        "moving": radar_moving,
                        "timestamp": time.time()
                    })
                
                elif command == "shoot":
                    # Xử lý lệnh bắn
                    success = await send_shoot_command()
                    await websocket.send_json({
                        "type": "shoot_response",
                        "success": success,
                        "message": system_message
                    })
                
            except json.JSONDecodeError:
                print(f"Invalid JSON received: {message}")
            except Exception as e:
                print(f"Error processing client message: {e}")
                traceback.print_exc()
    
    except WebSocketDisconnect:
        # Remove from connected clients
        connected_clients.remove(websocket)
        print("Client disconnected from WebSocket")
    except Exception as e:
        # Handle other exceptions
        print(f"WebSocket error: {e}")
        traceback.print_exc()
        
        # Try to remove client if still in list
        if websocket in connected_clients:
            connected_clients.remove(websocket)

# Startup event
@app.on_event("startup")
async def startup_event():
    global camera_thread, main_event_loop, radar_angle, radar_direction
    
    print("\n" + "=" * 50)
    print("    WEB RADAR AND OBJECT TRACKING SYSTEM")
    print("=" * 50 + "\n")
    
    print("Starting system initialization...")
    
    if MISSING_LIBRARIES:
        print(f"Warning: Missing libraries: {', '.join(MISSING_LIBRARIES)}")
        print(f"Some features may not work. Install with: pip install {' '.join(MISSING_LIBRARIES)}")
    
    # Store the main event loop for use in other threads
    main_event_loop = asyncio.get_running_loop()
    
    # Initialize radar angle to starting position
    radar_angle = MIN_RADAR_ANGLE
    radar_direction = 1
    
    # Initialize serial
    setup_serial()
    
    # Create and start camera thread (initially paused)
    camera_thread = CameraThread(main_event_loop)
    camera_thread.start()
    
    # Start in radar mode
    await switch_to_radar_mode()
    
    # Start serial reading task
    asyncio.create_task(serial_reader_task())

# Background task to read serial data
async def serial_reader_task():
    global radar_angle, radar_direction, radar_distance, radar_moving, last_radar_data_time
    global is_object_detected, waiting_for_first_radar_data
    
    # Đặt góc bắt đầu giống ESP32 (15 độ)
    radar_angle = MIN_RADAR_ANGLE
    radar_direction = 1  # Bắt đầu với hướng tăng
    radar_moving = False  # Start with radar not moving until we get data
    is_object_detected = False
    
    print(f"Starting serial reader task with initial angle: {radar_angle}")
    
    while True:
        # Đọc dữ liệu từ cổng serial nếu có
        await read_serial()
        
        # If we haven't received radar data in a while, explicitly mark it as not moving
        if time.time() - last_radar_data_time > 1.0 and radar_moving:
            radar_moving = False
            # Notify clients that radar has stopped moving
            await broadcast_message(json.dumps({
                "type": "radar",
                "angle": radar_angle,
                "distance": radar_distance,
                "mode": mode,
                "direction": radar_direction,
                "detection": is_object_detected,  # Use the correct variable
                "moving": False,
                "timestamp": time.time()
            }))
        
        # Đợi một khoảng thời gian ngắn để không quá tải CPU
        await asyncio.sleep(0.01)

# Shutdown event
@app.on_event("shutdown")
async def shutdown_event():
    global running, camera_thread, serial_port
    
    print("\nShutting down system...")
    
    # Stop threads
    running = False
    
    # Clean up camera
    if camera_thread:
        camera_thread.cleanup()
    
    # Close serial port
    if serial_port and serial_port.is_open:
        serial_port.close()
        print("Serial port closed")
    
    print("System shutdown complete")

# Hàm gửi lệnh bắn cho ESP32
async def send_shoot_command():
    global serial_port, system_message
    
    try:
        with serial_lock:
            if serial_port and serial_port.is_open:
                # Gửi lệnh SHOOT
                serial_port.write(b"SHOOT\r")
                system_message = "Shoot command sent to ESP32"
                print(system_message)
                
                # Thông báo cho tất cả client
                await broadcast_message(json.dumps({
                    "type": "system_message",
                    "message": "🔫 SHOOT! Taking aim at detected object..."
                }))
                
                return True
            else:
                system_message = "Cannot send shoot command - Serial port not connected"
                print(system_message)
                return False
    except Exception as e:
        system_message = f"Error sending shoot command: {str(e)}"
        print(system_message)
        traceback.print_exc()
        return False

# Run app
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True) 