import { Project, Layer } from '@/types';

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private images: Map<string, HTMLImageElement> = new Map();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
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
        this.ctx.drawImage(baseImg, 0, 0, this.canvas.width, this.canvas.height);
      }

      // Draw layers
      for (const layer of layers) {
        if (!layer.visible || !layer.imageData) continue;
        
        await this.drawLayer(layer, scale);
      }
    } catch (error) {
      console.error('Error rendering canvas:', error);
    }
  }

  private async drawLayer(layer: Layer, scale: number) {
    const img = await this.loadImage(layer.imageData!);
    const { transform, opacity, blendMode } = layer;

    this.ctx.save();

    // Set opacity and blend mode
    this.ctx.globalAlpha = opacity;
    this.ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation;

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
        Math.tan((transform.skewY || 0) * Math.PI / 180),
        Math.tan((transform.skewX || 0) * Math.PI / 180),
        1,
        0,
        0
      );
    }

    // Calculate scaled dimensions
    const scaledWidth = img.width * transform.scaleX * scale;
    const scaledHeight = img.height * transform.scaleY * scale;

    // Draw the image centered
    this.ctx.drawImage(
      img,
      -scaledWidth / 2,
      -scaledHeight / 2,
      scaledWidth,
      scaledHeight
    );

    this.ctx.restore();
  }

  exportComposite(project: Project, exportScale: number = 1): Promise<Blob> {
    return new Promise(async (resolve, reject) => {
      try {
        // Create a temporary canvas for export
        const exportCanvas = document.createElement('canvas');
        const exportCtx = exportCanvas.getContext('2d')!;
        
        exportCanvas.width = project.base.width * exportScale;
        exportCanvas.height = project.base.height * exportScale;

        // Draw base image
        if (project.base.imageData) {
          const baseImg = await this.loadImage(project.base.imageData);
          exportCtx.drawImage(baseImg, 0, 0, exportCanvas.width, exportCanvas.height);
        }

        // Draw layers
        for (const layer of project.layers) {
          if (!layer.visible || !layer.imageData) continue;
          
          const img = await this.loadImage(layer.imageData);
          const { transform, opacity, blendMode } = layer;

          exportCtx.save();
          exportCtx.globalAlpha = opacity;
          exportCtx.globalCompositeOperation = blendMode as GlobalCompositeOperation;

          const centerX = transform.left * exportCanvas.width;
          const centerY = transform.top * exportCanvas.height;
          
          exportCtx.translate(centerX, centerY);
          exportCtx.rotate((transform.angle * Math.PI) / 180);
          
          if (transform.skewX || transform.skewY) {
            exportCtx.transform(
              1,
              Math.tan((transform.skewY || 0) * Math.PI / 180),
              Math.tan((transform.skewX || 0) * Math.PI / 180),
              1,
              0,
              0
            );
          }

          const scaledWidth = img.width * transform.scaleX * exportScale;
          const scaledHeight = img.height * transform.scaleY * exportScale;

          exportCtx.drawImage(
            img,
            -scaledWidth / 2,
            -scaledHeight / 2,
            scaledWidth,
            scaledHeight
          );

          exportCtx.restore();
        }

        exportCanvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create blob'));
          }
        }, 'image/png');
      } catch (error) {
        reject(error);
      }
    });
  }
}