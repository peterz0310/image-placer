import { Project, Layer } from "@/types";
import { MaskRenderer } from "./mask";

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private images: Map<string, HTMLImageElement> = new Map();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
  }

  async loadImage(src: string): Promise<HTMLImageElement> {
    if (this.images.has(src)) {
      return this.images.get(src)!;
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.images.set(src, img);
        resolve(img);
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  async render(project: Project) {
    const { base, layers } = project;

    // Set canvas size based on base image
    const maxDisplayWidth = 800;
    const maxDisplayHeight = 600;

    const scale = Math.min(
      maxDisplayWidth / base.width,
      maxDisplayHeight / base.height,
      1
    );

    this.canvas.width = base.width * scale;
    this.canvas.height = base.height * scale;

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    try {
      // Draw base image
      if (base.imageData) {
        const baseImg = await this.loadImage(base.imageData);
        this.ctx.drawImage(
          baseImg,
          0,
          0,
          this.canvas.width,
          this.canvas.height
        );
      }

      // Draw layers
      for (const layer of layers) {
        if (!layer.visible || !layer.imageData) continue;

        await this.drawLayer(layer, scale);
      }
    } catch (error) {
      console.error("Error rendering canvas:", error);
    }
  }

  private async drawLayer(layer: Layer, scale: number) {
    const img = await this.loadImage(layer.imageData!);
    const { transform, opacity } = layer;

    this.ctx.save();

    // Set opacity
    this.ctx.globalAlpha = opacity;

    // Calculate position and size
    const centerX = transform.left * this.canvas.width;
    const centerY = transform.top * this.canvas.height;

    // Translate to center point
    this.ctx.translate(centerX, centerY);

    // Apply rotation
    this.ctx.rotate((transform.angle * Math.PI) / 180);

    // Apply skew if present
    if (transform.skewX || transform.skewY) {
      this.ctx.transform(
        1,
        Math.tan(((transform.skewY || 0) * Math.PI) / 180),
        Math.tan(((transform.skewX || 0) * Math.PI) / 180),
        1,
        0,
        0
      );
    }

    // Calculate scaled dimensions
    const scaledWidth = img.width * transform.scaleX * scale;
    const scaledHeight = img.height * transform.scaleY * scale;

    // Handle masking
    if (layer.mask.enabled && layer.mask.path.length >= 3) {
      // Create mask canvas
      const maskCanvas = MaskRenderer.createMaskCanvas(
        layer.mask.path,
        scaledWidth,
        scaledHeight,
        layer.mask.feather * scale
      );

      // Create temporary canvas for masked image
      const tempCanvas = document.createElement("canvas");
      const tempCtx = tempCanvas.getContext("2d")!;
      tempCanvas.width = scaledWidth;
      tempCanvas.height = scaledHeight;

      // Draw image to temp canvas
      tempCtx.drawImage(img, 0, 0, scaledWidth, scaledHeight);

      // Apply mask
      tempCtx.globalCompositeOperation = "destination-in";
      tempCtx.drawImage(maskCanvas, 0, 0, scaledWidth, scaledHeight);

      // Draw masked result centered
      this.ctx.drawImage(
        tempCanvas,
        -scaledWidth / 2,
        -scaledHeight / 2,
        scaledWidth,
        scaledHeight
      );
    } else {
      // Draw the image centered without mask
      this.ctx.drawImage(
        img,
        -scaledWidth / 2,
        -scaledHeight / 2,
        scaledWidth,
        scaledHeight
      );
    }

    this.ctx.restore();
  }

  exportComposite(project: Project, exportScale: number = 1): Promise<Blob> {
    return new Promise(async (resolve, reject) => {
      try {
        // Create a temporary canvas for export
        const exportCanvas = document.createElement("canvas");
        const exportCtx = exportCanvas.getContext("2d")!;

        exportCanvas.width = project.base.width * exportScale;
        exportCanvas.height = project.base.height * exportScale;

        // Draw base image
        if (project.base.imageData) {
          const baseImg = await this.loadImage(project.base.imageData);
          exportCtx.drawImage(
            baseImg,
            0,
            0,
            exportCanvas.width,
            exportCanvas.height
          );
        }

        // Draw layers
        for (const layer of project.layers) {
          if (!layer.visible || !layer.imageData) continue;

          const img = await this.loadImage(layer.imageData);
          const { transform, opacity } = layer;

          exportCtx.save();
          exportCtx.globalAlpha = opacity;

          const centerX = transform.left * exportCanvas.width;
          const centerY = transform.top * exportCanvas.height;

          exportCtx.translate(centerX, centerY);
          exportCtx.rotate((transform.angle * Math.PI) / 180);

          if (transform.skewX || transform.skewY) {
            exportCtx.transform(
              1,
              Math.tan(((transform.skewY || 0) * Math.PI) / 180),
              Math.tan(((transform.skewX || 0) * Math.PI) / 180),
              1,
              0,
              0
            );
          }

          // Apply the same scaling logic as the display renderer
          const scaledWidth = img.width * transform.scaleX * exportScale;
          const scaledHeight = img.height * transform.scaleY * exportScale;

          // Handle masking
          if (layer.mask.enabled && layer.mask.path.length >= 3) {
            // Create mask canvas
            const maskCanvas = MaskRenderer.createMaskCanvas(
              layer.mask.path,
              scaledWidth,
              scaledHeight,
              layer.mask.feather * exportScale
            );

            // Create temporary canvas for masked image
            const tempCanvas = document.createElement("canvas");
            const tempCtx = tempCanvas.getContext("2d")!;
            tempCanvas.width = scaledWidth;
            tempCanvas.height = scaledHeight;

            // Draw image to temp canvas
            tempCtx.drawImage(img, 0, 0, scaledWidth, scaledHeight);

            // Apply mask
            tempCtx.globalCompositeOperation = "destination-in";
            tempCtx.drawImage(maskCanvas, 0, 0, scaledWidth, scaledHeight);

            // Draw masked result
            exportCtx.drawImage(
              tempCanvas,
              -scaledWidth / 2,
              -scaledHeight / 2,
              scaledWidth,
              scaledHeight
            );
          } else {
            exportCtx.drawImage(
              img,
              -scaledWidth / 2,
              -scaledHeight / 2,
              scaledWidth,
              scaledHeight
            );
          }

          exportCtx.restore();
        }

        exportCanvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Failed to create blob"));
          }
        }, "image/png");
      } catch (error) {
        reject(error);
      }
    });
  }
}
