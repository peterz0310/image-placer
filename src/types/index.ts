export interface Transform {
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  skewX?: number;
  skewY?: number;
  // Normalized scale values relative to base image dimensions
  // These ensure consistent visual scaling regardless of overlay image size
  normalizedScaleX?: number; // Rendered width as fraction of base image width
  normalizedScaleY?: number; // Rendered height as fraction of base image height
}

export interface Mask {
  enabled: boolean;
  visible: boolean;
  path: [number, number][];
  feather: number;
  // 0-1 smoothing strength applied to mask polygon (Catmull-Rom spline)
  smoothing?: number;
  // Normalized offset (0..1 of base width/height); positive x moves right, positive y moves down
  offset?: { x: number; y: number };
  // Original editor control points before smoothing/offset baking (stored for rehydration on import)
  editorPath?: [number, number][];
  editorSmoothing?: number;
  editorOffset?: { x: number; y: number };
}

export interface Layer {
  id: string;
  name: string;
  tag?: string;
  transform: Transform;
  mask: Mask;
  opacity: number;
  visible: boolean;
  locked: boolean;
  imageData?: string;
  originalFile?: File;
}

export interface BaseImage {
  name: string;
  width: number;
  height: number;
  imageData?: string;
  originalFile?: File;
}

export interface Project {
  version: number;
  base: BaseImage;
  layers: Layer[];
  metadata?: {
    created: string;
    modified: string;
    author?: string;
  };
}

export interface CanvasState {
  zoom: number;
  pan: { x: number; y: number };
  selectedLayerId?: string;
  tool: "select" | "mask";
  transformMode: "normal" | "skew";
}

export interface ExportOptions {
  scale: number;
  format: "png" | "jpeg";
  quality: number;
  includeOriginalAssets: boolean;
}
