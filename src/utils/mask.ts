import { Layer } from "@/types";

export class MaskRenderer {
  /**
   * Creates a mask canvas from a polygon path with optional feathering
   */
  static createMaskCanvas(
    path: [number, number][],
    width: number,
    height: number,
    feather: number = 0,
    smoothing: number = 0,
    offset?: { x: number; y: number }
  ): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    canvas.width = width;
    canvas.height = height;

    if (path.length < 3) {
      // Return empty mask if path is invalid
      return canvas;
    }

    // Convert normalized coordinates to canvas coordinates with optional offset
    const dx = (offset?.x || 0) * width;
    const dy = (offset?.y || 0) * height;
    const points = path.map(([x, y]) => [x * width + dx, y * height + dy]);

    // Optionally smooth the polygon path
    const smoothStrength = Math.max(0, Math.min(1, smoothing || 0));
    if (smoothStrength > 0 && points.length >= 3) {
      this.drawSmoothedClosedPath(ctx, points, smoothStrength);
    } else {
      // Draw the mask shape (straight edges)
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0], points[i][1]);
      }
      ctx.closePath();
      ctx.fill();
    }

    // Apply feathering if specified
    if (feather > 0) {
      return this.applyFeather(canvas, feather);
    }

    return canvas;
  }

  /**
   * Generates a baked (densified) polygon path with smoothing and optional offset applied.
   * Returns normalized coordinates (still 0..1-based), but may extend beyond 0..1 if offset pushes it.
   * This is intended for JSON export so consumers don't need to re-apply smoothing/offset.
   */
  static bakeSmoothedPath(
    normPath: [number, number][],
    smoothing: number = 0,
    offset?: { x: number; y: number },
    samplesPerSegment?: number
  ): [number, number][] {
    if (!normPath || normPath.length < 3) return normPath;

    const s = Math.max(0, Math.min(1, smoothing || 0));
    const offX = offset?.x || 0;
    const offY = offset?.y || 0;

    // If no smoothing, just apply offset and return
    if (s <= 0) {
      return normPath.map(([x, y]) => [x + offX, y + offY]);
    }

    const points = normPath; // normalized space
    const n = points.length;
    const tension = 0.5 * s;
    const get = (i: number) => points[(i + n) % n];

    // Determine sampling density: more smoothing -> more points
    const samples = Math.max(2, samplesPerSegment ?? Math.round(4 + s * 12));

    const out: [number, number][] = [];

    // Cubic Bezier evaluation helper
    const evalBezier = (
      p0x: number,
      p0y: number,
      c1x: number,
      c1y: number,
      c2x: number,
      c2y: number,
      p3x: number,
      p3y: number,
      t: number
    ) => {
      const mt = 1 - t;
      const mt2 = mt * mt;
      const t2 = t * t;
      const a = mt2 * mt; // (1-t)^3
      const b = 3 * mt2 * t; // 3(1-t)^2 t
      const c = 3 * mt * t2; // 3(1-t) t^2
      const d = t * t2; // t^3
      return [
        a * p0x + b * c1x + c * c2x + d * p3x,
        a * p0y + b * c1y + c * c2y + d * p3y,
      ] as [number, number];
    };

    for (let i = 0; i < n; i++) {
      const p0 = get(i - 1);
      const p1 = get(i);
      const p2 = get(i + 1);
      const p3 = get(i + 2);

      // Control points for segment p1 -> p2
      const cp1x = p1[0] + ((p2[0] - p0[0]) / 6) * (tension * 2);
      const cp1y = p1[1] + ((p2[1] - p0[1]) / 6) * (tension * 2);
      const cp2x = p2[0] - ((p3[0] - p1[0]) / 6) * (tension * 2);
      const cp2y = p2[1] - ((p3[1] - p1[1]) / 6) * (tension * 2);

      // Sample along the curve, excluding t=1 to avoid duplicate of next vertex
      for (let sIdx = 0; sIdx < samples; sIdx++) {
        const t = sIdx / samples;
        const [x, y] = evalBezier(
          p1[0],
          p1[1],
          cp1x,
          cp1y,
          cp2x,
          cp2y,
          p2[0],
          p2[1],
          t
        );
        out.push([x + offX, y + offY]);
      }
    }

    return out;
  }

  /**
   * Draw a smoothed closed path using Catmull-Rom spline converted to Bezier curves
   * smoothStrength: 0..1 controls how rounded the corners are
   */
  private static drawSmoothedClosedPath(
    ctx: CanvasRenderingContext2D,
    points: number[][],
    smoothStrength: number
  ) {
    const n = points.length;
    const tension = 0.5 * smoothStrength; // scale to a reasonable range

    ctx.fillStyle = "white";
    ctx.beginPath();

    // Helper to get wrapped point
    const get = (i: number) => points[(i + n) % n];

    const p0 = get(-1);
    const p1 = get(0);
    const p2 = get(1);
    const p3 = get(2);

    ctx.moveTo(p1[0], p1[1]);

    for (let i = 0; i < n; i++) {
      const p0 = get(i - 1);
      const p1 = get(i);
      const p2 = get(i + 1);
      const p3 = get(i + 2);

      // Catmull-Rom to Bezier control points
      const cp1x = p1[0] + ((p2[0] - p0[0]) / 6) * (tension * 2);
      const cp1y = p1[1] + ((p2[1] - p0[1]) / 6) * (tension * 2);
      const cp2x = p2[0] - ((p3[0] - p1[0]) / 6) * (tension * 2);
      const cp2y = p2[1] - ((p3[1] - p1[1]) / 6) * (tension * 2);

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
    }

    ctx.closePath();
    ctx.fill();
  }

  /**
   * Returns an SVG path "d" string for a smoothed closed path using Catmull-Rom splines.
   * The input points are in absolute coordinates.
   */
  static toSmoothedClosedPathD(points: number[][], smoothing: number): string {
    const n = points.length;
    if (n < 3 || (smoothing ?? 0) <= 0) {
      // Fallback to polygon path
      const move = `M ${points[0][0]} ${points[0][1]}`;
      const lines = points
        .slice(1)
        .map((p) => `L ${p[0]} ${p[1]}`)
        .join(" ");
      return `${move} ${lines} Z`;
    }

    const tension = 0.5 * Math.max(0, Math.min(1, smoothing));
    const get = (i: number) => points[(i + n) % n];

    let d = `M ${points[0][0]} ${points[0][1]}`;
    for (let i = 0; i < n; i++) {
      const p0 = get(i - 1);
      const p1 = get(i);
      const p2 = get(i + 1);
      const p3 = get(i + 2);

      const cp1x = p1[0] + ((p2[0] - p0[0]) / 6) * (tension * 2);
      const cp1y = p1[1] + ((p2[1] - p0[1]) / 6) * (tension * 2);
      const cp2x = p2[0] - ((p3[0] - p1[0]) / 6) * (tension * 2);
      const cp2y = p2[1] - ((p3[1] - p1[1]) / 6) * (tension * 2);

      d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2[0]} ${p2[1]}`;
    }

    d += " Z";
    return d;
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
      layer.mask.feather,
      layer.mask.smoothing ?? 0,
      layer.mask.offset
    );

    return maskCanvas.toDataURL("image/png");
  }
}
