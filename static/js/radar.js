/**
 * Web Radar and Object Tracking System
 * JavaScript for handling WebSocket, Radar Display, and Camera Feed
 */

// Global variables
let websocket = null;
let radarCanvas = null;
let radarContext = null;
let currentMode = "RADAR";
let currentAngle = 90;
let targetAngle = 90;   // Góc đích mà servo đang hướng đến
let currentDistance = 0;
let detectedAngle = 0;
let detectedDistance = 0;
let detectedObject = false;
let detectedTimestamp = 0;
let detectionPulseSize = 0;
let trackingMode = 1; // 1 = Face, 2 = Hand
let lastFrameTime = 0;
let requestAnimationId = null;
let radarDirection = 1; // Hướng quét radar (1: tăng, -1: giảm)
let isObjectDetected = false; // Trạng thái phát hiện vật thể
let lastAngleUpdateTime = 0; // Thời điểm cập nhật góc cuối cùng
let radarMoving = false; // Cờ để kiểm tra xem servo có đang di chuyển hay không
let isInitialAngleSet = false; // Cờ kiểm tra xem góc ban đầu đã được thiết lập chưa
let lastReceivedAngle = 90; // Góc cuối cùng nhận được từ Arduino
let consecutiveStaticUpdates = 0; // Số lần cập nhật liên tiếp mà góc không thay đổi
let initialConnectionMade = false; // Đánh dấu kết nối đầu tiên đã được thiết lập
let hasFreshRadarData = false; // Flag to track if we have fresh radar data after mode switch
let HARD_FREEZE = false;  // When true, completely disables all radar movement and animation

// Giới hạn góc quét - khớp với Arduino
const MIN_RADAR_ANGLE = 15;  // Góc servo tối thiểu trong Arduino
const MAX_RADAR_ANGLE = 165; // Góc servo tối đa trong Arduino
const DETECTION_DISTANCE = 40; // Khoảng cách phát hiện vật thể (cm) - khớp với Arduino

// Constants
const GREEN = "#62ff00";
const BRIGHT_GREEN = "#98f53c";
const RED = "#ff0a0a";
const LIGHT_GREEN = "#1efa3c";
const YELLOW = "#ffff00";
const WHITE = "#ffffff";
const ARDUINO_DELAY = 30; // ms - khớp với delay của Arduino servo
const SIMULATION_SPEED_FACTOR = 0.03; // Tốc độ mô phỏng khi mất kết nối

// Initialize when DOM is fully loaded
document.addEventListener("DOMContentLoaded", function () {
    // Get radar canvas
    radarCanvas = document.getElementById("radar-canvas");
    radarContext = radarCanvas.getContext("2d");
    
    // Set actual canvas dimensions (for high DPI displays)
    function setupCanvas() {
        // Get the device pixel ratio
        const dpr = window.devicePixelRatio || 1;
        
        // Get the canvas size from CSS
        const rect = radarCanvas.getBoundingClientRect();
        
        // Set the canvas dimensions taking into account the device pixel ratio
        radarCanvas.width = rect.width * dpr;
        radarCanvas.height = rect.height * dpr;
        
        // Scale the context to ensure correct drawing operations
        radarContext.scale(dpr, dpr);
        
        // Set the CSS size
        radarCanvas.style.width = rect.width + "px";
        radarCanvas.style.height = rect.height + "px";
    }
    
    // Setup canvas on load and resize
    setupCanvas();
    window.addEventListener("resize", setupCanvas);
    
    // Initialize the lastAngleUpdateTime to avoid immediate simulation
    lastAngleUpdateTime = Date.now();
    
    // Initialize the recentPositions array for trail effect
    window.recentPositions = [];
    
    // Connect to WebSocket
    connectWebSocket();
    
    // Setup UI event listeners
    setupEventListeners();
    
    // Start animation loop
    requestAnimationId = requestAnimationFrame(drawRadar);
});

// Connect to WebSocket
function connectWebSocket() {
    // Close existing connection if any
    if (websocket && websocket.readyState !== WebSocket.CLOSED) {
        websocket.close();
    }
    
    // Create new connection
    const protocol = window.location.protocol === "https:" ? "wss://" : "ws://";
    const wsUrl = `${protocol}${window.location.host}/ws`;
    
    websocket = new WebSocket(wsUrl);
    
    // Connection opened
    websocket.onopen = function(event) {
        console.log("WebSocket connected");
        updateSystemMessage("WebSocket connected successfully");
        
        if (initialConnectionMade) {
            // Nếu đây là kết nối lại, yêu cầu trạng thái radar hiện tại từ server
            sendWebSocketCommand("get_radar_status");
        }
        initialConnectionMade = true;
    };
    
    // Listen for messages
    websocket.onmessage = function(event) {
        handleWebSocketMessage(event.data);
    };
    
    // Connection closed
    websocket.onclose = function(event) {
        console.log("WebSocket disconnected");
        updateSystemMessage("WebSocket disconnected. Reconnecting...");
        
        // Try to reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
    };
    
    // Error handling
    websocket.onerror = function(error) {
        console.error("WebSocket error:", error);
        updateSystemMessage("WebSocket error occurred");
    };
}

