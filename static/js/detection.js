/**
 * Web Radar and Object Tracking System - Detection Module
 * Handles object detection visualization and popup
 */

// Detection Pulse Animation
let detectionPulseSize = 0;
let detectionPulseFadeOut = 0;
let detectionPulseGrowing = true;

// Reset detection pulse animation
function resetDetectionPulse() {
    detectionPulseSize = 0;
    detectionPulseFadeOut = 0;
    detectionPulseGrowing = true;
    
    // Additionally, play detection alert sound
    playDetectionAlert();
}

// Draw the object detection popup (returns true if popup was drawn)
function drawDetectionPopup(centerX, centerY, width) {
    // Check if we have a detected object or need to keep popup visible
    if (detectionState.detectedObject || detectionState.keepPopupVisible) {
        // Convert angle to radians for drawing
        const rad = detectionState.detectedAngle * Math.PI / 180;
        const distance = detectionState.detectedDistance;
        
        // Calculate the point on the line where the object was detected
        const scaleFactor = width * 0.4 / 100;  // Scale to match the radar display
        const objX = centerX + distance * scaleFactor * Math.cos(rad);
        const objY = centerY - distance * scaleFactor * Math.sin(rad);
        
        // Draw a line from center to the detection point
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
        radarContext.fillText(`Position: ${detectionState.detectedAngle}°`, centerX, centerY);
        radarContext.fillText(`Distance: ${detectionState.detectedDistance} cm`, centerX, centerY + 25);
        
        // Draw the object point with animation
        detectionState.detectionPulseSize += 0.5;
        if (detectionState.detectionPulseSize > 30) detectionState.detectionPulseSize = 0;
        
        // Draw pulsing circle
        radarContext.beginPath();
        radarContext.arc(objX, objY, 8 + detectionState.detectionPulseSize, 0, 2 * Math.PI);
        radarContext.strokeStyle = `rgba(255, 153, 0, ${1 - detectionState.detectionPulseSize/30})`;
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

// Animates a pulsing circle at the detection point
function animateDetectionPulse(x, y) {
    // Update pulse animation
    if (detectionPulseGrowing) {
        detectionPulseSize += 0.5;
        if (detectionPulseSize >= 30) {
            detectionPulseGrowing = false;
        }
    } else {
        detectionPulseSize -= 0.5;
        if (detectionPulseSize <= 5) {
            detectionPulseGrowing = true;
        }
    }
    
    // Draw outer pulse circle (fading)
    radarContext.beginPath();
    radarContext.arc(x, y, detectionPulseSize, 0, Math.PI * 2);
    radarContext.fillStyle = `rgba(255, 69, 0, ${0.8 - detectionPulseSize/40})`; // Fade out as it grows
    radarContext.fill();
    
    // Draw inner circle (solid)
    radarContext.beginPath();
    radarContext.arc(x, y, 5, 0, Math.PI * 2);
    radarContext.fillStyle = "#ff4500";
    radarContext.fill();
}

// Draw detected object
function drawDetectedObject(centerX, centerY, width) {
    if (detectionState.isObjectDetected) {
        const rad = detectionState.detectedAngle * Math.PI / 180;
        const distance = detectionState.detectedDistance;
        
        // Scale distance for display (adjust this based on your radar's range)
        const scaleFactor = width * 0.005 * distance;  // Scale based on cm distance
        
        // Calculate position
        const objX = centerX + scaleFactor * Math.cos(rad);
        const objY = centerY - scaleFactor * Math.sin(rad);
        
        // Draw the detected object point
        radarContext.beginPath();
        radarContext.arc(objX, objY, 8, 0, 2 * Math.PI);
        radarContext.fillStyle = CONSTANTS.RED;
        radarContext.fill();
        
        // Draw point highlight
        radarContext.beginPath();
        radarContext.arc(objX, objY, 12, 0, 2 * Math.PI);
        radarContext.strokeStyle = CONSTANTS.RED;
        radarContext.lineWidth = 2;
        radarContext.stroke();
        
        // Add object information near the point (small label)
        radarContext.font = "12px Arial";
        radarContext.fillStyle = "#ffffff";
        radarContext.fillText(`${distance.toFixed(1)}cm`, objX + 15, objY - 5);
        radarContext.fillText(`${detectionState.detectedAngle.toFixed(1)}°`, objX + 15, objY + 15);
    }
    
    // Draw recent position history points (fading trail)
    if (window.recentPositions && window.recentPositions.length > 0) {
        for (let i = 0; i < window.recentPositions.length; i++) {
            const pos = window.recentPositions[i];
            const age = (Date.now() - pos.timestamp) / 1000;  // Age in seconds
            
            // Skip if too old (older than 5 seconds)
            if (age > 5) continue;
            
            // Calculate position
            const posRad = pos.angle * Math.PI / 180;
            const posDistance = pos.distance;
            const scaleFactor = width * 0.005 * posDistance;
            const posX = centerX + scaleFactor * Math.cos(posRad);
            const posY = centerY - scaleFactor * Math.sin(posRad);
            
            // Fade based on age (older = more transparent)
            const opacity = 1.0 - (age / 5);
            const size = 6 - (age / 1);  // Smaller as they age
            
            // Draw history point
            radarContext.beginPath();
            radarContext.arc(posX, posY, Math.max(2, size), 0, 2 * Math.PI);
            radarContext.fillStyle = `rgba(200, 0, 0, ${opacity})`;
            radarContext.fill();
        }
    }
} 