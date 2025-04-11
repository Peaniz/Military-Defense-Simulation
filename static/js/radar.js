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
    window.recentPositions = [{
        angle: currentAngle,
        timestamp: Date.now()
    }];
    
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
                currentAngle = targetAngle; // Set initial angle immediately
                currentDistance = message.distance;
                updateSystemMessage(message.message);
                updateModeDisplay();
                
                // Cập nhật hướng quét từ server
                if (message.direction !== undefined) {
                    radarDirection = message.direction;
                }
                
                // Debug
                console.log(`[WebSocket] Init: Angle=${targetAngle}, Direction=${radarDirection}`);
                
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
                // Update radar data from actual servo movement
                lastAngleUpdateTime = Date.now();
                
                targetAngle = message.angle; // Cập nhật góc đích
                currentAngle = targetAngle; // Directly sync with server angle
                currentDistance = message.distance;
                
                // Cập nhật hướng quét nếu server gửi
                if (message.direction !== undefined) {
                    radarDirection = message.direction;
                }
                
                // Log less frequently to avoid console spam
                if (Math.random() < 0.1) {
                    console.log(`[WebSocket] Radar update: Angle=${targetAngle}, Distance=${currentDistance}`);
                }
                
                // Cập nhật trạng thái phát hiện đối tượng
                if (message.detection !== undefined) {
                    isObjectDetected = message.detection;
                }
                
                // Đảm bảo góc nằm trong giới hạn
                if (targetAngle < MIN_RADAR_ANGLE) targetAngle = MIN_RADAR_ANGLE;
                if (targetAngle > MAX_RADAR_ANGLE) targetAngle = MAX_RADAR_ANGLE;
                
                // Thêm vị trí mới cho hiệu ứng afterglow
                if (window.recentPositions) {
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
                
                updateSystemMessage(`Object detected at ${detectedAngle}° with distance ${detectedDistance}cm!`);
                break;
                
            case "mode_change":
                // Mode changed
                currentMode = message.mode;
                updateSystemMessage(message.message);
                updateModeDisplay();
                
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
    
    // If we haven't received updates for 2 seconds and we're in RADAR mode, simulate movement
    const timeSinceLastUpdate = Date.now() - lastAngleUpdateTime;
    if (currentMode === "RADAR" && timeSinceLastUpdate > 2000) {
        // Simulate servo movement if no updates are received
        currentAngle += radarDirection * (deltaTime * 0.03); // Speed: about 30 degrees per second
        
        // Change direction at limits
        if (currentAngle >= MAX_RADAR_ANGLE) {
            currentAngle = MAX_RADAR_ANGLE;
            radarDirection = -1;
        } else if (currentAngle <= MIN_RADAR_ANGLE) {
            currentAngle = MIN_RADAR_ANGLE;
            radarDirection = 1;
        }
        
        // Every 10th frame, log that we're simulating
        if (Math.random() < 0.1) {
            console.log(`Simulating radar movement: Angle=${Math.round(currentAngle)}, Direction=${radarDirection}`);
        }
        
        // Store for afterglow effect
        if (window.recentPositions) {
            window.recentPositions.unshift({
                angle: currentAngle,
                timestamp: Date.now()
            });
            
            if (window.recentPositions.length > 20) {
                window.recentPositions.pop();
            }
        }
        
        updateAngleDisplay();
    }
    
    // Just ensure angles are within bounds
    if (currentAngle < MIN_RADAR_ANGLE) currentAngle = MIN_RADAR_ANGLE;
    if (currentAngle > MAX_RADAR_ANGLE) currentAngle = MAX_RADAR_ANGLE;
    
    // Draw radar background
    drawRadarBackground(centerX, centerY, width, height);
    
    // Draw scanning line
    drawScanningLine(centerX, centerY, width);
    
    // Draw detected object if any
    drawDetectedObject(centerX, centerY, width);
    
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
        // Chuyển đổi góc thành radian
        const rad = currentAngle * Math.PI / 180;
        const endX = centerX + (width * 0.4) * Math.cos(rad);
        const endY = centerY - (width * 0.4) * Math.sin(rad);
        
        // Vẽ đường quét chính - hiển thị đúng vị trí của servo
        radarContext.beginPath();
        radarContext.moveTo(centerX, centerY);
        radarContext.lineTo(endX, endY);
        radarContext.strokeStyle = "#00ff00"; // Màu xanh lá sáng hơn để thấy rõ
        radarContext.lineWidth = 4; // Dày hơn để dễ nhìn
        radarContext.stroke();
        
        // Khởi tạo mảng lưu trữ vị trí nếu chưa có
        if (!window.recentPositions) {
            window.recentPositions = [{
                angle: currentAngle,
                timestamp: Date.now()
            }];
        }
        
        // Vẽ hiệu ứng dải màu (afterglow effect) theo vị trí đã lưu
        window.recentPositions.forEach((pos, index) => {
            // Chỉ giữ các vị trí trong 800ms gần đây
            if (Date.now() - pos.timestamp > 800) {
                return;
            }
            
            const alpha = 0.8 * (1 - index / Math.min(10, window.recentPositions.length));
            const prevRad = pos.angle * Math.PI / 180;
            const prevEndX = centerX + (width * 0.4) * Math.cos(prevRad);
            const prevEndY = centerY - (width * 0.4) * Math.sin(prevRad);
            
            radarContext.beginPath();
            radarContext.moveTo(centerX, centerY);
            radarContext.lineTo(prevEndX, prevEndY);
            radarContext.strokeStyle = `rgba(0, 255, 0, ${alpha})`;
            radarContext.lineWidth = 3 - (2 * index / window.recentPositions.length);
            radarContext.stroke();
        });
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
    // First handle recently detected object (separate from live radar data)
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
    
    // Handle normal radar detection drawing
    if (currentMode === "RADAR") {
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
    } else if (currentMode === "TRACKING" && detectedDistance < 100) {
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