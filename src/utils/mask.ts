import { Layer } from "@/types";

export class MaskRenderer {
  /**
   * Creates a mask canvas from a polygon path with optional feathering
   */
  static createMaskCanvas(
    path: [number, number][],
    width: number,
    height: number,
    feather: number = 0
  ): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    canvas.width = width;
    canvas.height = height;

    if (path.length < 3) {
      // Return empty mask if path is invalid
      return canvas;
    }

    // Convert normalized coordinates to canvas coordinates
    const points = path.map(([x, y]) => [x * width, y * height]);

    // Draw the mask shape
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);

    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }

    ctx.closePath();
    ctx.fill();

    // Apply feathering if specified
    if (feather > 0) {
      return this.applyFeather(canvas, feather);
    }

    return canvas;
  }

  /**
   * Applies Gaussian blur to a mask for feathering effect
   */
  private static applyFeather(
    canvas: HTMLCanvasElement,
    feather: number
  ): HTMLCanvasElement {
    const ctx = canvas.getContext("2d")!;

    // Create temporary canvas for blur effect
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d")!;
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;

    // Copy original mask
    tempCtx.drawImage(canvas, 0, 0);

    // Apply blur filter
    ctx.filter = `blur(${feather}px)`;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tempCanvas, 0, 0);
    ctx.filter = "none";

    return canvas;
  }

  /**
   * Applies a mask to an image on a canvas context
   */
  static applyMaskToImage(
    ctx: CanvasRenderingContext2D,
    image: HTMLImageElement | HTMLCanvasElement,
    mask: HTMLCanvasElement,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    // Create temporary canvas for masking operation
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d")!;
    tempCanvas.width = width;
    tempCanvas.height = height;

    // Draw the image
    tempCtx.drawImage(image, 0, 0, width, height);

    // Use mask as alpha channel
    tempCtx.globalCompositeOperation = "destination-in";
    tempCtx.drawImage(mask, 0, 0, width, height);

    // Draw the masked result to the main context
    ctx.drawImage(tempCanvas, x, y);
  }

  /**
   * Checks if a point is inside a polygon using ray casting algorithm
   */
  static isPointInPolygon(
    point: [number, number],
    polygon: [number, number][]
  ): boolean {
    const [x, y] = point;
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];

      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }

    return inside;
  }

  /**
   * Creates an image mask data URL from a layer's mask configuration
   */
  static async createMaskDataURL(
    layer: Layer,
    width: number,
    height: number
  ): Promise<string> {
    if (!layer.mask.enabled || layer.mask.path.length < 3) {
      return "";
    }

    const maskCanvas = this.createMaskCanvas(
      layer.mask.path,
      width,
      height,
      layer.mask.feather
    );

    return maskCanvas.toDataURL("image/png");
  }
}
