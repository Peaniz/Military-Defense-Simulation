import pygame
import math
import serial
import sys
import re
import subprocess
import os
import signal
import time
import traceback

# Define global colors here to avoid scope issues
BLACK = (0, 0, 0)
GREEN = (98, 245, 31)
BRIGHT_GREEN = (98, 245, 60)
RED = (255, 10, 10)
LIGHT_GREEN = (30, 250, 60)
YELLOW = (255, 255, 0)
WHITE = (255, 255, 255)

# Đường dẫn đến file face_detection.py
FACE_DETECTION_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "face_detection.py")

# Cổng COM cho Arduino - đảm bảo phù hợp với cả radar.py và face_detection.py
ARDUINO_COM_PORT = 'COM5'  

# Khởi tạo biến toàn cục
serial_port = None
screen = None
clock = None
face_detection_process = None

# Variables
angle = 0
distance = 0
data = ""
no_object = ""
index1 = 0

# Mode tracking
mode = "RADAR"  # "RADAR" or "FACE_TRACKING"
detected_angle = 0
detected_distance = 0
last_detection_time = 0
face_x = 90  # Default face tracking servo position
face_y = 90  # Default face tracking servo position
system_message = "Initializing..."

def setup_serial():
    global serial_port, system_message
    
    try:
        serial_port = serial.Serial(ARDUINO_COM_PORT, 9600)
        serial_port.timeout = 0.1
        system_message = f"Connected to Arduino on {ARDUINO_COM_PORT}"
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

def setup_pygame():
    global screen, clock, system_message
    
    try:
        pygame.init()
        
        # Constants
        WIDTH, HEIGHT = 1200, 700
        
        # Create window
        screen = pygame.display.set_mode((WIDTH, HEIGHT))
        pygame.display.set_caption('Radar and Face Tracking')
        clock = pygame.time.Clock()
        
        system_message = "Pygame initialized successfully"
        print(system_message)
        return True
    except Exception as e:
        system_message = f"Error initializing Pygame: {str(e)}"
        print(system_message)
        return False

def start_face_detection():
    global face_detection_process, system_message
    
    if face_detection_process is not None:
        system_message = "Face detection already running"
        return
    
    try:
        # Kiểm tra file face_detection.py có tồn tại không
        if not os.path.exists(FACE_DETECTION_PATH):
            alternative_path = "face_detection.py"  # Thử đường dẫn tương đối
            if os.path.exists(alternative_path):
                global FACE_DETECTION_PATH
                FACE_DETECTION_PATH = alternative_path
            else:
                system_message = f"Error: face_detection.py not found! Checked: {FACE_DETECTION_PATH} and {alternative_path}"
                print(system_message)
                return
        
        # Khởi chạy face_detection.py trong tiến trình riêng
        print(f"Starting face detection from: {FACE_DETECTION_PATH}")
        face_detection_process = subprocess.Popen([sys.executable, FACE_DETECTION_PATH])
        system_message = "Started face detection process"
        print(system_message)
    except Exception as e:
        system_message = f"Error starting face detection: {e}"
        print(system_message)
        traceback.print_exc()
        face_detection_process = None

def stop_face_detection():
    global face_detection_process, system_message
    
    if face_detection_process is None:
        return
    
    try:
        # Tắt tiến trình face detection
        if face_detection_process.poll() is None:  # Nếu tiến trình vẫn đang chạy
            if sys.platform == 'win32':
                face_detection_process.terminate()
            else:
                os.kill(face_detection_process.pid, signal.SIGTERM)
                
        face_detection_process = None
        system_message = "Stopped face detection process"
        print(system_message)
    except Exception as e:
        system_message = f"Error stopping face detection: {e}"
        print(system_message)
        traceback.print_exc()

