/**
 * Web Radar and Object Tracking System - Radar Display Module
 * Handles radar visualization and drawing functions
 */

// Canvas and drawing context
let radarCanvas = null;
let radarCtx = null;

// Animation frame ID for rendering loop
let animationFrameId = null;

// Constants for radar display
const RADAR_DISPLAY = {
    MAX_RANGE: 200,         // Maximum detection range in cm
    RANGE_RINGS: 4,         // Number of range rings to display
    SWEEP_TRAIL_LENGTH: 20, // Length of radar sweep trail effect
    PULSE_MAX_SIZE: 30,     // Maximum size of detection pulse animation
    PULSE_SPEED: 0.8,       // Speed of pulse animation
    HISTORY_FADEOUT: 5000   // Time in ms for position history to fade out
};

// Initialize radar display
function initializeRadarDisplay() {
    // Get the canvas element and its context
    radarCanvas = document.getElementById('radar-canvas');
    radarCtx = radarCanvas.getContext('2d');
    
    // Set initial canvas size based on container
    resizeRadarCanvas();
    
    // Handle window resize events
    window.addEventListener('resize', resizeRadarCanvas);
    
    // Start the animation loop
    startRadarAnimation();
}

// Resize radar canvas to fit container
function resizeRadarCanvas() {
    const container = document.getElementById('radar-container');
    if (!container || !radarCanvas) return;
    
    // Get container dimensions
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    // Set canvas size to match container
    radarCanvas.width = width;
    radarCanvas.height = height;
    
    // Redraw radar immediately after resize
    if (radarState.currentMode === "RADAR") {
        drawRadarView();
    } else if (radarState.currentMode === "TRACKING") {
        drawTrackingView();
    }
}

// Start radar animation loop
function startRadarAnimation() {
    // Cancel any existing animation frame
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    
    // Start new animation frame based on current mode
    if (radarState.currentMode === "RADAR") {
        animationFrameId = requestAnimationFrame(drawRadarView);
    } else if (radarState.currentMode === "TRACKING") {
        animationFrameId = requestAnimationFrame(drawTrackingView);
    }
}

// Stop radar animation loop
function stopRadarAnimation() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

// Draw the radar sweep view
function drawRadarView() {
    if (!radarCtx || !radarCanvas) return;
    
    // Don't continue animation if hard freeze is active
    if (radarState.hardFreeze) {
        animationFrameId = null;
        return;
    }
    
    // Clear canvas
    radarCtx.clearRect(0, 0, radarCanvas.width, radarCanvas.height);
    
    // Calculate radar center and radius
    const centerX = radarCanvas.width / 2;
    const centerY = radarCanvas.height;
    const radius = Math.min(radarCanvas.width, radarCanvas.height * 2) * 0.9;
    
    // Draw the background
    drawRadarBackground(centerX, centerY, radius);
    
    // Draw range rings
    drawRangeRings(centerX, centerY, radius);
    
    // Draw angle indicators
    drawAngleIndicators(centerX, centerY, radius);
    
    // Draw sweep trail (recent positions)
    drawSweepTrail(centerX, centerY, radius);
    
    // Draw the current distance as a point on the sweep line
    drawDistancePoint(centerX, centerY, radius);
    
    // Draw the radar sweep line
    drawSweepLine(centerX, centerY, radius);
    
    // Draw detection if any
    if (detectionState.isObjectDetected && 
        radarState.currentMode === "RADAR") {
        drawDetectionIndicator(centerX, centerY, radius);
    }
    
    // Continue animation loop
    animationFrameId = requestAnimationFrame(drawRadarView);
}