// Handle incoming WebSocket messages
function handleWebSocketMessage(data) {
    try {
        const message = JSON.parse(data);
        
        switch(message.type) {
            case "init":
                // Initial data from server
                currentMode = message.mode;
                targetAngle = message.angle; // Cập nhật góc đích
                radarMoving = message.moving || false; // Nhận trạng thái di chuyển từ server
                
                if (!isInitialAngleSet) {
                    currentAngle = targetAngle; // Chỉ thiết lập góc ban đầu nếu chưa được thiết lập
                    lastReceivedAngle = targetAngle; // Lưu góc khởi tạo
                    isInitialAngleSet = true;
                }
                currentDistance = message.distance;
                lastAngleUpdateTime = Date.now();
                updateSystemMessage(message.message);
                updateModeDisplay();
                hasFreshRadarData = true;
                
                // Cập nhật hướng quét từ server
                if (message.direction !== undefined) {
                    radarDirection = message.direction;
                }
                
                // Debug
                console.log(`[WebSocket] Init: Angle=${targetAngle}, Direction=${radarDirection}, Moving=${radarMoving}`);
                
                // Đảm bảo góc nằm trong giới hạn
                if (targetAngle < MIN_RADAR_ANGLE) targetAngle = MIN_RADAR_ANGLE;
                if (targetAngle > MAX_RADAR_ANGLE) targetAngle = MAX_RADAR_ANGLE;
                
                // Check for missing libraries
                if (message.missing_libraries && message.missing_libraries.length > 0) {
                    document.getElementById("missing-libraries-warning").style.display = "block";
                    document.getElementById("missing-libraries-text").textContent = 
                        `Missing libraries: ${message.missing_libraries.join(", ")}. Some features may not work.`;
                }
                break;
                
            case "radar":
                // Check if server asked to resume animation
                if (message.resume_animation === true && !requestAnimationId) {
                    console.log("✅ Restarting animation loop at server's request");
                    requestAnimationId = requestAnimationFrame(drawRadar);
                }
                
                // First data after mode switch
                if (HARD_FREEZE) {
                    // If we're in HARD_FREEZE mode and get radar data, resume the animation loop
                    if (!requestAnimationId) {
                        console.log("✅ Restarting animation loop after receiving fresh data");
                        requestAnimationId = requestAnimationFrame(drawRadar);
                    }
                    
                    HARD_FREEZE = false;
                    console.log("🔓 HARD FREEZE disabled - received fresh data from Arduino");
                }
                
                // Check for first data after mode switch
                if (message.first_data_after_switch) {
                    console.log("🔄 Received first radar data after mode switch");
                }
                
                // Reset the waiting for data UI immediately when we get first radar update
                if (!hasFreshRadarData && currentMode === "RADAR") {
                    console.log("Received first radar data after mode switch");
                    updateSystemMessage("Radar operating normally");
                }
                
                // Update radar data from actual servo movement
                lastAngleUpdateTime = Date.now();
                hasFreshRadarData = true;
                
                // Lấy thông tin về trạng thái di chuyển từ server
                if (message.moving !== undefined) {
                    radarMoving = message.moving;
                }
                
                // Trực tiếp cập nhật góc từ server
                lastReceivedAngle = message.angle;
                targetAngle = message.angle;
                currentAngle = targetAngle; // Đồng bộ trực tiếp với góc từ server
                currentDistance = message.distance;
                
                // Cập nhật hướng quét nếu server gửi
                if (message.direction !== undefined) {
                    radarDirection = message.direction;
                }
                
                // Log less frequently to avoid console spam
                if (Math.random() < 0.05) {
                    console.log(`[WebSocket] Radar update: Angle=${targetAngle}, Distance=${currentDistance}, Moving=${radarMoving}`);
                }
                
                // Cập nhật trạng thái phát hiện đối tượng
                if (message.detection !== undefined) {
                    isObjectDetected = message.detection;
                }
                
                // Đảm bảo góc nằm trong giới hạn
                if (targetAngle < MIN_RADAR_ANGLE) targetAngle = MIN_RADAR_ANGLE;
                if (targetAngle > MAX_RADAR_ANGLE) targetAngle = MAX_RADAR_ANGLE;
                
                // Thêm vị trí mới cho hiệu ứng afterglow nếu radar đang di chuyển
                if (window.recentPositions && radarMoving) {
                    window.recentPositions.unshift({
                        angle: currentAngle,
                        timestamp: Date.now()
                    });
                    
                    // Giới hạn số vị trí lưu trữ
                    if (window.recentPositions.length > 20) {
                        window.recentPositions.pop();
                    }
                }
                
                updateAngleDisplay();
                updateDistanceDisplay();
                break;
                
            case "object_detected":
                // Object detection message from server
                detectedObject = true;
                detectedTimestamp = Date.now();
                detectedAngle = message.angle;
                detectedDistance = message.distance;
                detectionPulseSize = 0;  // Start the pulse animation
                
                console.log(`[WebSocket] Object detected at Angle=${detectedAngle}, Distance=${detectedDistance}`);
                
                // Play an alert sound when object is detected
                playDetectionAlert();
                
                updateSystemMessage(`Object detected at ${detectedAngle}° with distance ${detectedDistance}cm!`);
                break;
                
            case "mode_change":
                // Mode changed
                const previousMode = currentMode;
                currentMode = message.mode;
                updateSystemMessage(message.message);
                updateModeDisplay();
                
                // When switching to radar mode, reset fresh data flag
                if (currentMode === "RADAR" && previousMode !== "RADAR") {
                    // VERY IMPORTANT: First reset everything to known state
                    console.log("COMPLETE RESET OF RADAR STATE FOR MODE SWITCH");
                    
                    // Check if server explicitly requested animation stop
                    if (message.stop_animation === true) {
                        // STOP ANIMATION LOOP when requested
                        if (requestAnimationId) {
                            cancelAnimationFrame(requestAnimationId);
                            requestAnimationId = null;
                            console.log("⛔ Animation loop STOPPED by server request");
                        }
                    } else {
                        // STOP ANIMATION LOOP when changing to radar mode anyway for safety
                        if (requestAnimationId) {
                            cancelAnimationFrame(requestAnimationId);
                            requestAnimationId = null;
                            console.log("⛔ Animation loop STOPPED during mode switch");
                        }
                    }
                    
                    // Reset all radar state
                    resetRadarState();
                    
                    // Explicitly reset detection data
                    isObjectDetected = false;
                    currentDistance = 200; // Safe value
                    detectedObject = false;
                    detectionPulseSize = 0;
                    
                    // Check for hard freeze flag from server
                    if (message.hard_freeze === true) {
                        HARD_FREEZE = true;
                        console.log("🔒 HARD FREEZE enabled by server - radar COMPLETELY FROZEN until fresh data");
                    } else {
                        // Enable hard freeze anyway for safety
                        HARD_FREEZE = true;
                        console.log("🔒 HARD FREEZE enabled - radar COMPLETELY FROZEN until fresh data");
                    }
                    
                    // Explicitly check if the detection state was sent
                    if (message.detection !== undefined) {
                        isObjectDetected = message.detection;
                        console.log(`Detection state from server: ${isObjectDetected}`);
                    }
                    
                    // Explicitly check if the moving state was included in the message
                    if (message.moving !== undefined) {
                        radarMoving = message.moving;
                    }
                    
                    // Check for waiting_for_data flag
                    if (message.waiting_for_data === true) {
                        hasFreshRadarData = false;
                        console.log("Server explicitly indicated waiting for fresh radar data");
                    }
                    
                    // If server sent an angle with the mode change, use it as the fixed position
                    if (message.angle !== undefined) {
                        lastReceivedAngle = message.angle;
                        currentAngle = message.angle;
                        targetAngle = message.angle;
                        console.log(`Using server-provided angle: ${message.angle}°`);
                    }
                    
                    // If server sent a distance, update it
                    if (message.distance !== undefined) {
                        currentDistance = message.distance;
                        console.log(`Using server-provided distance: ${message.distance}cm`);
                    }
                    
                    // Update UI immediately with these values
                    updateAngleDisplay();
                    updateDistanceDisplay();
                    
                    // Draw the waiting screen immediately (static - no animation)
                    drawWaitingScreen();
                    
                    console.log(`Switched to RADAR mode - waiting for fresh data. Moving: ${radarMoving}`);
                }
                
                // Update UI
                updateModeBtnState();
                
                // Show/hide camera feed
                updateCameraDisplay();
                break;
                
            case "camera":
                // Update camera feed
                if (currentMode === "TRACKING") {
                    updateCameraFeed(message.image, message.tracking);
                }
                break;
                
            case "system_message":
                // Update system message
                updateSystemMessage(message.message);
                break;
            
            case "shoot_response":
                // Phản hồi từ lệnh bắn
                updateSystemMessage(message.message);
                if (!message.success) {
                    console.error("Shoot command failed:", message.message);
                }
                break;
        }
    } catch (error) {
        console.error("Error handling WebSocket message:", error);
    }
}