def read_serial():
    global angle, distance, data, no_object, index1, mode, detected_angle, detected_distance, system_message, face_x, face_y, last_detection_time
    
    if serial_port is None or not serial_port.is_open:
        return
    
    try:
        if serial_port.in_waiting > 0:
            try:
                # Read raw data as bytes first
                raw_data = serial_port.readline()
                
                # Try different encodings or handle as bytes
                try:
                    # First try UTF-8
                    data = raw_data.decode('utf-8').strip()
                except UnicodeDecodeError:
                    # If that fails, try latin-1 (which accepts any byte value)
                    data = raw_data.decode('latin-1').strip()
                
                # Check for mode change or system messages
                if "Object detected at angle" in data:
                    # Extract angle and distance from the message
                    match_angle = re.search(r"angle (\d+)", data)
                    match_distance = re.search(r"distance (\d+)", data)
                    
                    if match_angle and match_distance:
                        detected_angle = int(match_angle.group(1))
                        detected_distance = int(match_distance.group(1))
                        mode = "FACE_TRACKING"
                        last_detection_time = pygame.time.get_ticks()
                        system_message = f"Object detected! Switching to face tracking mode"
                        print(system_message)
                        
                        # Tự động khởi chạy face detection khi phát hiện vật thể
                        start_face_detection()
                        
                elif "Timeout: Returning to radar mode" in data:
                    mode = "RADAR"
                    system_message = "Timeout: Returning to radar scanning mode"
                    print(system_message)
                    
                    # Dừng face detection khi quay lại chế độ radar
                    stop_face_detection()
                    
                elif "System initialized" in data:
                    mode = "RADAR"
                    system_message = "System initialized, radar scanning active"
                    print(system_message)
                    
                elif "Face tracking - X:" in data:
                    # Extract X and Y values from face tracking feedback
                    match = re.search(r"X: (\d+), Y: (\d+)", data)
                    if match:
                        face_x = int(match.group(1))
                        face_y = int(match.group(2))
                        last_detection_time = pygame.time.get_ticks()
                    
                elif '.' in data:
                    # This is normal radar data
                    data = data.split('.')[0]
                    
                    if ',' in data:
                        index1 = data.find(',')
                        angle_str = data[:index1]
                        distance_str = data[index1+1:]
                        
                        try:
                            angle = int(angle_str)
                            distance = int(distance_str)
                        except ValueError:
                            pass  # Ignore invalid data
            except Exception as e:
                # If all else fails, ignore this data packet
                print(f"Error reading serial data: {e}")
    except Exception as e:
        print(f"Serial communication error: {e}")
        system_message = f"Serial error: {str(e)}"
        traceback.print_exc()

