#!/usr/bin/env python3
"""Face detection helper for the slideshow app's face-aware crop planner.

Uses OpenCV's bundled Haar cascade so no model download is required. Reads
one image path from argv[1] and prints a single JSON line to stdout:

  {"width": W, "height": H, "faces": [{"x":.., "y":.., "w":.., "h":..}, ...]}

On any failure (missing opencv-python, unreadable file, etc.) prints
{"error": "..."} and exits with a non-zero status. Callers must treat that
as "no face information available" and fall back to a center crop -- a
missing Python/OpenCV install is expected on many machines and must never
abort the slideshow pipeline.
"""
import json
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"error": "usage: face_detect.py <image_path>"}))
        return 1

    image_path = sys.argv[1]

    try:
        import cv2
    except ImportError as exc:
        print(json.dumps({"error": f"opencv not available: {exc}"}))
        return 1

    image = cv2.imread(image_path)
    if image is None:
        print(json.dumps({"error": f"could not read image: {image_path}"}))
        return 1

    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    cascade = cv2.CascadeClassifier(cascade_path)
    if cascade.empty():
        print(json.dumps({"error": "failed to load haar cascade"}))
        return 1

    detections = cascade.detectMultiScale(
        gray, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40)
    )

    faces = [
        {"x": int(x), "y": int(y), "w": int(w), "h": int(h)}
        for (x, y, w, h) in detections
    ]

    print(json.dumps({"width": int(width), "height": int(height), "faces": faces}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
