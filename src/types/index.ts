export interface Transform {
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  skewX?: number;
  skewY?: number;
}

export interface QuadWarp {
  enabled: boolean;
  points: [number, number][];
}

export interface Mask {
  enabled: boolean;
  visible: boolean;
  path: [number, number][];
  feather: number;
}

export interface Layer {
  id: string;
  name: string;
  transform: Transform;
  quad: QuadWarp;
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