// Draw radar tracking view
function drawTrackingView() {
    if (!radarCtx || !radarCanvas) return;
    
    // Clear canvas
    radarCtx.clearRect(0, 0, radarCanvas.width, radarCanvas.height);
    
    // Calculate radar center and radius
    const centerX = radarCanvas.width / 2;
    const centerY = radarCanvas.height;
    const radius = Math.min(radarCanvas.width, radarCanvas.height * 2) * 0.9;
    
    // Draw the background
    drawRadarBackground(centerX, centerY, radius);
    
    // Draw range rings
    drawRangeRings(centerX, centerY, radius);
    
    // Draw angle indicators
    drawAngleIndicators(centerX, centerY, radius);
    
    // Draw position history (tracking trail)
    drawPositionHistory(centerX, centerY, radius);
    
    // Draw current detection if active
    if (detectionState.isObjectDetected) {
        drawDetectionIndicator(centerX, centerY, radius);
        
        // Draw fixed line to current detection
        drawFixedLine(centerX, centerY, radius, detectionState.detectedAngle);
    }
    
    // Continue animation loop
    animationFrameId = requestAnimationFrame(drawTrackingView);
}

// Draw radar background
function drawRadarBackground(centerX, centerY, radius) {
    radarCtx.fillStyle = 'rgba(0, 20, 40, 0.7)';
    radarCtx.beginPath();
    radarCtx.arc(centerX, centerY, radius, Math.PI, 0, false);
    radarCtx.fill();
    
    // Draw radar border
    radarCtx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
    radarCtx.lineWidth = 2;
    radarCtx.beginPath();
    radarCtx.arc(centerX, centerY, radius, Math.PI, 0, false);
    radarCtx.stroke();
}

// Draw range rings
function drawRangeRings(centerX, centerY, radius) {
    radarCtx.strokeStyle = 'rgba(0, 255, 255, 0.2)';
    radarCtx.lineWidth = 1;
    
    for (let i = 1; i <= RADAR_DISPLAY.RANGE_RINGS; i++) {
        const ringRadius = (radius / RADAR_DISPLAY.RANGE_RINGS) * i;
        
        radarCtx.beginPath();
        radarCtx.arc(centerX, centerY, ringRadius, Math.PI, 0, false);
        radarCtx.stroke();
        
        // Draw range label
        const rangeDist = Math.round((RADAR_DISPLAY.MAX_RANGE / RADAR_DISPLAY.RANGE_RINGS) * i);
        radarCtx.fillStyle = 'rgba(0, 255, 255, 0.7)';
        radarCtx.font = '12px Arial';
        radarCtx.fillText(`${rangeDist}cm`, centerX - 15, centerY - ringRadius + 15);
    }
}

// Draw angle indicators
function drawAngleIndicators(centerX, centerY, radius) {
    radarCtx.strokeStyle = 'rgba(0, 255, 255, 0.3)';
    radarCtx.fillStyle = 'rgba(0, 255, 255, 0.7)';
    radarCtx.font = '12px Arial';
    radarCtx.textAlign = 'center';
    
    // Draw angle lines every 15 degrees
    for (let angle = 0; angle <= 180; angle += 15) {
        const radian = (angle - 90) * Math.PI / 180;
        
        // Draw line
        radarCtx.beginPath();
        radarCtx.moveTo(centerX, centerY);
        radarCtx.lineTo(
            centerX + Math.cos(radian) * radius,
            centerY + Math.sin(radian) * radius
        );
        radarCtx.stroke();
        
        // Draw angle text
        if (angle % 30 === 0) {
            radarCtx.fillText(
                `${angle}°`, 
                centerX + Math.cos(radian) * (radius + 15),
                centerY + Math.sin(radian) * (radius + 15)
            );
        }
    }
}

