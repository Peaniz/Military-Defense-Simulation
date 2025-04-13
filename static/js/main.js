/**
 * Web Radar and Object Tracking System - Main Module
 * Handles initialization and core functionality
 */

// Global state
const radarState = {
    currentMode: "RADAR",
    currentAngle: 90,
    targetAngle: 90,
    currentDistance: 0,
    radarDirection: 1,
    isObjectDetected: false,
    lastAngleUpdateTime: 0,
    radarMoving: false,
    isInitialAngleSet: false,
    lastReceivedAngle: 90,
    initialConnectionMade: false,
    hasFreshRadarData: false,
    HARD_FREEZE: false,
    trackingMode: 1, // 1 = Face, 2 = Hand
};

// Constants
const CONSTANTS = {
    MIN_RADAR_ANGLE: 15,
    MAX_RADAR_ANGLE: 165,
    DETECTION_DISTANCE: 40,
    GREEN: "#62ff00",
    BRIGHT_GREEN: "#98f53c",
    RED: "#ff0a0a",
    LIGHT_GREEN: "#1efa3c",
    YELLOW: "#ffff00",
    WHITE: "#ffffff",
    ARDUINO_DELAY: 30,
    SIMULATION_SPEED_FACTOR: 0.03
};

// Detection state
const detectionState = {
    detectedObject: false,
    detectedTimestamp: 0,
    detectedAngle: 0,
    detectedDistance: 0,
    detectionPulseSize: 0,
    keepPopupVisible: false
};

// Core elements
let radarCanvas = null;
let radarContext = null;
let requestAnimationId = null;
let lastFrameTime = 0;

// Initialize when DOM is fully loaded
document.addEventListener("DOMContentLoaded", function () {
    // Get radar canvas
    radarCanvas = document.getElementById("radar-canvas");
    radarContext = radarCanvas.getContext("2d");
    
    // Set actual canvas dimensions (for high DPI displays)
    setupCanvas();
    window.addEventListener("resize", setupCanvas);
    
    // Initialize the lastAngleUpdateTime to avoid immediate simulation
    radarState.lastAngleUpdateTime = Date.now();
    
    // Initialize the recentPositions array for trail effect
    window.recentPositions = [];
    
    // Connect to WebSocket
    initializeWebSocket();
    
    // Setup UI event listeners
    setupEventListeners();
    
    // Start animation loop
    requestAnimationId = requestAnimationFrame(drawRadarView);
});

// Setup canvas for high DPI displays
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