// Setup UI event listeners
function setupEventListeners() {
    // Radar mode button
    document.getElementById("radar-mode-btn").addEventListener("click", function() {
        if (currentMode !== "RADAR") {
            sendWebSocketCommand("switch_mode", { mode: "RADAR" });
        }
    });
    
    // Tracking mode button
    document.getElementById("tracking-mode-btn").addEventListener("click", function() {
        if (currentMode !== "TRACKING") {
            sendWebSocketCommand("switch_mode", { mode: "TRACKING" });
        }
    });
    
    // Face tracking button
    document.getElementById("face-tracking-btn").addEventListener("click", function() {
        if (trackingMode !== 1) {
            trackingMode = 1;
            updateTrackingBtnState();
            sendWebSocketCommand("tracking_type", { type: 1 });
        }
    });
    
    // Hand tracking button
    document.getElementById("hand-tracking-btn").addEventListener("click", function() {
        if (trackingMode !== 2) {
            trackingMode = 2;
            updateTrackingBtnState();
            sendWebSocketCommand("tracking_type", { type: 2 });
        }
    });
    
    // Shoot button (Thêm vào)
    document.getElementById("shoot-btn").addEventListener("click", function() {
        if (currentMode === "TRACKING") {
            // Chỉ cho phép bắn trong chế độ tracking
            shootTarget();
        } else {
            updateSystemMessage("Cannot shoot in radar mode. Switch to tracking mode first.");
        }
    });
    
    // Phím tắt
    document.addEventListener("keydown", function(event) {
        // Phím Space để bắn
        if (event.code === "Space" && currentMode === "TRACKING") {
            shootTarget();
            event.preventDefault(); // Ngăn cuộn trang
        }
    });
}

