"""
Video Streaming Utilities
Handles video capture, frame processing, and MJPEG encoding.
"""

import os
import sys
import cv2
import threading
import time
from typing import Generator, Optional, Tuple
import numpy as np

# Add parent directory to path for imports
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

from detector import get_detector


class VideoStream:
    """Thread-safe video stream handler with YOLOv5 detection."""

    def __init__(self, source: int = 0, model_path: str = "vision/models/best.pt"):
        """
        Initialize video stream.

        Args:
            source: Video source (0 for webcam, or RTSP URL string)
            model_path: Path to YOLOv5 model weights
        """
        self.source = source
        self.detector = get_detector(model_path)
        self.cap: Optional[cv2.VideoCapture] = None
        self.lock = threading.Lock()
        self.running = False
        self.latest_frame: Optional[np.ndarray] = None
        self.latest_detections = {"count": 0, "avg_confidence": 0.0}
        self.frame_lock = threading.Lock()

        # Detection thread
        self.detection_thread: Optional[threading.Thread] = None

        # Initialize camera
        self._init_camera()

        # Start detection thread
        self.running = True
        self.detection_thread = threading.Thread(
            target=self._detection_loop, daemon=True
        )
        self.detection_thread.start()

    def _init_camera(self):
        """Initialize OpenCV video capture."""
        try:
            self.cap = cv2.VideoCapture(self.source)

            if not self.cap.isOpened():
                raise RuntimeError(f"Failed to open video source: {self.source}")

            # Set optimal parameters for tiny object detection
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            self.cap.set(cv2.CAP_PROP_FPS, 30)
            # Buffer size = 1 to reduce latency
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

            print(f"✓ Video stream initialized: {self.source}")

        except Exception as e:
            raise RuntimeError(f"Error initializing video capture: {str(e)}") from e

    def _detection_loop(self):
        """Background thread for continuous frame detection."""
        while self.running:
            try:
                with self.lock:
                    if self.cap is None or not self.cap.isOpened():
                        break
                    ret, frame = self.cap.read()

                if not ret or frame is None:
                    time.sleep(0.1)
                    continue

                # Perform detection
                detections = self.detector.detect(frame, conf_threshold=0.25)

                # Draw bounding boxes and labels
                annotated_frame = self._draw_detections(frame, detections)

                # Update latest frame and detections
                with self.frame_lock:
                    self.latest_frame = annotated_frame.copy()
                    self.latest_detections = {
                        "count": detections["count"],
                        "avg_confidence": detections["avg_confidence"],
                    }

                # Small delay to prevent overwhelming the system
                time.sleep(0.05)  # ~20 FPS

            except Exception as e:
                print(f"Error in detection loop: {str(e)}")
                time.sleep(0.1)

    def _draw_detections(self, frame: np.ndarray, detections: dict) -> np.ndarray:
        """
        Draw bounding boxes and labels on frame.

        Args:
            frame: Input frame
            detections: Detection dictionary from detector

        Returns:
            Annotated frame
        """
        annotated = frame.copy()
        boxes = detections["boxes"]
        confidences = detections["confidences"]
        class_ids = detections["class_ids"]

        for i, (box, conf, cls_id) in enumerate(zip(boxes, confidences, class_ids)):
            x1, y1, x2, y2 = box

            # Color for fish eggs (green)
            color = (0, 255, 0)

            # Draw bounding box
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)

            # Prepare label
            label = f"Egg {conf:.2f}"
            label_size, _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
            label_y = max(y1 - 10, label_size[1])

            # Draw label background
            cv2.rectangle(
                annotated,
                (x1, label_y - label_size[1] - 5),
                (x1 + label_size[0], label_y + 5),
                color,
                -1,
            )

            # Draw label text
            cv2.putText(
                annotated,
                label,
                (x1, label_y),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (0, 0, 0),
                2,
            )

        # Draw summary info
        count = detections["count"]
        avg_conf = detections["avg_confidence"]
        summary_text = f"Eggs Detected: {count} | Avg Confidence: {avg_conf:.2f}"

        # Background for summary
        (text_width, text_height), _ = cv2.getTextSize(
            summary_text, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2
        )
        cv2.rectangle(
            annotated,
            (10, 10),
            (10 + text_width + 10, 10 + text_height + 10),
            (0, 0, 0),
            -1,
        )

        # Summary text
        cv2.putText(
            annotated,
            summary_text,
            (15, 10 + text_height + 5),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (0, 255, 0),
            2,
        )

        # Show warning when no eggs are detected
        if count == 0:
            warning_text = "Uncertain object"
            (warn_width, warn_height), _ = cv2.getTextSize(
                warning_text, cv2.FONT_HERSHEY_SIMPLEX, 1.0, 2
            )
            # Center the warning text
            frame_height, frame_width = annotated.shape[:2]
            warn_x = (frame_width - warn_width) // 2
            warn_y = (frame_height + warn_height) // 2

            # Background for warning (orange/yellow)
            cv2.rectangle(
                annotated,
                (warn_x - 10, warn_y - warn_height - 10),
                (warn_x + warn_width + 10, warn_y + 10),
                (0, 165, 255),  # Orange background
                -1,
            )

            # Warning text
            cv2.putText(
                annotated,
                warning_text,
                (warn_x, warn_y),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.0,
                (0, 0, 0),  # Black text
                2,
            )

        return annotated

    def get_frame(self) -> Optional[np.ndarray]:
        """Get the latest annotated frame (thread-safe)."""
        with self.frame_lock:
            return self.latest_frame.copy() if self.latest_frame is not None else None

    def get_detections(self) -> dict:
        """Get the latest detection statistics (thread-safe)."""
        with self.frame_lock:
            return self.latest_detections.copy()

    def generate_frames(self) -> Generator[bytes, None, None]:
        """
        Generator function that yields MJPEG frames.
        Used by Flask for streaming.

        Yields:
            JPEG-encoded frame bytes
        """
        while self.running:
            frame = self.get_frame()

            if frame is not None:
                # Encode frame as JPEG
                ret, buffer = cv2.imencode(
                    ".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75]
                )

                if ret:
                    frame_bytes = buffer.tobytes()
                    yield (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
                    )
            else:
                # No frame available, wait a bit
                time.sleep(0.05)

    def release(self):
        """Release video capture resources."""
        self.running = False

        if self.detection_thread and self.detection_thread.is_alive():
            self.detection_thread.join(timeout=2.0)

        with self.lock:
            if self.cap is not None:
                self.cap.release()
                self.cap = None

        print("✓ Video stream released")


# Global stream instance
_stream: Optional[VideoStream] = None
_stream_lock = threading.Lock()


def get_stream(
    source: int = 0, model_path: str = "vision/models/best.pt"
) -> VideoStream:
    """
    Get or create the global stream instance (singleton pattern).

    Args:
        source: Video source (0 for webcam, or RTSP URL)
        model_path: Path to YOLOv5 model weights

    Returns:
        VideoStream instance
    """
    global _stream

    if _stream is None:
        with _stream_lock:
            if _stream is None:
                _stream = VideoStream(source, model_path)

    return _stream
