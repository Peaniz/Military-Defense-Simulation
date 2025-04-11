# Web Radar & Object Tracking System

Web application for radar and object tracking system. Converted from the original Pygame application to a web interface using FastAPI, WebSockets, and HTML/CSS/JavaScript.

## Features

- **Radar Mode**: Display data from Arduino radar
- **Tracking Mode**: Track faces or hands using MediaPipe
- **Web Interface**: Modern interface with Bootstrap
- **Real-time Display**: Uses WebSockets for data updates

## Requirements

- Python 3.7 or higher
- Arduino connected with ultrasonic sensor
- Webcam (for tracking mode)

## Installation

1. Install the required libraries:

```bash
pip install -r requirements.txt
```

2. Connect Arduino to your computer and update the COM port in `app.py` (default is `COM5`).

3. Run the application:

```bash
cd web_radar_app
python app.py
```

4. Access the application at: http://localhost:8000

## Usage

### Radar Mode

- Displays data from Arduino radar
- Scans and detects objects around
- Shows angle and distance to objects

### Tracking Mode

- Tracks faces or hands
- Sends coordinates to Arduino to control servos
- Displays camera video with object markers

### Controls

- **Radar Mode** button: Switch to radar mode
- **Tracking Mode** button: Switch to tracking mode
- **Face Tracking** button: Track faces
- **Hand Tracking** button: Track hands

## Directory Structure

```
web_radar_app/
├── app.py                  # FastAPI backend
├── static/
│   ├── css/
│   │   └── styles.css      # CSS styles
│   └── js/
│       └── radar.js        # JavaScript front-end
└── templates/
    └── index.html          # HTML template
```

## Arduino Connection

The application communicates with Arduino via Serial port:

- In Radar mode, it reads angle and distance data from Arduino
- In Tracking mode, it sends (x,y) coordinates of the tracked object to Arduino