// Send command to WebSocket
function sendWebSocketCommand(command, params = {}) {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        const message = {
            command: command,
            ...params
        };
        
        websocket.send(JSON.stringify(message));
    } else {
        console.warn("WebSocket not connected, cannot send command");
        updateSystemMessage("Cannot send command - WebSocket not connected");
    }
}

// Update UI elements
function updateSystemMessage(message) {
    document.getElementById("system-message").textContent = message;
}

function updateModeDisplay() {
    const modeDisplay = document.getElementById("mode-display");
    
    if (currentMode === "RADAR") {
        modeDisplay.textContent = "RADAR SCANNING MODE";
        modeDisplay.classList.remove("text-warning");
        modeDisplay.classList.add("text-success");
    } else {
        modeDisplay.textContent = "OBJECT TRACKING MODE";
        modeDisplay.classList.remove("text-success");
        modeDisplay.classList.add("text-warning");
    }
    
    // Update tracking mode display
    document.getElementById("tracking-mode-display").textContent = 
        currentMode === "TRACKING" ? 
        (trackingMode === 1 ? "Face Tracking" : "Hand Tracking") : 
        "Tracking View";
}

function updateModeBtnState() {
    const radarBtn = document.getElementById("radar-mode-btn");
    const trackingBtn = document.getElementById("tracking-mode-btn");
    
    if (currentMode === "RADAR") {
        radarBtn.classList.add("btn-success");
        radarBtn.classList.remove("btn-outline-success");
        trackingBtn.classList.add("btn-outline-warning");
        trackingBtn.classList.remove("btn-warning");
    } else {
        radarBtn.classList.remove("btn-success");
        radarBtn.classList.add("btn-outline-success");
        trackingBtn.classList.remove("btn-outline-warning");
        trackingBtn.classList.add("btn-warning");
    }
}

function updateTrackingBtnState() {
    const faceBtn = document.getElementById("face-tracking-btn");
    const handBtn = document.getElementById("hand-tracking-btn");
    
    if (trackingMode === 1) {
        faceBtn.classList.add("btn-primary");
        faceBtn.classList.remove("btn-outline-primary");
        handBtn.classList.add("btn-outline-primary");
        handBtn.classList.remove("btn-primary");
    } else {
        faceBtn.classList.remove("btn-primary");
        faceBtn.classList.add("btn-outline-primary");
        handBtn.classList.remove("btn-outline-primary");
        handBtn.classList.add("btn-primary");
    }
}

function updateAngleDisplay() {
    document.getElementById("angle-display").textContent = `Angle: ${currentAngle}°`;
}

function updateDistanceDisplay() {
    document.getElementById("distance-display").textContent = `Distance: ${currentDistance} cm`;
}

// Camera feed handling
function updateCameraDisplay() {
    const cameraFeed = document.getElementById("camera-feed");
    const noCamera = document.getElementById("no-camera-message");
    
    if (currentMode === "TRACKING") {
        cameraFeed.style.display = "block";
        noCamera.style.display = "none";
    } else {
        cameraFeed.style.display = "none";
        noCamera.style.display = "block";
    }
}

function updateCameraFeed(imageData, tracking) {
    const cameraFeed = document.getElementById("camera-feed");
    cameraFeed.src = `data:image/jpeg;base64,${imageData}`;
    
    // Update position display
    if (tracking) {
        document.getElementById("position-display").textContent = 
            `Position: (${tracking.x}, ${tracking.y})`;
    }
}

// Draw radar on canvas
function drawRadar(timestamp) {
    // IMPORTANT: Don't attempt any radar drawing whatsoever if in HARD_FREEZE
    // This completely prevents ANY movement during the waiting period
    if (HARD_FREEZE && currentMode === "RADAR") {
        // Just request the next frame without doing any drawing
        requestAnimationId = requestAnimationFrame(drawRadar);
        return;  // Skip ALL drawing logic
    }
    
    // Normal drawRadar logic for when not in HARD_FREEZE
    // Calculate delta time for smooth animations
    const deltaTime = timestamp - lastFrameTime;
    lastFrameTime = timestamp;
    
    // Clear canvas
    radarContext.clearRect(0, 0, radarCanvas.width, radarCanvas.height);
    
    // Get canvas dimensions
    const width = radarCanvas.width;
    const height = radarCanvas.height;
    
    // Calculate center point
    const centerX = width / 2;
    const centerY = height - height * 0.15;
    
    // IMPORTANT: In radar mode, if we don't have fresh data, don't update currentAngle
    // This prevents any animation from occurring while waiting for Arduino data
    if (currentMode === "RADAR" && !hasFreshRadarData) {
        // Keep using lastReceivedAngle and don't update anything
        currentAngle = lastReceivedAngle;
    } else {
        // Just ensure angles are within bounds
        if (currentAngle < MIN_RADAR_ANGLE) currentAngle = MIN_RADAR_ANGLE;
        if (currentAngle > MAX_RADAR_ANGLE) currentAngle = MAX_RADAR_ANGLE;
    }
    
    // Draw radar background
    drawRadarBackground(centerX, centerY, width, height);
    
    // Draw scanning line
    drawScanningLine(centerX, centerY, width);
    
    // Draw detection popup first (if active)
    const popupDrawn = drawDetectionPopup(centerX, centerY, width);
    
    // Only draw detected objects if:
    // 1. We're in tracking mode, OR
    // 2. We're in radar mode AND have fresh data AND not in hard freeze
    // 3. AND no popup is currently being drawn
    if ((currentMode === "TRACKING" || (currentMode === "RADAR" && hasFreshRadarData && !HARD_FREEZE)) && !popupDrawn) {
        drawDetectedObject(centerX, centerY, width);
    }
    
    // Request next frame
    requestAnimationId = requestAnimationFrame(drawRadar);
}

