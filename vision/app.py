"""
Flask-based YOLOv5 Vision Service
Provides MJPEG video streaming and detection API endpoints.
"""

import os
import sys
import time
from datetime import datetime
from flask import Flask, Response, jsonify, render_template
from flask_cors import CORS
import threading
import pathlib
import platform

# 🔥 FIX PosixPath loading on Windows
if platform.system() == "Windows":
    pathlib.PosixPath = pathlib.WindowsPath


# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from detector import get_detector
from stream import get_stream


app = Flask(__name__)

# Enable CORS for all routes
CORS(app, origins=["http://localhost:3000", "http://127.0.0.1:3000"])

# Configuration
# Model path relative to vision/ directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "models", "best.pt")  # Always use models/best.pt relative to vision/
VIDEO_SOURCE = 2  # 2 for USB2.0 PC CAMERA, 0 for default webcam, or RTSP URL string like "rtsp://..."

# Global instances (will be initialized on startup)
_detector = None
_stream = None


def init_service():
    """Initialize the vision service (detector and stream)."""
    global _detector, _stream
    
    if _detector is not None or _stream is not None:
        # Already initialized
        return
    
    try:
        print("=" * 60)
        print("Initializing Smart Hatchery Vision Service")
        print("=" * 60)
        
        # Check if model file exists
        model_path = os.path.abspath(MODEL_PATH)
        if not os.path.exists(model_path):
            error_msg = (
                f"\n{'=' * 60}\n"
                f"ERROR: Model file not found!\n"
                f"Expected path: {model_path}\n"
                f"\nPlease provide the best.pt model file in the models/ directory.\n"
                f"{'=' * 60}\n"
            )
            print(error_msg)
            sys.exit(1)
        
        # Initialize detector
        print(f"Loading YOLOv5 model from: {model_path}")
        _detector = get_detector(model_path)
        print("✓ Detector initialized successfully")
        
        # Initialize video stream
        print(f"Initializing video stream from source: {VIDEO_SOURCE}")
        _stream = get_stream(VIDEO_SOURCE, model_path)
        print("✓ Video stream initialized successfully")
        
        print("=" * 60)
        print("Vision Service Ready!")
        print(f"Video Feed: http://localhost:5000/video_feed")
        print(f"Detections API: http://localhost:5000/detections")
        print("=" * 60)
        
    except FileNotFoundError as e:
        print(f"\n{'=' * 60}")
        print(f"FATAL ERROR: {str(e)}")
        print(f"{'=' * 60}\n")
        sys.exit(1)
    except Exception as e:
        print(f"\n{'=' * 60}")
        print(f"FATAL ERROR during initialization: {str(e)}")
        print(f"{'=' * 60}\n")
        sys.exit(1)


@app.route('/')
def index():
    """Root endpoint - service information."""
    return jsonify({
        "service": "Smart Hatchery Vision Service",
        "status": "running",
        "endpoints": {
            "video_feed": "/video_feed",
            "detections": "/detections"
        },
        "model_loaded": _detector is not None,
        "stream_active": _stream is not None
    })


@app.route('/video_feed')
def video_feed():
    """
    MJPEG video streaming endpoint.
    Streams live annotated video with YOLOv5 detections.
    
    Usage:
        <img src="http://localhost:5000/video_feed">
    """
    if _stream is None:
        return jsonify({"error": "Video stream not initialized"}), 500
    
    return Response(
        _stream.generate_frames(),
        mimetype='multipart/x-mixed-replace; boundary=frame'
    )


@app.route('/detections')
def detections():
    """
    Detection statistics endpoint.
    Returns JSON with current detection counts and statistics.
    
    Returns:
        JSON: {
            "eggs_detected": int,
            "confidence_avg": float,
            "timestamp": "ISO-8601 string"
        }
    """
    if _stream is None:
        return jsonify({
            "eggs_detected": 0,
            "confidence_avg": 0.0,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "error": "Video stream not initialized"
        }), 500
    
    try:
        # Get latest detections from stream
        detection_data = _stream.get_detections()
        
        return jsonify({
            "eggs_detected": detection_data.get('count', 0),
            "confidence_avg": round(detection_data.get('avg_confidence', 0.0), 4),
            "timestamp": datetime.utcnow().isoformat() + "Z"
        })
        
    except Exception as e:
        return jsonify({
            "eggs_detected": 0,
            "confidence_avg": 0.0,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "error": str(e)
        }), 500


@app.route('/health')
def health():
    """Health check endpoint."""
    return jsonify({
        "status": "healthy",
        "detector_loaded": _detector is not None,
        "stream_active": _stream is not None
    })


@app.route('/egg_count')
def egg_count():
    """Return current egg count for frontend averaging."""
    if _stream is None:
        return jsonify({
            "eggCount": 0,
            "frameId": 0,
            "timestamp": int(time.time() * 1000)
        })
    
    try:
        # Get latest detections from stream
        detection_data = _stream.get_detections()
        
        return jsonify({
            "eggCount": detection_data.get('count', 0),
            "frameId": int(time.time() * 1000),  # Simple frame ID using timestamp
            "timestamp": int(time.time() * 1000)
        })
        
    except Exception as e:
        return jsonify({
            "eggCount": 0,
            "frameId": 0,
            "timestamp": int(time.time() * 1000),
            "error": str(e)
        }), 500


if __name__ == '__main__':
    # Initialize service before starting Flask
    init_service()
    
    # Start Flask server
    print("\nStarting Flask server on http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)

