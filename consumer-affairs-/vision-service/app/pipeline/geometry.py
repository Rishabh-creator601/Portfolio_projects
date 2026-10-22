"""De-skew and perspective correction.

Classical CV, no model: findContours for the label quadrilateral, then
warpPerspective onto a fronto-parallel plane. This has to run *before*
calibration, because a scale factor measured on a tilted label is wrong by the
cosine of the tilt in one axis and right in the other.
"""

from __future__ import annotations

import cv2
import numpy as np


def _order_corners(pts: np.ndarray) -> np.ndarray:
    """Order four points as top-left, top-right, bottom-right, bottom-left."""
    ordered = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1)

    ordered[0] = pts[np.argmin(s)]      # top-left has the smallest x+y
    ordered[2] = pts[np.argmax(s)]      # bottom-right the largest
    ordered[1] = pts[np.argmin(diff)]   # top-right the smallest y-x
    ordered[3] = pts[np.argmax(diff)]
    return ordered


def find_label_quad(image: np.ndarray, min_area_ratio: float = 0.2) -> np.ndarray | None:
    """Largest four-sided contour that plausibly bounds the label.

    Returns None when no clean quadrilateral is found, which is the common case
    for a pouch or a bottle -- the caller then treats the image as uncorrected
    rather than warping it into a worse shape.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)

    # Close small gaps so a broken label border still forms one contour.
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    image_area = float(image.shape[0] * image.shape[1])

    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
        area = cv2.contourArea(contour)
        if area < image_area * min_area_ratio:
            break

        peri = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
        if len(approx) == 4:
            return _order_corners(approx.reshape(4, 2).astype("float32"))

    return None


def warp_to_front(image: np.ndarray, quad: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Warp the quadrilateral to a rectangle, returning the image and matrix."""
    tl, tr, br, bl = quad

    width = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
    height = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
    width, height = max(width, 1), max(height, 1)

    destination = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype="float32"
    )

    matrix = cv2.getPerspectiveTransform(quad, destination)
    return cv2.warpPerspective(image, matrix, (width, height)), matrix


def correct_perspective(image: np.ndarray) -> tuple[np.ndarray, bool, np.ndarray | None]:
    """Best-effort rectification, falling back to a plain de-skew.

    Returns (image, was_corrected, matrix). A full perspective warp needs a
    label quadrilateral; pouches and bottles rarely offer one, so when no quad
    is found the residual in-plane rotation is taken out instead. That is a
    weaker correction -- it cannot undo foreshortening -- so it still reports
    ``was_corrected=False`` and downgrades everything measured afterwards.
    """
    quad = find_label_quad(image)

    if quad is not None:
        warped, matrix = warp_to_front(image, quad)
        # A warp that collapses the image is worse than no warp at all.
        if warped.shape[0] >= 32 and warped.shape[1] >= 32:
            return warped, True, matrix

    angle = estimate_skew_angle(image)
    if abs(angle) >= MIN_CORRECTABLE_SKEW_DEG:
        return rotate(image, angle), False, None

    return image, False, None


def estimate_skew_angle(gray: np.ndarray) -> float:
    """Residual in-plane rotation in degrees, from the dominant straight edges.

    Thresholds scale with the image so this works on a 600px crop and a 4000px
    capture alike; a fixed 60px minimum line length finds nothing on the former
    and everything on the latter.
    """
    if gray.ndim == 3:
        gray = cv2.cvtColor(gray, cv2.COLOR_BGR2GRAY)

    height, width = gray.shape[:2]
    longest_edge = max(height, width)

    # A shallow Canny catches the label border even against a similar backdrop.
    edges = cv2.Canny(gray, 30, 110)

    min_length = max(30, int(longest_edge * 0.15))
    threshold = max(40, int(longest_edge * 0.08))

    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 360,
        threshold=threshold,
        minLineLength=min_length,
        maxLineGap=max(5, int(longest_edge * 0.01)),
    )
    if lines is None:
        return 0.0

    angles: list[float] = []
    # OpenCV 4 returns (N, 1, 4) and OpenCV 5 returns (N, 4); normalise both.
    for x1, y1, x2, y2 in np.asarray(lines).reshape(-1, 4):
        angle = np.degrees(np.arctan2(float(y2 - y1), float(x2 - x1)))

        # Fold vertical edges onto the horizontal so a label border contributes
        # both of its axes to the same estimate.
        if angle < -45:
            angle += 90
        elif angle > 45:
            angle -= 90

        if -30 < angle < 30:
            angles.append(angle)

    return float(np.median(angles)) if angles else 0.0


# Below this, rotating costs an interpolation pass and buys nothing.
MIN_CORRECTABLE_SKEW_DEG = 0.75


def rotate(image: np.ndarray, angle: float) -> np.ndarray:
    """Rotate about the centre, expanding the canvas so nothing is clipped."""
    if abs(angle) < 0.1:
        return image

    height, width = image.shape[:2]
    centre = (width / 2, height / 2)
    matrix = cv2.getRotationMatrix2D(centre, angle, 1.0)

    cos, sin = abs(matrix[0, 0]), abs(matrix[0, 1])
    new_width = int(height * sin + width * cos)
    new_height = int(height * cos + width * sin)
    matrix[0, 2] += new_width / 2 - centre[0]
    matrix[1, 2] += new_height / 2 - centre[1]

    return cv2.warpAffine(
        image, matrix, (new_width, new_height), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255)
    )