function drawRadarBackground(centerX, centerY, width, height) {
    // Draw semicircle arcs
    for (let i = 1; i <= 4; i++) {
        const radius = width * (0.1 + i * 0.15);
        radarContext.beginPath();
        radarContext.arc(centerX, centerY, radius, Math.PI, 2 * Math.PI);
        radarContext.strokeStyle = GREEN;
        radarContext.lineWidth = 2;
        radarContext.stroke();
    }
    
    // Draw angle lines
    radarContext.beginPath();
    radarContext.moveTo(centerX - width / 2, centerY);
    radarContext.lineTo(centerX + width / 2, centerY);
    radarContext.strokeStyle = GREEN;
    radarContext.lineWidth = 2;
    radarContext.stroke();
    
    // Vẽ các đường góc giới hạn cho servo (15° và 165°)
    const minRad = MIN_RADAR_ANGLE * Math.PI / 180;
    const maxRad = MAX_RADAR_ANGLE * Math.PI / 180;
    
    // Vẽ đường giới hạn trái (15°)
    const minEndX = centerX + (width * 0.4) * Math.cos(minRad);
    const minEndY = centerY - (width * 0.4) * Math.sin(minRad);
    radarContext.beginPath();
    radarContext.moveTo(centerX, centerY);
    radarContext.lineTo(minEndX, minEndY);
    // Highlight khi góc quét gần với góc giới hạn trái
    radarContext.strokeStyle = (Math.abs(currentAngle - MIN_RADAR_ANGLE) < 5) ? "yellow" : "rgba(255, 255, 0, 0.7)";
    radarContext.lineWidth = (Math.abs(currentAngle - MIN_RADAR_ANGLE) < 5) ? 3 : 1;
    radarContext.stroke();
    
    // Vẽ đường giới hạn phải (165°)
    const maxEndX = centerX + (width * 0.4) * Math.cos(maxRad);
    const maxEndY = centerY - (width * 0.4) * Math.sin(maxRad);
    radarContext.beginPath();
    radarContext.moveTo(centerX, centerY);
    radarContext.lineTo(maxEndX, maxEndY);
    // Highlight khi góc quét gần với góc giới hạn phải
    radarContext.strokeStyle = (Math.abs(currentAngle - MAX_RADAR_ANGLE) < 5) ? "yellow" : "rgba(255, 255, 0, 0.7)";
    radarContext.lineWidth = (Math.abs(currentAngle - MAX_RADAR_ANGLE) < 5) ? 3 : 1;
    radarContext.stroke();
    
    // Vẽ các đường góc khác
    const standardAngles = [30, 60, 90, 120, 150];
    for (let deg of standardAngles) {
        const rad = deg * Math.PI / 180;
        const endX = centerX + (-width/2) * Math.cos(rad);
        const endY = centerY - (-width/2) * Math.sin(rad);
        
        radarContext.beginPath();
        radarContext.moveTo(centerX, centerY);
        radarContext.lineTo(endX, endY);
        // Highlight đường góc khi thanh radar quét qua
        const isNearAngle = Math.abs(currentAngle - deg) < 5;
        radarContext.strokeStyle = isNearAngle ? "#5eff5e" : GREEN;
        radarContext.lineWidth = isNearAngle ? 3 : 1;
        radarContext.stroke();
        
        // Draw angle labels
        const labelRadius = width * 0.38;
        let labelX, labelY;
        
        if (deg === 90) {
            labelX = centerX - 15;
            labelY = centerY - labelRadius - 25;
        } else if (deg < 90) {
            // Position for 30° and 60°
            labelX = centerX + labelRadius * Math.cos(rad) + 15;
            labelY = centerY - labelRadius * Math.sin(rad) - 15;
        } else {
            // Position for 120° and 150°
            labelX = centerX + labelRadius * Math.cos(rad) - 35;
            labelY = centerY - labelRadius * Math.sin(rad) - 15;
        }
        
        radarContext.font = "14px Arial";
        // Highlight text khi thanh radar quét qua
        radarContext.fillStyle = isNearAngle ? "#ffffff" : BRIGHT_GREEN;
        radarContext.fillText(`${deg}°`, labelX, labelY);
    }
}

