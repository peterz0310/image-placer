import JSZip from 'jszip';
import { Project } from '@/types';

export interface ExportOptions {
  includeOriginalAssets: boolean;
  renderScale: number;
  format: 'png' | 'jpeg';
  quality: number;
}

export class ProjectExporter {
  static async exportJSON(project: Project): Promise<Blob> {
    const exportData = this.prepareProjectForExport(project);
    return new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json'
    });
  }

  static async exportZIP(
    project: Project, 
    compositeBlob: Blob,
    options: ExportOptions = {
      includeOriginalAssets: true,
      renderScale: 1,
      format: 'png',
      quality: 1.0
    }
  ): Promise<Blob> {
    const zip = new JSZip();

    // Add project JSON
    const projectData = this.prepareProjectForExport(project);
    zip.file('project.json', JSON.stringify(projectData, null, 2));

    // Add composite render
    zip.file(`composite.${options.format}`, compositeBlob);

    if (options.includeOriginalAssets) {
      // Create assets folder
      const assetsFolder = zip.folder('assets');
      
      // Add base image
      if (project.base.originalFile) {
        assetsFolder!.file(project.base.name, project.base.originalFile);
      } else if (project.base.imageData) {
        const baseBlob = this.dataURLToBlob(project.base.imageData);
        assetsFolder!.file(project.base.name, baseBlob);
      }

      // Add layer images
      for (const layer of project.layers) {
        if (layer.originalFile) {
          assetsFolder!.file(layer.name, layer.originalFile);
        } else if (layer.imageData) {
          const layerBlob = this.dataURLToBlob(layer.imageData);
          assetsFolder!.file(layer.name, layerBlob);
        }
      }
    }

    return await zip.generateAsync({ type: 'blob' });
  }

  private static prepareProjectForExport(project: Project): Project {
    return {
      ...project,
      base: {
        ...project.base,
        imageData: undefined,
        originalFile: undefined
      },
      layers: project.layers.map(layer => ({
        ...layer,
        imageData: undefined,
        originalFile: undefined
      }))
    };
  }

  private static dataURLToBlob(dataURL: string): Blob {
    const arr = dataURL.split(',');
    const mime = arr[0].match(/:(.*?);/)![1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    
    return new Blob([u8arr], { type: mime });
  }

  static downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export async function renderComposite(project: Project, scale: number = 1): Promise<Blob> {
  return new Promise(async (resolve, reject) => {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      
      canvas.width = project.base.width * scale;
      canvas.height = project.base.height * scale;

      // Load and draw base image
      if (project.base.imageData) {
        const baseImg = await loadImage(project.base.imageData);
        ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);
      }

      // Draw layers
      for (const layer of project.layers) {
        if (!layer.visible || !layer.imageData) continue;
        
        const img = await loadImage(layer.imageData);
        
        ctx.save();
        ctx.globalAlpha = layer.opacity;
        ctx.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation;

        const centerX = layer.transform.left * canvas.width;
        const centerY = layer.transform.top * canvas.height;
        
        ctx.translate(centerX, centerY);
        ctx.rotate((layer.transform.angle * Math.PI) / 180);
        
        if (layer.transform.skewX || layer.transform.skewY) {
          ctx.transform(
            1,
            Math.tan((layer.transform.skewY || 0) * Math.PI / 180),
            Math.tan((layer.transform.skewX || 0) * Math.PI / 180),
            1,
            0,
            0
          );
        }

        const scaledWidth = img.width * layer.transform.scaleX * scale;
        const scaledHeight = img.height * layer.transform.scaleY * scale;

        ctx.drawImage(
          img,
          -scaledWidth / 2,
          -scaledHeight / 2,
          scaledWidth,
          scaledHeight
        );

        ctx.restore();
      }

      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create composite blob'));
        }
      }, 'image/png');
    } catch (error) {
      reject(error);
    }
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}