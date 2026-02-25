"""
YOLOv5 Detector Module
Handles model loading and inference for fish egg detection.
Thread-safe and optimized for real-time processing.
Uses local YOLOv5 repository.
"""

import os
import sys
import torch
import numpy as np
from pathlib import Path
from typing import List, Tuple, Dict, Optional
import threading
import pathlib
import platform

if platform.system() == "Windows":
    pathlib.PosixPath = pathlib.WindowsPath


# Add yolov5 directory to path for imports
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
YOLOV5_DIR = os.path.join(BASE_DIR, "yolov5")
sys.path.insert(0, YOLOV5_DIR)

# Import YOLOv5 utilities (relative to yolov5 directory)
from models.experimental import attempt_load
from utils.general import non_max_suppression, scale_boxes
from utils.torch_utils import select_device
from utils.augmentations import letterbox


class YOLODetector:
    """Thread-safe YOLOv5 detector for fish egg detection."""

    def __init__(self, model_path: str = "vision/models/best.pt"):
        """
        Initialize the YOLOv5 detector.

        Args:
            model_path: Path to the YOLOv5 model weights file

        Raises:
            FileNotFoundError: If the model file does not exist
            RuntimeError: If model loading fails
        """
        # Convert to absolute path
        model_path = os.path.abspath(model_path)

        # Check if model file exists
        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"Model file not found: {model_path}\n"
                f"Please provide the best.pt model file in the models/ directory."
            )

        self.model_path = model_path
        self.model = None
        self.device = select_device("")  # Auto-select device
        self.lock = threading.Lock()
        self.img_size = 640
        self.conf_threshold = 0.25
        self.iou_threshold = 0.45

        # Load model once at initialization
        self._load_model()

    def _load_model(self):
        """Load YOLOv5 model from the specified path using local repository."""
        try:
            with self.lock:
                # Load model using attempt_load from local YOLOv5 repo
                self.model = attempt_load(
                    self.model_path, device=self.device, inplace=False, fuse=True
                )
                self.model.eval()  # Set to evaluation mode

                # Get model stride and names
                self.stride = int(self.model.stride.max())
                self.names = (
                    self.model.module.names
                    if hasattr(self.model, "module")
                    else self.model.names
                )

                print(f"✓ YOLOv5 model loaded successfully from {self.model_path}")
                print(f"✓ Using device: {self.device}")
                print(f"✓ Model classes: {self.names}")

        except Exception as e:
            raise RuntimeError(
                f"Failed to load YOLOv5 model from {self.model_path}: {str(e)}\n"
                f"Please ensure the model file is valid and YOLOv5 repository is properly set up."
            ) from e

    def detect(self, frame: np.ndarray, conf_threshold: float = 0.25) -> Dict:
        """
        Perform object detection on a single frame.

        Args:
            frame: Input frame as numpy array (BGR format from OpenCV)
            conf_threshold: Confidence threshold for detections (default: 0.25)

        Returns:
            Dictionary containing:
                - boxes: List of bounding boxes [(x1, y1, x2, y2), ...]
                - confidences: List of confidence scores [0.0-1.0, ...]
                - class_ids: List of class IDs
                - count: Total number of detections
                - avg_confidence: Average confidence score
        """
        if self.model is None:
            raise RuntimeError("Model not loaded. Cannot perform detection.")

        try:
            with self.lock:
                # Preprocess image
                img = letterbox(frame, self.img_size, stride=self.stride, auto=True)[0]
                img = img.transpose((2, 0, 1))[::-1]  # HWC to CHW, BGR to RGB
                img = np.ascontiguousarray(img)
                img = torch.from_numpy(img).to(self.device)
                img = img.float() / 255.0  # 0 - 255 to 0.0 - 1.0
                if len(img.shape) == 3:
                    img = img[None]  # expand for batch dim

                # Run inference
                pred = self.model(img, augment=False, visualize=False)[0]

                # Apply NMS
                pred = non_max_suppression(
                    pred,
                    conf_threshold,
                    self.iou_threshold,
                    classes=None,
                    agnostic=False,
                    max_det=1000,
                )

                boxes = []
                confidences = []
                class_ids = []

                # Process detections
                for det in pred:
                    if len(det):
                        # Rescale boxes from img_size to frame size
                        det[:, :4] = scale_boxes(
                            img.shape[2:], det[:, :4], frame.shape
                        ).round()

                        # Extract boxes, confidences, class_ids
                        for *xyxy, conf, cls in reversed(det):
                            x1, y1, x2, y2 = map(int, xyxy)
                            boxes.append([x1, y1, x2, y2])
                            confidences.append(float(conf))
                            class_ids.append(int(cls))

                # Calculate statistics
                count = len(boxes)
                avg_confidence = np.mean(confidences) if confidences else 0.0

                return {
                    "boxes": boxes,
                    "confidences": confidences,
                    "class_ids": class_ids,
                    "count": count,
                    "avg_confidence": avg_confidence,
                }

        except Exception as e:
            print(f"Error during detection: {str(e)}")
            return {
                "boxes": [],
                "confidences": [],
                "class_ids": [],
                "count": 0,
                "avg_confidence": 0.0,
            }

    def get_model_info(self) -> Dict:
        """Get information about the loaded model."""
        return {
            "model_path": self.model_path,
            "device": str(self.device),
            "model_loaded": self.model is not None,
            "names": self.names if self.model is not None else [],
        }


# Global detector instance (will be initialized by app.py)
_detector: Optional[YOLODetector] = None
_detector_lock = threading.Lock()


def get_detector(model_path: str = "vision/models/best.pt") -> YOLODetector:
    """
    Get or create the global detector instance (singleton pattern).
    Thread-safe initialization.

    Args:
        model_path: Path to the YOLOv5 model weights file

    Returns:
        YOLODetector instance
    """
    global _detector

    if _detector is None:
        with _detector_lock:
            if _detector is None:
                _detector = YOLODetector(model_path)

    return _detector