// Draw radar sweep line
function drawSweepLine(centerX, centerY, radius) {
    const angle = radarState.currentAngle;
    const radian = (angle - 90) * Math.PI / 180;
    
    // Draw sweep line
    radarCtx.strokeStyle = 'rgba(0, 255, 40, 0.8)';
    radarCtx.lineWidth = 2;
    radarCtx.beginPath();
    radarCtx.moveTo(centerX, centerY);
    radarCtx.lineTo(
        centerX + Math.cos(radian) * radius,
        centerY + Math.sin(radian) * radius
    );
    radarCtx.stroke();
    
    // Draw sweep gradient
    const gradient = radarCtx.createRadialGradient(
        centerX, centerY, 0,
        centerX, centerY, radius
    );
    gradient.addColorStop(0, 'rgba(0, 255, 40, 0.3)');
    gradient.addColorStop(1, 'rgba(0, 255, 40, 0)');
    
    radarCtx.fillStyle = gradient;
    radarCtx.beginPath();
    radarCtx.moveTo(centerX, centerY);
    radarCtx.arc(centerX, centerY, radius, radian - 0.1, radian + 0.1);
    radarCtx.fill();
}

// Draw fixed line (for tracking mode)
function drawFixedLine(centerX, centerY, radius, angle) {
    const radian = (angle - 90) * Math.PI / 180;
    
    // Draw line
    radarCtx.strokeStyle = 'rgba(255, 40, 40, 0.8)';
    radarCtx.lineWidth = 2;
    radarCtx.beginPath();
    radarCtx.moveTo(centerX, centerY);
    radarCtx.lineTo(
        centerX + Math.cos(radian) * radius,
        centerY + Math.sin(radian) * radius
    );
    radarCtx.stroke();
}

// Draw the sweep trail effect
function drawSweepTrail(centerX, centerY, radius) {
    if (!radarState.sweepPositions || !radarState.sweepPositions.length) return;
    
    const now = Date.now();
    const maxAge = 1000; // Max age for sweep positions in ms
    
    // Filter out old positions and keep only recent ones
    radarState.sweepPositions = radarState.sweepPositions.filter(pos => {
        return now - pos.time < maxAge;
    });
    
    // Draw each position in the trail with fading opacity
    radarState.sweepPositions.forEach((pos, index) => {
        const age = now - pos.time;
        const opacity = 1 - (age / maxAge); // Opacity decreases with age
        
        const radian = (pos.angle - 90) * Math.PI / 180;
        
        // Draw fading line
        radarCtx.strokeStyle = `rgba(0, 255, 40, ${opacity * 0.3})`;
        radarCtx.lineWidth = 1;
        radarCtx.beginPath();
        radarCtx.moveTo(centerX, centerY);
        radarCtx.lineTo(
            centerX + Math.cos(radian) * radius,
            centerY + Math.sin(radian) * radius
        );
        radarCtx.stroke();
    });
    
    // Add current position to trail
    radarState.sweepPositions.unshift({
        angle: radarState.currentAngle,
        time: now
    });
    
    // Limit trail length
    if (radarState.sweepPositions.length > RADAR_DISPLAY.SWEEP_TRAIL_LENGTH) {
        radarState.sweepPositions.pop();
    }
}

// Draw position history (tracking trail)
function drawPositionHistory(centerX, centerY, radius) {
    if (!detectionState.positionHistory || !detectionState.positionHistory.length) return;
    
    const now = Date.now();
    
    // Draw each position in history with decreasing opacity
    detectionState.positionHistory.forEach((pos, index) => {
        const age = now - pos.time;
        
        // Skip if too old
        if (age > RADAR_DISPLAY.HISTORY_FADEOUT) return;
        
        const opacity = 1 - (age / RADAR_DISPLAY.HISTORY_FADEOUT);
        const size = 5 + (10 * opacity);
        
        // Calculate position on radar
        const radian = (pos.angle - 90) * Math.PI / 180;
        const distance = pos.distance / RADAR_DISPLAY.MAX_RANGE * radius;
        
        const x = centerX + Math.cos(radian) * distance;
        const y = centerY + Math.sin(radian) * distance;
        
        // Draw history point
        radarCtx.fillStyle = `rgba(255, 100, 100, ${opacity})`;
        radarCtx.beginPath();
        radarCtx.arc(x, y, size, 0, Math.PI * 2);
        radarCtx.fill();
    });
}

