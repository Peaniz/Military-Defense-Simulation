/**
 * Web Radar and Object Tracking System - UI Module
 * Handles UI updates and display functions
 */

// Update UI elements based on state
function updateUIElements() {
    // Update mode indicator
    document.getElementById('mode-indicator').textContent = radarState.currentMode;
    document.getElementById('mode-indicator').className = `mode-${radarState.currentMode.toLowerCase()}`;
    
    // Update connection status
    const statusElement = document.getElementById('connection-status');
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        statusElement.textContent = "Connected";
        statusElement.className = "status-connected";
    } else {
        statusElement.textContent = "Disconnected";
        statusElement.className = "status-disconnected";
    }
    
    // Update radar angle display
    document.getElementById('current-angle').textContent = 
        `Angle: ${radarState.currentAngle.toFixed(1)}°`;
    
    // Update distance display if in tracking mode with detection
    const distanceElement = document.getElementById('current-distance');
    if (radarState.currentMode === "TRACKING" && detectionState.isObjectDetected) {
        distanceElement.textContent = `Distance: ${detectionState.detectedDistance.toFixed(1)} cm`;
        distanceElement.style.display = "block";
    } else {
        distanceElement.style.display = "none";
    }
    
    // Update timing data if debugging is enabled
    if (window.debugMode) {
        updateTimingInfo();
    }
    
    // Update control buttons based on current mode
    updateControlButtons();
}

// Update control buttons based on current mode
function updateControlButtons() {
    const toggleButton = document.getElementById('toggle-mode');
    const freezeButton = document.getElementById('freeze-radar');
    
    // Update toggle button text and state
    if (radarState.currentMode === "RADAR") {
        toggleButton.textContent = "Switch to Tracking";
        toggleButton.classList.remove("mode-tracking");
        toggleButton.classList.add("mode-radar");
    } else {
        toggleButton.textContent = "Switch to Radar";
        toggleButton.classList.remove("mode-radar");
        toggleButton.classList.add("mode-tracking");
    }
    
    // Update freeze button text and state
    if (radarState.hardFreeze) {
        freezeButton.textContent = "Unfreeze Radar";
        freezeButton.classList.add("frozen");
    } else {
        freezeButton.textContent = "Freeze Radar";
        freezeButton.classList.remove("frozen");
    }
}

// Update timing information for debugging
function updateTimingInfo() {
    const timingInfoElement = document.getElementById('timing-info');
    if (!timingInfoElement) return;
    
    // Create timing information display
    let timingHTML = "";
    
    // Add last data received time
    if (radarState.lastDataReceivedTime > 0) {
        const dataAge = (Date.now() - radarState.lastDataReceivedTime) / 1000;
        timingHTML += `Last data: ${dataAge.toFixed(1)}s ago<br>`;
    }
    
    // Add frame rate information
    if (window.frameTimeHistory && window.frameTimeHistory.length > 0) {
        const sum = window.frameTimeHistory.reduce((a, b) => a + b, 0);
        const avg = sum / window.frameTimeHistory.length;
        const fps = 1000 / avg;
        timingHTML += `FPS: ${fps.toFixed(1)}`;
    }
    
    timingInfoElement.innerHTML = timingHTML;
}

// Play alert sound when object is detected
function playDetectionAlert() {
    const alertSound = document.getElementById('detection-alert');
    if (alertSound) {
        alertSound.currentTime = 0;
        alertSound.play().catch(err => {
            console.warn("Could not play alert sound:", err);
        });
    }
}

// Display a status message
function showStatusMessage(message, type = "info", duration = 3000) {
    const statusContainer = document.getElementById('status-messages');
    if (!statusContainer) return;
    
    // Create message element
    const msgElement = document.createElement('div');
    msgElement.className = `status-message ${type}`;
    msgElement.textContent = message;
    
    // Add to container
    statusContainer.appendChild(msgElement);
    
    // Fade in
    setTimeout(() => {
        msgElement.classList.add('visible');
    }, 10);
    
    // Remove after duration
    if (duration > 0) {
        setTimeout(() => {
            msgElement.classList.remove('visible');
            setTimeout(() => {
                msgElement.remove();
            }, 300);
        }, duration);
    }
    
    return msgElement;
}

// Initialize UI event listeners
function initializeUIEvents() {
    // Mode toggle button
    document.getElementById('toggle-mode').addEventListener('click', function() {
        const newMode = radarState.currentMode === "RADAR" ? "TRACKING" : "RADAR";
        sendCommand({ command: "set_mode", mode: newMode });
        showStatusMessage(`Switching to ${newMode} mode...`, "info");
    });
    
    // Freeze radar button
    document.getElementById('freeze-radar').addEventListener('click', function() {
        radarState.hardFreeze = !radarState.hardFreeze;
        updateControlButtons();
        showStatusMessage(radarState.hardFreeze ? 
            "Radar display frozen" : "Radar display unfrozen", "info");
    });
    
    // Reconnect WebSocket button
    document.getElementById('reconnect-ws').addEventListener('click', function() {
        if (wsConnection) {
            wsConnection.close();
        }
        initializeWebSocket();
        showStatusMessage("Attempting to reconnect...", "info");
    });
    
    // Debug toggle
    document.getElementById('debug-toggle').addEventListener('click', function() {
        window.debugMode = !window.debugMode;
        document.getElementById('debug-panel').style.display = 
            window.debugMode ? "block" : "none";
    });
    
    // Add other UI event listeners here as needed
}

// Update parameters display section
function updateParametersDisplay(params) {
    const paramsContainer = document.getElementById('parameters-display');
    if (!paramsContainer) return;
    
    // Clear existing content
    paramsContainer.innerHTML = "";
    
    // Add each parameter
    for (const [key, value] of Object.entries(params)) {
        const paramRow = document.createElement('div');
        paramRow.className = 'param-row';
        
        const paramName = document.createElement('span');
        paramName.className = 'param-name';
        paramName.textContent = key;
        
        const paramValue = document.createElement('span');
        paramValue.className = 'param-value';
        paramValue.textContent = typeof value === 'number' ? value.toFixed(2) : value;
        
        paramRow.appendChild(paramName);
        paramRow.appendChild(paramValue);
        paramsContainer.appendChild(paramRow);
    }
} 