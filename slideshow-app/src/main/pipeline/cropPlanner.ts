export interface FaceBox {
  x: number
  y: number
  w: number
  h: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface CropPlan {
  crop: Rect
  /** Where the face(s) sit within the crop, normalized 0..1. Defaults to
   * the crop's own center (0.5, 0.5) when no faces were detected. Used to
   * bias Ken Burns panning so motion never drifts a face out of frame. */
  faceCenterFrac: { x: number; y: number }
}

/** Computes the largest same-aspect-ratio crop of a source image and
 * positions it so detected faces stay inside the frame. Falls back to a
 * centered crop when no faces are given. */
export function computeCropPlan(
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number,
  faces: FaceBox[] = []
): CropPlan {
  if (srcWidth <= 0 || srcHeight <= 0) {
    throw new Error(`Invalid source dimensions: ${srcWidth}x${srcHeight}`)
  }
  const targetRatio = targetWidth / targetHeight
  const srcRatio = srcWidth / srcHeight

  let cropW: number
  let cropH: number
  if (srcRatio > targetRatio) {
    cropH = srcHeight
    cropW = Math.round(cropH * targetRatio)
  } else {
    cropW = srcWidth
    cropH = Math.round(cropW / targetRatio)
  }
  cropW = Math.min(cropW, srcWidth)
  cropH = Math.min(cropH, srcHeight)

  let x = (srcWidth - cropW) / 2
  let y = (srcHeight - cropH) / 2

  if (faces.length > 0) {
    const union = unionOf(faces)
    const centerX = union.x + union.w / 2
    // Faces look more natural slightly above the crop's vertical center
    // (headroom below the chin), so bias the anchor upward a bit.
    const centerY = union.y + union.h / 2

    x = clamp(centerX - cropW / 2, 0, Math.max(0, srcWidth - cropW))
    y = clamp(centerY - cropH * 0.42, 0, Math.max(0, srcHeight - cropH))
  }

  x = Math.round(clamp(x, 0, Math.max(0, srcWidth - cropW)))
  y = Math.round(clamp(y, 0, Math.max(0, srcHeight - cropH)))

  let faceCenterFrac = { x: 0.5, y: 0.5 }
  if (faces.length > 0) {
    const union = unionOf(faces)
    const fx = (union.x + union.w / 2 - x) / cropW
    const fy = (union.y + union.h / 2 - y) / cropH
    faceCenterFrac = { x: clamp(fx, 0.1, 0.9), y: clamp(fy, 0.1, 0.9) }
  }

  return { crop: { x, y, w: cropW, h: cropH }, faceCenterFrac }
}

function unionOf(boxes: FaceBox[]): Rect {
  const minX = Math.min(...boxes.map((b) => b.x))
  const minY = Math.min(...boxes.map((b) => b.y))
  const maxX = Math.max(...boxes.map((b) => b.x + b.w))
  const maxY = Math.max(...boxes.map((b) => b.y + b.h))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}
