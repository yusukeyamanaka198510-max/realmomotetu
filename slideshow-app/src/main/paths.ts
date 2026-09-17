import { app } from 'electron'
import { join } from 'node:path'
import { defaultPythonPath, type FaceDetectOptions } from './pipeline/faceDetector'

export function resolveFaceDetectionOptions(): FaceDetectOptions {
  const scriptPath = app.isPackaged
    ? join(process.resourcesPath, 'python', 'face_detect.py')
    : join(app.getAppPath(), 'python', 'face_detect.py')
  return {
    pythonPath: process.env.PYTHON_PATH ?? defaultPythonPath(),
    scriptPath
  }
}