function drawScanningLine(centerX, centerY, width) {
    // In radar mode, draw moving line
    if (currentMode === "RADAR") {
        // Only draw the scanning line if we have fresh radar data from Arduino
        if (hasFreshRadarData) {
            // Chuyển đổi góc thành radian
            const rad = currentAngle * Math.PI / 180;
            const endX = centerX + (width * 0.4) * Math.cos(rad);
            const endY = centerY - (width * 0.4) * Math.sin(rad);
            
            // Vẽ đường quét chính - hiển thị đúng vị trí của servo
            radarContext.beginPath();
            radarContext.moveTo(centerX, centerY);
            radarContext.lineTo(endX, endY);
            // Đổi màu dựa vào trạng thái di chuyển
            radarContext.strokeStyle = radarMoving ? "#00ff00" : "#50a050"; // Màu mờ hơn khi không di chuyển
            radarContext.lineWidth = 4; // Dày hơn để dễ nhìn
            radarContext.stroke();
        } else {
            // If we don't have fresh data yet, draw a static line at the last known position
            // This prevents the radar from moving on its own before getting server data
            if (isInitialAngleSet) {
                const rad = lastReceivedAngle * Math.PI / 180;
                const endX = centerX + (width * 0.4) * Math.cos(rad);
                const endY = centerY - (width * 0.4) * Math.sin(rad);
                
                radarContext.beginPath();
                radarContext.moveTo(centerX, centerY);
                radarContext.lineTo(endX, endY);
                // Use dimmer color to indicate waiting for data
                radarContext.strokeStyle = "#306030";
                radarContext.lineWidth = 4;
                radarContext.stroke();
                
                // Draw waiting indicator box
                radarContext.fillStyle = "rgba(0, 0, 0, 0.5)";
                radarContext.fillRect(centerX - 160, centerY - 40, 320, 70);
                radarContext.strokeStyle = "#306030";
                radarContext.lineWidth = 2;
                radarContext.strokeRect(centerX - 160, centerY - 40, 320, 70);
                
                // Add visual indicator that we're waiting for data
                radarContext.font = "16px Arial";
                radarContext.fillStyle = "#ffffff";
                radarContext.textAlign = "center";
                radarContext.fillText("⏳ Waiting for radar data...", centerX, centerY - 15);
                
                // Add additional information text
                radarContext.font = "14px Arial";
                radarContext.fillText("Position frozen until Arduino data arrives", centerX, centerY + 15);
            }
        }
    } else if (currentMode === "TRACKING" && detectedAngle > 0) {
        // In tracking mode, draw fixed line to detected angle
        const rad = detectedAngle * Math.PI / 180;
        const endX = centerX + (width * 0.4) * Math.cos(rad);
        const endY = centerY - (width * 0.4) * Math.sin(rad);
        
        radarContext.beginPath();
        radarContext.moveTo(centerX, centerY);
        radarContext.lineTo(endX, endY);
        radarContext.strokeStyle = YELLOW;
        radarContext.lineWidth = 3;
        radarContext.stroke();
    }
}

