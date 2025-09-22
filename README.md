# Image Placer

A web-based image composition tool for creating professional product mockups by placing and transforming overlay images onto base images. Similar to Placeit-style mockup generators, but with full creative control and exportable project files.

## Overview

Image Placer allows users to create professional product mockups by:

- Loading a base image (e.g., model hand, packaging template, device mockup)
- Adding multiple overlay images with precise positioning and transformations
- Applying advanced effects like perspective warping and vector masking
- Exporting structured JSON data for use in other applications and live image placement
- Generating complete project packages with all assets and settings preserved

Perfect for creating nail design mockups, product packaging visualizations, screen mockups, apparel designs, and more. The exported JSON transforms can be used to dynamically place images in real-time applications.

## Key Features

### Transform Controls

- **Precise positioning**: Move, scale, rotate, and skew overlays with visual handles and numeric inputs
- **Perspective warping**: Optional 4-corner quad warping for realistic perspective effects
- **Resolution independence**: All transforms stored in normalized coordinates for consistent results

### Advanced Composition

- **Vector masking**: Create custom polygon masks with adjustable feather for smooth edges
- **Blend modes**: Support for standard blend modes (Normal, Multiply, Screen, Overlay, etc.)
- **Layer management**: Full layer stack with opacity, visibility, and z-order controls
- **Color adjustments**: Per-layer exposure, contrast, and saturation controls

### Professional Export

- **Complete project packages**: ZIP files containing original assets, rendered composite, and project JSON
- **Reproducible results**: Projects can be reopened and re-rendered with identical output
- **Multiple resolutions**: Export at base resolution or custom scaling factors
- **Portable JSON transforms**: Structured data format for integration with other applications
- **Client-side processing**: No server-side dependencies for core functionality

## Technical Architecture

### Core Technologies

- **Next.js 14+** with App Router for the web application framework
- **Fabric.js** for 2D canvas manipulation and transform handles
- **Three.js** for perspective warping with WebGL-based quad deformation
- **Web Workers** with OffscreenCanvas for mask rasterization and image processing
- **TypeScript** throughout for type safety and better development experience

### Canvas System

The editor uses a dual-canvas approach:

- **Fabric.js canvas** handles standard 2D transforms (move, scale, rotate, skew) with interactive handles
- **Three.js WebGL overlay** provides perspective warping when quad mode is enabled
- **Worker-based processing** handles computationally intensive tasks like mask rendering

### Data Model

Projects are stored as JSON with normalized coordinates (0-1 range) relative to the base image dimensions, ensuring resolution independence and reproducible results across different display sizes and export resolutions. This structured format is designed for easy integration with other applications that need to apply the same transforms dynamically.

```json
{
  "version": 1,
  "base": {
    "name": "model-hand.png",
    "width": 1200,
    "height": 1600
  },
  "layers": [
    {
      "id": "uuid",
      "name": "overlay.png",
      "transform": {
        "left": 0.50,
        "top": 0.50,
        "scaleX": 0.25,
        "scaleY": 0.25,
        "angle": 15.0
      },
      "quad": {
        "enabled": false,
        "points": [...]
      },
      "mask": {
        "enabled": true,
        "path": [...],
        "feather": 2.0
      },
      "opacity": 0.8,
      "blendMode": "multiply"
    }
  ]
}
```

## User Workflow

1. **Project Setup**: Load base image which defines the canvas dimensions and coordinate system
2. **Layer Creation**: Add overlay images that appear as new layers in the stack
3. **Transform Editing**: Use visual handles or numeric inputs to position and transform layers
4. **Advanced Effects**:
   - Enable quad warping for perspective effects
   - Create vector masks for custom shapes
   - Adjust blend modes and opacity
5. **Export**: Generate ZIP containing original assets, composite render, and project JSON with transform data for use in other applications

## Rendering Pipeline

### Standard Mode

For layers without warping, the system uses Fabric.js's built-in transform matrix calculations with Canvas2D rendering.

### Warp Mode

When perspective warping is enabled:

1. Overlay image is mapped to a subdivided Three.js plane geometry
2. Plane vertices are positioned according to the quad corner points
3. WebGL shaders handle the perspective-correct texture mapping
4. Result is composited with other layers

### Masking

Vector masks are processed via Web Workers:

1. Polygon path is rasterized to an alpha channel at output resolution
2. Gaussian blur is applied based on feather radius
3. Resulting alpha mask is applied during final composition

### Export Rendering

Final composite generation supports both Canvas2D and WebGL pipelines depending on the features used, ensuring optimal performance while maintaining quality.

## Getting Started

### Running the Application

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the development server:**
   ```bash
   npm run dev
   ```

3. **Open your browser and navigate to:**
   ```
   http://localhost:3000
   ```

### Basic Usage

1. **Load a Base Image**: Click "Load Base Image" and select your background image
2. **Add Overlays**: Click "Add Overlay" to add images that will be positioned on top of the base image
3. **Transform Layers**: 
   - Use the interactive handles on the canvas to move, scale, and rotate layers
   - Use the properties panel on the right for precise numeric control
   - Adjust opacity, blend modes, and visibility
4. **Export Your Work**:
   - **Export JSON**: Save just the project data with normalized coordinates
   - **Export ZIP**: Save complete project package with original assets, composite render, and project JSON

### Features Implemented

✅ **Core MVP Features:**
- Base image loading and display
- Overlay image upload and layer management
- Interactive Fabric.js canvas with transform handles
- Precise numeric controls for positioning, scale, rotation, and skew
- Layer opacity and blend mode controls
- JSON export with normalized coordinates (resolution-independent)
- ZIP export with complete project package including:
  - Original assets (base image and overlays)
  - Composite PNG render
  - Project JSON file
- Project loading from JSON files
- Layer visibility and lock controls

🔮 **Advanced Features (Future Implementation):**
- Perspective warping with Three.js and WebGL
- Vector polygon masking with feather effects
- Web Worker-based mask processing

## Development Considerations

### Performance

- **Image downsampling**: Preview canvas limited to 4K dimensions for smooth editing
- **Worker processing**: Mask generation and heavy computations moved to Web Workers
- **Memory management**: Automatic cleanup of blob URLs and unused resources
- **Optimized rendering**: Smart invalidation to redraw only when necessary

### Quality Assurance

- **Normalized coordinates**: Prevents precision loss when scaling between different resolutions
- **sRGB color space**: Consistent color handling across devices
- **High-resolution export**: Full-quality rendering regardless of preview canvas size

### Accessibility

- **Keyboard navigation**: Full keyboard support for all editing functions
- **Screen reader compatibility**: Proper ARIA labels and semantic HTML
- **Visual indicators**: Clear focus states and interaction feedback
- **Flexible input methods**: Both visual handles and numeric inputs for precise control

## Project Goals

This project aims to provide:

- **Professional-grade output** suitable for commercial use
- **Intuitive interface** accessible to non-technical users
- **Complete project portability** with self-contained export files
- **Structured transform data** for integration with live image placement systems
- **Predictable results** that render identically across different environments
- **Flexible deployment** with client-side processing (can be hosted anywhere)

The scope is intentionally focused on image placement and basic transformations, with particular emphasis on generating precise JSON transform data that can be consumed by other applications for real-time image composition.
