/**
 * Web Radar and Object Tracking System - WebSocket Module
 * Handles WebSocket connection and message handling
 */

// WebSocket connection
let wsConnection = null;
let wsRetryCount = 0;
const WS_MAX_RETRIES = 5;
const WS_RETRY_DELAY = 2000;

// Initialize WebSocket connection
function initializeWebSocket() {
    // Close existing connection if any
    if (wsConnection) {
        wsConnection.close();
    }
    
    // Determine WebSocket URL based on current location
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;
    
    // Create new WebSocket connection
    try {
        wsConnection = new WebSocket(wsUrl);
        
        // Connection opened handler
        wsConnection.onopen = function(event) {
            console.log("WebSocket connection established");
            wsRetryCount = 0;
            showStatusMessage("Connected to radar system", "success");
            
            // Request initial state
            sendCommand({ command: "get_state" });
        };
        
        // Message received handler
        wsConnection.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(data);
            } catch (error) {
                console.error("Error parsing WebSocket message:", error);
            }
        };
        
        // Connection closed handler
        wsConnection.onclose = function(event) {
            console.log("WebSocket connection closed", event);
            
            // Attempt to reconnect if not closed cleanly
            if (event.code !== 1000) {
                handleWebSocketDisconnect();
            }
        };
        
        // Error handler
        wsConnection.onerror = function(error) {
            console.error("WebSocket error:", error);
            showStatusMessage("Connection error", "error");
        };
        
    } catch (error) {
        console.error("Failed to create WebSocket connection:", error);
        showStatusMessage("Failed to connect", "error");
    }
}

// Handle WebSocket disconnect with retry logic
function handleWebSocketDisconnect() {
    if (wsRetryCount < WS_MAX_RETRIES) {
        wsRetryCount++;
        
        const delay = WS_RETRY_DELAY * wsRetryCount;
        showStatusMessage(`Connection lost. Reconnecting in ${delay/1000}s... (${wsRetryCount}/${WS_MAX_RETRIES})`, "warning");
        
        setTimeout(function() {
            if (document.visibilityState !== "hidden") {
                initializeWebSocket();
            }
        }, delay);
    } else {
        showStatusMessage("Connection lost. Please reconnect manually.", "error", 0);
    }
}

// Send command to server through WebSocket
function sendCommand(commandObj) {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
        console.error("Cannot send command - WebSocket not connected");
        showStatusMessage("Not connected to server", "error");
        return false;
    }
    
    try {
        wsConnection.send(JSON.stringify(commandObj));
        return true;
    } catch (error) {
        console.error("Error sending command:", error);
        return false;
    }
}

// Handle incoming WebSocket messages
function handleWebSocketMessage(data) {
    // Update last data received time
    radarState.lastDataReceivedTime = Date.now();
    
    // Process message based on type
    switch (data.type) {
        case "radar_data":
            handleRadarData(data);
            break;
            
        case "detection":
            handleDetectionData(data);
            break;
            
        case "state_update":
            handleStateUpdate(data);
            break;
            
        case "system_message":
            handleSystemMessage(data);
            break;
            
        case "error":
            handleErrorMessage(data);
            break;
            
        default:
            console.log("Unknown message type:", data.type);
    }
    
    // Update UI after processing any message
    updateUIElements();
}

// Handle radar scan data
function handleRadarData(data) {
    // Update angle
    radarState.currentAngle = data.angle;
    
    // Store distance data for current angle
    radarState.distanceData[data.angle] = data.distance;
    
    // If in radar mode, we should redraw
    if (radarState.currentMode === "RADAR" && !radarState.hardFreeze) {
        requestAnimationFrame(drawRadarView);
    }
}

// Handle object detection data
function handleDetectionData(data) {
    // Object was detected
    if (data.detected) {
        detectionState.isObjectDetected = true;
        detectionState.detectedAngle = data.angle;
        detectionState.detectedDistance = data.distance;
        detectionState.detectionTime = Date.now();
        
        // Add to position history (for tracking trail)
        detectionState.positionHistory.push({
            angle: data.angle,
            distance: data.distance,
            time: detectionState.detectionTime
        });
        
        // Limit history size
        while (detectionState.positionHistory.length > MAX_POSITION_HISTORY) {
            detectionState.positionHistory.shift();
        }
        
        // Reset detection pulse animation
        resetDetectionPulse();
        
        // If in tracking mode, draw detection
        if (radarState.currentMode === "TRACKING") {
            requestAnimationFrame(drawTrackingView);
        }
    } else {
        // No detection or lost tracking
        if (detectionState.isObjectDetected) {
            detectionState.isObjectDetected = false;
            showStatusMessage("Lost tracking", "warning");
        }
    }
}

// Handle state update message
function handleStateUpdate(data) {
    // Update radar mode
    if (data.mode && data.mode !== radarState.currentMode) {
        radarState.currentMode = data.mode;
        showStatusMessage(`Mode changed to ${data.mode}`, "info");
        
        // Clear any existing detection if switching to radar mode
        if (data.mode === "RADAR") {
            detectionState.isObjectDetected = false;
        }
        
        // Request redraw based on new mode
        if (data.mode === "RADAR") {
            requestAnimationFrame(drawRadarView);
        } else {
            requestAnimationFrame(drawTrackingView);
        }
    }
    
    // Update other state properties if provided
    if (data.tracking_type !== undefined) {
        radarState.trackingType = data.tracking_type;
    }
    
    // Update parameters if provided
    if (data.parameters) {
        updateParametersDisplay(data.parameters);
    }
}

// Handle system message
function handleSystemMessage(data) {
    showStatusMessage(data.message, data.level || "info");
}

// Handle error message
function handleErrorMessage(data) {
    console.error("Server error:", data.message);
    showStatusMessage(`Error: ${data.message}`, "error");
}

// Document visibility change handler to reconnect when page becomes visible
document.addEventListener("visibilitychange", function() {
    if (document.visibilityState === "visible" && 
        (!wsConnection || wsConnection.readyState !== WebSocket.OPEN)) {
        initializeWebSocket();
    }
}); 