def draw_radar():
    if screen is None:
        return
        
    try:
        # Get screen dimensions
        WIDTH, HEIGHT = screen.get_size()
        
        # Translate to center bottom of screen
        center_x = WIDTH // 2
        center_y = HEIGHT - int(HEIGHT * 0.074)
        
        # Draw arc lines
        pygame.draw.arc(screen, GREEN, 
                       (center_x - int((WIDTH - WIDTH * 0.0625) / 2), 
                        center_y - int((WIDTH - WIDTH * 0.0625) / 2),
                        int(WIDTH - WIDTH * 0.0625), 
                        int(WIDTH - WIDTH * 0.0625)), 
                       math.pi, 2 * math.pi, 2)
        
        pygame.draw.arc(screen, GREEN, 
                       (center_x - int((WIDTH - WIDTH * 0.27) / 2), 
                        center_y - int((WIDTH - WIDTH * 0.27) / 2),
                        int(WIDTH - WIDTH * 0.27), 
                        int(WIDTH - WIDTH * 0.27)), 
                       math.pi, 2 * math.pi, 2)
        
        pygame.draw.arc(screen, GREEN, 
                       (center_x - int((WIDTH - WIDTH * 0.479) / 2), 
                        center_y - int((WIDTH - WIDTH * 0.479) / 2),
                        int(WIDTH - WIDTH * 0.479), 
                        int(WIDTH - WIDTH * 0.479)), 
                       math.pi, 2 * math.pi, 2)
        
        pygame.draw.arc(screen, GREEN, 
                       (center_x - int((WIDTH - WIDTH * 0.687) / 2), 
                        center_y - int((WIDTH - WIDTH * 0.687) / 2),
                        int(WIDTH - WIDTH * 0.687), 
                        int(WIDTH - WIDTH * 0.687)), 
                       math.pi, 2 * math.pi, 2)
        
        # Draw angle lines
        pygame.draw.line(screen, GREEN, (center_x - WIDTH // 2, center_y), (center_x + WIDTH // 2, center_y), 2)
        
        for deg in [30, 60, 90, 120, 150]:
            rad = math.radians(deg)
            endpoint_x = center_x + int((-WIDTH/2) * math.cos(rad))
            endpoint_y = center_y - int((-WIDTH/2) * math.sin(rad))
            pygame.draw.line(screen, GREEN, (center_x, center_y), (endpoint_x, endpoint_y), 2)
    except Exception as e:
        print(f"Error drawing radar: {e}")
        traceback.print_exc()

def draw_object():
    if screen is None:
        return
        
    try:
        # Get screen dimensions
        WIDTH, HEIGHT = screen.get_size()
        
        center_x = WIDTH // 2
        center_y = HEIGHT - int(HEIGHT * 0.074)
        
        # In radar mode, show detected objects based on current scan
        if mode == "RADAR":
            if distance < 100:
                # Calculate pixel distance
                pix_distance = distance * ((HEIGHT - HEIGHT * 0.1666) * 0.025)
                
                # Calculate coordinates based on angle and distance
                rad_angle = math.radians(angle)
                obj_x = center_x + int(pix_distance * math.cos(rad_angle))
                obj_y = center_y - int(pix_distance * math.sin(rad_angle))
                
                edge_x = center_x + int((WIDTH - WIDTH * 0.505) * math.cos(rad_angle))
                edge_y = center_y - int((WIDTH - WIDTH * 0.505) * math.sin(rad_angle))
                
                # Draw line to detected object
                pygame.draw.line(screen, RED, (obj_x, obj_y), (edge_x, edge_y), 9)
        
        # In face tracking mode, show the last detected object
        elif mode == "FACE_TRACKING":
            if detected_distance < 100:
                # Calculate pixel distance for the detected object
                pix_distance = detected_distance * ((HEIGHT - HEIGHT * 0.1666) * 0.025)
                
                # Calculate coordinates based on detected angle and distance
                rad_angle = math.radians(detected_angle)
                obj_x = center_x + int(pix_distance * math.cos(rad_angle))
                obj_y = center_y - int(pix_distance * math.sin(rad_angle))
                
                # Draw circle for the detected object that triggered tracking
                pygame.draw.circle(screen, YELLOW, (obj_x, obj_y), 10)
    except Exception as e:
        print(f"Error drawing object: {e}")
        traceback.print_exc()

def draw_line():
    if screen is None:
        return
        
    try:
        # Get screen dimensions
        WIDTH, HEIGHT = screen.get_size()
        
        center_x = WIDTH // 2
        center_y = HEIGHT - int(HEIGHT * 0.074)
        
        if mode == "RADAR":
            # Normal radar sweeping line
            rad_angle = math.radians(angle)
            end_x = center_x + int((HEIGHT - HEIGHT * 0.12) * math.cos(rad_angle))
            end_y = center_y - int((HEIGHT - HEIGHT * 0.12) * math.sin(rad_angle))
            
            # Draw scanning line
            pygame.draw.line(screen, LIGHT_GREEN, (center_x, center_y), (end_x, end_y), 9)
        
        elif mode == "FACE_TRACKING":
            # In tracking mode, draw a line to the detected angle
            rad_angle = math.radians(detected_angle)
            end_x = center_x + int((HEIGHT - HEIGHT * 0.12) * math.cos(rad_angle))
            end_y = center_y - int((HEIGHT - HEIGHT * 0.12) * math.sin(rad_angle))
            
            # Draw a stationary line showing where object was detected
            pygame.draw.line(screen, YELLOW, (center_x, center_y), (end_x, end_y), 9)
    except Exception as e:
        print(f"Error drawing line: {e}")
        traceback.print_exc()

def draw_text():
    global no_object
    
    if screen is None:
        return
        
    try:
        # Get screen dimensions
        WIDTH, HEIGHT = screen.get_size()
        
        # Top status bar background - increased height 
        status_bar_height = int(HEIGHT * 0.08)
        pygame.draw.rect(screen, BLACK, (0, 0, WIDTH, status_bar_height))
        
        # Bottom bar for distance markers
        bottom_bar_height = int(HEIGHT * 0.035)
        pygame.draw.rect(screen, BLACK, (0, HEIGHT - bottom_bar_height, WIDTH, bottom_bar_height))
        
        # Set font sizes based on screen dimensions
        small_font_size = max(15, int(HEIGHT * 0.035))
        large_font_size = max(25, int(HEIGHT * 0.05))
        
        # Set font
        small_font = pygame.font.SysFont('Arial', small_font_size)
        large_font = pygame.font.SysFont('Arial', large_font_size)
        
        # Distance markers y-position
        marker_y = HEIGHT - int(HEIGHT * 0.03)
        
        # Distance markers
        markers = [
            ("10cm", WIDTH - WIDTH * 0.3854),
            ("20cm", WIDTH - WIDTH * 0.281),
            ("30cm", WIDTH - WIDTH * 0.177),
            ("40cm", WIDTH - WIDTH * 0.0729)
        ]
        
        for text, x_pos in markers:
            text_surf = small_font.render(text, True, GREEN)
            screen.blit(text_surf, (x_pos, marker_y))
        
        # Calculate positions for top status text
        status_y = int(HEIGHT * 0.025)
        
        # Main title at the top
        title = large_font.render("SciCraft", True, GREEN)
        screen.blit(title, (WIDTH * 0.05, status_y))
        
        # Show current mode
        mode_color = YELLOW if mode == "FACE_TRACKING" else GREEN
        mode_text = "FACE TRACKING MODE" if mode == "FACE_TRACKING" else "RADAR SCANNING MODE"
        mode_surf = large_font.render(mode_text, True, mode_color)
        screen.blit(mode_surf, (WIDTH * 0.25, status_y))
        
        # Hiển thị thông tin về face_detection_process
        face_detection_status = "RUNNING" if face_detection_process is not None and face_detection_process.poll() is None else "STOPPED"
        face_detection_color = GREEN if face_detection_status == "RUNNING" else RED
        face_status_surf = small_font.render(f"Face Detection: {face_detection_status}", True, face_detection_color)
        screen.blit(face_status_surf, (WIDTH * 0.25, status_y + large_font_size + 5))
        
        # Show different info based on mode
        if mode == "RADAR":
            # Angle position
            angle_text = large_font.render(f"Angle: {angle}°", True, GREEN)
            screen.blit(angle_text, (WIDTH * 0.65, status_y))
            
            # Distance position
            dist_label = large_font.render(f"Distance: {distance} cm", True, GREEN)
            screen.blit(dist_label, (WIDTH * 0.82, status_y))
            
            if distance < 40:
                no_object = "In Range"
            else:
                no_object = "Out of Range"
                
        elif mode == "FACE_TRACKING":
            # Show face tracking servo positions
            face_pos_text = large_font.render(f"Face X: {face_x}° Y: {face_y}°", True, YELLOW)
            screen.blit(face_pos_text, (WIDTH * 0.65, status_y))
            
            # Show detected angle/distance
            detect_text = large_font.render(f"Detected at: {detected_angle}° / {detected_distance}cm", True, YELLOW)
            screen.blit(detect_text, (WIDTH * 0.65, status_y + large_font_size + 5))
        
        # Show system messages at bottom of top bar
        system_msg_surf = small_font.render(system_message, True, BRIGHT_GREEN)
        screen.blit(system_msg_surf, (WIDTH * 0.05, status_y + large_font_size + 5))
        
        # Hiển thị hướng dẫn
        help_text = "F1: Start Face Detection | F2: Stop Face Detection | ESC: Exit"
        help_surf = small_font.render(help_text, True, WHITE)
        screen.blit(help_surf, (WIDTH * 0.05, HEIGHT - bottom_bar_height - 30))
        
        # Draw angle markers
        center_x = WIDTH // 2
        center_y = HEIGHT - int(HEIGHT * 0.074)
        
        # Calculate text offsets based on screen size
        text_offset_x = int(WIDTH * 0.015)  
        text_offset_y = int(HEIGHT * 0.035)
        
        for deg, label in [(30, "30°"), (60, "60°"), (90, "90°"), (120, "120°"), (150, "150°")]:
            rad = math.radians(deg)
            
            # Calculate radius for text placement
            text_radius = min(WIDTH, HEIGHT) * 0.38
            
            # Calculate position for text based on angle
            if deg == 90:
                x_pos = center_x - text_offset_x
                y_pos = center_y - text_radius - text_offset_y * 1.2
            elif deg < 90:
                # Position for 30° and 60°
                x_pos = center_x + int(text_radius * math.cos(rad)) + text_offset_x * 1.5
                y_pos = center_y - int(text_radius * math.sin(rad)) - text_offset_y * 0.8
            else:
                # Position for 120° and 150°
                x_pos = center_x + int(text_radius * math.cos(rad)) - text_offset_x * 3.5
                y_pos = center_y - int(text_radius * math.sin(rad)) - text_offset_y * 0.8
                
            text_surf = small_font.render(label, True, BRIGHT_GREEN)
            screen.blit(text_surf, (x_pos, y_pos))
    except Exception as e:
        print(f"Error drawing text: {e}")
        traceback.print_exc()

def main():
    global system_message, mode
    
    running = True
    system_message = "Initializing system..."
    
    print("Starting radar.py")
    print(f"Current directory: {os.getcwd()}")
    print(f"Face detection path: {FACE_DETECTION_PATH}")
    
    # Initialize pygame first
    if not setup_pygame():
        print("Failed to initialize Pygame, exiting")
        return
    
    # Try to connect to Arduino, but continue even if failed
    setup_serial()
    
    try:
        while running:
            # Handle events
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    running = False
                elif event.type == pygame.KEYDOWN:
                    # Xử lý sự kiện phím
                    if event.key == pygame.K_ESCAPE:
                        running = False
                    elif event.key == pygame.K_F1:
                        # Bắt đầu face detection (thủ công)
                        start_face_detection()
                    elif event.key == pygame.K_F2:
                        # Dừng face detection (thủ công)
                        stop_face_detection()
                    elif event.key == pygame.K_r:
                        # Chuyển lại chế độ radar (thủ công)
                        mode = "RADAR"
                        system_message = "Manually switched to radar mode"
                        stop_face_detection()
                    elif event.key == pygame.K_f:
                        # Chuyển sang chế độ face tracking (thủ công)
                        mode = "FACE_TRACKING"
                        system_message = "Manually switched to face tracking mode"
                        start_face_detection()
            
            # Read serial data
            read_serial()
            
            # Kiểm tra trạng thái của face_detection_process
            if face_detection_process is not None and face_detection_process.poll() is not None:
                # Nếu tiến trình đã kết thúc
                system_message = "Face detection process has ended"
                face_detection_process = None
            
            # Clear screen with motion blur effect
            screen.fill(BLACK)  # Ensure screen is always cleared
            
            if mode == "RADAR":
                s = pygame.Surface((screen.get_width(), screen.get_height() - screen.get_height() * 0.065))
                s.set_alpha(4)
                s.fill(BLACK)
                screen.blit(s, (0, 0))
            
            # Draw radar components
            draw_radar()
            draw_line()
            draw_object()
            draw_text()
            
            # Update display
            pygame.display.flip()
            
            # Control frame rate
            clock.tick(30)
    
    except Exception as e:
        print(f"Error in main loop: {e}")
        traceback.print_exc()
        system_message = f"Error: {str(e)}"
        
        # Display error on screen if possible
        if screen:
            try:
                screen.fill(BLACK)
                font = pygame.font.SysFont('Arial', 30)
                error_text = font.render(f"Error: {str(e)}", True, RED)
                screen.blit(error_text, (50, 50))
                pygame.display.flip()
                
                # Wait for user to acknowledge error
                waiting = True
                while waiting:
                    for event in pygame.event.get():
                        if event.type == pygame.QUIT or (event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE):
                            waiting = False
                    time.sleep(0.1)
            except:
                pass
    
    finally:
        # Clean up
        print("Cleaning up...")
        try:
            stop_face_detection()  # Make sure to stop face detection process
            if serial_port and serial_port.is_open:
                serial_port.close()
            pygame.quit()
        except Exception as e:
            print(f"Error during cleanup: {e}")
            traceback.print_exc()

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Unhandled exception: {e}")
        traceback.print_exc()
    sys.exit() 