// Draw the distance point on the radar
function drawDistancePoint(centerX, centerY, radius) {
    if (!radarState.distanceData) return;
    
    const angle = radarState.currentAngle;
    const distance = radarState.distanceData[angle];
    
    if (!distance) return;
    
    // Calculate position of distance point
    const radian = (angle - 90) * Math.PI / 180;
    const scaledDistance = distance / RADAR_DISPLAY.MAX_RANGE * radius;
    
    const x = centerX + Math.cos(radian) * scaledDistance;
    const y = centerY + Math.sin(radian) * scaledDistance;
    
    // Draw point
    radarCtx.fillStyle = 'rgba(255, 255, 0, 0.8)';
    radarCtx.beginPath();
    radarCtx.arc(x, y, 4, 0, Math.PI * 2);
    radarCtx.fill();
    
    // Add glow effect
    radarCtx.fillStyle = 'rgba(255, 255, 0, 0.3)';
    radarCtx.beginPath();
    radarCtx.arc(x, y, 8, 0, Math.PI * 2);
    radarCtx.fill();
}

// Draw detection indicator
function drawDetectionIndicator(centerX, centerY, radius) {
    const angle = detectionState.detectedAngle;
    const distance = detectionState.detectedDistance;
    
    // Calculate position
    const radian = (angle - 90) * Math.PI / 180;
    const scaledDistance = distance / RADAR_DISPLAY.MAX_RANGE * radius;
    
    const x = centerX + Math.cos(radian) * scaledDistance;
    const y = centerY + Math.sin(radian) * scaledDistance;
    
    // Draw detection point
    radarCtx.fillStyle = 'rgba(255, 0, 0, 0.8)';
    radarCtx.beginPath();
    radarCtx.arc(x, y, 6, 0, Math.PI * 2);
    radarCtx.fill();
    
    // Draw detection pulse animation
    if (detectionState.pulseSize < RADAR_DISPLAY.PULSE_MAX_SIZE) {
        const pulseOpacity = 1 - (detectionState.pulseSize / RADAR_DISPLAY.PULSE_MAX_SIZE);
        
        radarCtx.strokeStyle = `rgba(255, 0, 0, ${pulseOpacity})`;
        radarCtx.lineWidth = 2;
        radarCtx.beginPath();
        radarCtx.arc(x, y, detectionState.pulseSize, 0, Math.PI * 2);
        radarCtx.stroke();
        
        // Increase pulse size for next frame
        detectionState.pulseSize += RADAR_DISPLAY.PULSE_SPEED;
    } else {
        // Reset pulse animation
        resetDetectionPulse();
    }
    
    // Draw detection label
    radarCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    radarCtx.font = '12px Arial';
    radarCtx.textAlign = 'center';
    radarCtx.fillText(
        `${distance}cm @ ${angle}°`,
        x,
        y - 15
    );
}

// Reset detection pulse animation
function resetDetectionPulse() {
    detectionState.pulseSize = 0;
}

// Draw waiting screen (no data available)
function drawWaitingScreen() {
    if (!radarCtx || !radarCanvas) return;
    
    // Clear canvas
    radarCtx.clearRect(0, 0, radarCanvas.width, radarCanvas.height);
    
    // Calculate radar center and radius
    const centerX = radarCanvas.width / 2;
    const centerY = radarCanvas.height;
    const radius = Math.min(radarCanvas.width, radarCanvas.height * 2) * 0.9;
    
    // Draw the background
    drawRadarBackground(centerX, centerY, radius);
    
    // Draw range rings
    drawRangeRings(centerX, centerY, radius);
    
    // Draw angle indicators
    drawAngleIndicators(centerX, centerY, radius);
    
    // Draw waiting message
    radarCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    radarCtx.font = '18px Arial';
    radarCtx.textAlign = 'center';
    radarCtx.fillText(
        'Waiting for radar data...',
        centerX,
        centerY - radius / 2
    );
} 