function drawDetectedObject(centerX, centerY, width) {
    // In HARD_FREEZE mode or without fresh data, draw nothing
    if (HARD_FREEZE || (currentMode === "RADAR" && !hasFreshRadarData)) {
        return; // Don't draw ANYTHING when frozen or without fresh data
    }
    
    // In RADAR mode, we ONLY draw objects if we have fresh data from the server
    if (currentMode === "RADAR") {
        // Only continue with actual radar data
        
        // Chuyển đổi góc và khoảng cách thành tọa độ trên canvas
        const rad = currentAngle * Math.PI / 180;
        
        // Calculate pixel distance - scale to fit radar display
        const pixDistance = currentDistance * (width * 0.4 / 100);
        
        // Calculate coordinates based on angle and distance
        const objX = centerX + pixDistance * Math.cos(rad);
        const objY = centerY - pixDistance * Math.sin(rad);
        
        const edgeX = centerX + (width * 0.4) * Math.cos(rad);
        const edgeY = centerY - (width * 0.4) * Math.sin(rad);
        
        // Nếu có vật thể trong phạm vi phát hiện, vẽ màu đặc biệt và to hơn
        if (isObjectDetected || currentDistance < DETECTION_DISTANCE) {
            // Vẽ đường nối từ vật thể đến viền radar
            radarContext.beginPath();
            radarContext.moveTo(objX, objY);
            radarContext.lineTo(edgeX, edgeY);
            radarContext.strokeStyle = "#FF0000"; // Đỏ tươi khi phát hiện vật thể
            radarContext.lineWidth = 4;
            radarContext.stroke();
            
            // Vẽ hình tròn đánh dấu vị trí vật thể - to hơn
            radarContext.beginPath();
            radarContext.arc(objX, objY, 7, 0, 2 * Math.PI);
            radarContext.fillStyle = "#FF0000";
            radarContext.fill();
            
            // Vẽ vòng tròn pulse hiệu ứng phát hiện vật thể
            const pulseSize = 10 + Math.sin(Date.now() / 200) * 5; // Hiệu ứng nhấp nháy
            radarContext.beginPath();
            radarContext.arc(objX, objY, pulseSize, 0, 2 * Math.PI);
            radarContext.strokeStyle = "rgba(255, 0, 0, 0.7)";
            radarContext.lineWidth = 2;
            radarContext.stroke();
        } 
        // Nếu có vật thể nhưng không trong phạm vi phát hiện
        else if (currentDistance < 100) {
            // Vẽ đường nối từ vật thể đến viền radar
            radarContext.beginPath();
            radarContext.moveTo(objX, objY);
            radarContext.lineTo(edgeX, edgeY);
            radarContext.strokeStyle = RED; // Đỏ thường khi chỉ là vật thể bình thường
            radarContext.lineWidth = 2;
            radarContext.stroke();
            
            // Vẽ hình tròn đánh dấu vị trí vật thể
            radarContext.beginPath();
            radarContext.arc(objX, objY, 5, 0, 2 * Math.PI);
            radarContext.fillStyle = RED;
            radarContext.fill();
        }
    }
    // For tracking mode and past detections
    else {
        // Handle recently detected object (separate from live radar data)
        if (detectedObject && Date.now() - detectedTimestamp < 3000) {
            // Object was detected within the last 3 seconds - highlight it
            const rad = detectedAngle * Math.PI / 180;
            const pixDistance = detectedDistance * (width * 0.4 / 100);
            
            const objX = centerX + pixDistance * Math.cos(rad);
            const objY = centerY - pixDistance * Math.sin(rad);
            
            // Draw line to detection point
            radarContext.beginPath();
            radarContext.moveTo(centerX, centerY);
            radarContext.lineTo(objX, objY);
            radarContext.strokeStyle = "#ff9900"; // Orange for detected object
            radarContext.lineWidth = 3;
            radarContext.stroke();
            
            // Pulse animation for detected object
            detectionPulseSize += 0.5;
            if (detectionPulseSize > 30) detectionPulseSize = 0;
            
            // Draw pulsing circle
            radarContext.beginPath();
            radarContext.arc(objX, objY, 8 + detectionPulseSize, 0, 2 * Math.PI);
            radarContext.strokeStyle = `rgba(255, 153, 0, ${1 - detectionPulseSize/30})`;
            radarContext.lineWidth = 3;
            radarContext.stroke();
            
            // Draw object point
            radarContext.beginPath();
            radarContext.arc(objX, objY, 8, 0, 2 * Math.PI);
            radarContext.fillStyle = "#ff9900";
            radarContext.fill();
        }
        
        if (currentMode === "TRACKING" && detectedDistance < 100) {
            // Draw detected object in tracking mode
            const pixDistance = detectedDistance * (width * 0.4 / 100);
            const rad = detectedAngle * Math.PI / 180;
            const objX = centerX + pixDistance * Math.cos(rad);
            const objY = centerY - pixDistance * Math.sin(rad);
            
            radarContext.beginPath();
            radarContext.arc(objX, objY, 7, 0, 2 * Math.PI);
            radarContext.fillStyle = YELLOW;
            radarContext.fill();
        }
    }
}

// Thêm hàm bắn
function shootTarget() {
    // Hiển thị hiệu ứng animation cho nút bắn
    const shootBtn = document.getElementById("shoot-btn");
    shootBtn.classList.add("btn-danger");
    shootBtn.classList.remove("btn-outline-danger");
    
    // Gửi lệnh bắn tới server
    sendWebSocketCommand("shoot");
    
    // Hiệu ứng âm thanh (nếu có)
    playShootSound();
    
    // Hiệu ứng flash màn hình
    showShootEffect();
    
    // Reset nút sau 1 giây
    setTimeout(function() {
        shootBtn.classList.remove("btn-danger");
        shootBtn.classList.add("btn-outline-danger");
    }, 1000);
}

// Thêm hiệu ứng âm thanh
function playShootSound() {
    try {
        // Tạo âm thanh đơn giản
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioContext.currentTime); // Tần số A5
        oscillator.frequency.exponentialRampToValueAtTime(110, audioContext.currentTime + 0.2); // Giảm tần số xuống A2
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.3);
    } catch (e) {
        console.log("Audio not supported:", e);
    }
}

// Thêm hiệu ứng flash khi bắn
function showShootEffect() {
    // Tạo flash overlay
    const flash = document.createElement("div");
    flash.style.position = "fixed";
    flash.style.top = "0";
    flash.style.left = "0";
    flash.style.width = "100%";
    flash.style.height = "100%";
    flash.style.backgroundColor = "rgba(255, 255, 255, 0.3)";
    flash.style.zIndex = "9999";
    flash.style.pointerEvents = "none"; // Cho phép click xuyên qua
    
    document.body.appendChild(flash);
    
    // Animation fade out
    setTimeout(function() {
        flash.style.transition = "opacity 0.5s";
        flash.style.opacity = "0";
        
        // Xóa element sau khi animation kết thúc
        setTimeout(function() {
            document.body.removeChild(flash);
        }, 500);
    }, 50);
}

// Update the reset radar state function to also reset detection flags
function resetRadarState() {
    // Clear any existing animation state
    hasFreshRadarData = false;
    radarMoving = false;
    window.recentPositions = [];
    // Set current angle to last received angle to prevent movement
    currentAngle = lastReceivedAngle;
    // Completely reset detection state
    isObjectDetected = false;
    currentDistance = 0;
    detectedObject = false;
    detectedTimestamp = 0;
    detectionPulseSize = 0;
    
    // Note: We don't reset HARD_FREEZE here since we control that explicitly in message handlers
}

// Add a new function for rendering the static waiting screen
function drawWaitingScreen() {
    // Clear canvas
    radarContext.clearRect(0, 0, radarCanvas.width, radarCanvas.height);
    
    // Get canvas dimensions
    const width = radarCanvas.width;
    const height = radarCanvas.height;
    
    // Calculate center point
    const centerX = width / 2;
    const centerY = height - height * 0.15;
    
    // Draw basic radar background
    drawRadarBackground(centerX, centerY, width, height);
    
    // Draw static line at last known position
    if (isInitialAngleSet) {
        const rad = lastReceivedAngle * Math.PI / 180;
        const endX = centerX + (width * 0.4) * Math.cos(rad);
        const endY = centerY - (width * 0.4) * Math.sin(rad);
        
        radarContext.beginPath();
        radarContext.moveTo(centerX, centerY);
        radarContext.lineTo(endX, endY);
        // Use very dim color to indicate freeze
        radarContext.strokeStyle = "#1a3f1a";  // Very dark green
        radarContext.lineWidth = 4;
        radarContext.stroke();
        
        // Draw waiting indicator box with warning colors
        radarContext.fillStyle = "rgba(20, 10, 0, 0.8)";  // Very dark orange background
        radarContext.fillRect(centerX - 160, centerY - 60, 320, 100);
        radarContext.strokeStyle = "#ff6a00";  // Bright orange border
        radarContext.lineWidth = 2;
        radarContext.strokeRect(centerX - 160, centerY - 60, 320, 100);
        
        // Add visual indicator that we're waiting for data
        radarContext.font = "16px Arial";
        radarContext.fillStyle = "#ff9900";  // Orange for better visibility
        radarContext.textAlign = "center";
        radarContext.fillText("⏳ WAITING FOR RADAR DATA", centerX, centerY - 30);
        
        // Add additional information text
        radarContext.font = "14px Arial";
        radarContext.fillStyle = "#ffffff";
        radarContext.fillText("Radar display is COMPLETELY FROZEN", centerX, centerY);
        radarContext.fillText("Waiting for Arduino to send position data", centerX, centerY + 25);
    }
}

// Add a new function to draw detection popup
function drawDetectionPopup(centerX, centerY, width) {
    if (detectedObject && Date.now() - detectedTimestamp < 3000) {
        // Calculate position coordinates
        const rad = detectedAngle * Math.PI / 180;
        const pixDistance = detectedDistance * (width * 0.4 / 100);
        
        const objX = centerX + pixDistance * Math.cos(rad);
        const objY = centerY - pixDistance * Math.sin(rad);
        
        // Draw line to detection point
        radarContext.beginPath();
        radarContext.moveTo(centerX, centerY);
        radarContext.lineTo(objX, objY);
        radarContext.strokeStyle = "#ff9900"; // Orange for detected object
        radarContext.lineWidth = 3;
        radarContext.stroke();
        
        // Draw detection indicator box with warning colors
        radarContext.fillStyle = "rgba(255, 50, 0, 0.8)";  // Red-orange background
        radarContext.fillRect(centerX - 160, centerY - 60, 320, 100);
        radarContext.strokeStyle = "#ff6a00";  // Bright orange border
        radarContext.lineWidth = 2;
        radarContext.strokeRect(centerX - 160, centerY - 60, 320, 100);
        
        // Add visual indicator that object was detected
        radarContext.font = "16px Arial";
        radarContext.fillStyle = "#ffffff";  // White text
        radarContext.textAlign = "center";
        radarContext.fillText("⚠️ OBJECT DETECTED!", centerX, centerY - 30);
        
        // Add angle and distance information
        radarContext.font = "14px Arial";
        radarContext.fillStyle = "#ffffff";
        radarContext.fillText(`Position: ${detectedAngle}°`, centerX, centerY);
        radarContext.fillText(`Distance: ${detectedDistance} cm`, centerX, centerY + 25);
        
        // Draw the object point with animation
        detectionPulseSize += 0.5;
        if (detectionPulseSize > 30) detectionPulseSize = 0;
        
        // Draw pulsing circle
        radarContext.beginPath();
        radarContext.arc(objX, objY, 8 + detectionPulseSize, 0, 2 * Math.PI);
        radarContext.strokeStyle = `rgba(255, 153, 0, ${1 - detectionPulseSize/30})`;
        radarContext.lineWidth = 3;
        radarContext.stroke();
        
        // Draw object point
        radarContext.beginPath();
        radarContext.arc(objX, objY, 10, 0, 2 * Math.PI);
        radarContext.fillStyle = "#ff3300";
        radarContext.fill();
        
        return true; // Indicate that we drew a popup
    }
    
    return false; // No popup drawn
}

// Add a function to play detection alert sound
function playDetectionAlert() {
    try {
        // Create a simple alert sound
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioContext.currentTime); // A5
        oscillator.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.1); // A4
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.3);
    } catch (e) {
        console.log("Audio not supported:", e);
    }
}

// Clean up on page unload
window.addEventListener("beforeunload", function() {
    // Stop animation
    if (requestAnimationId) {
        cancelAnimationFrame(requestAnimationId);
    }
    
    // Close WebSocket
    if (websocket) {
        websocket.close();
    }
}); 