# Image Placer

A modern web-based image composition tool for creating professional product mockups by placing and transforming overlay images onto base images. Built with Next.js 15, React 19, and Fabric.js for a smooth, responsive editing experience.

## Overview

Image Placer enables users to create professional product mockups by:

- Loading a base image (e.g., model hand, packaging template, device mockup)
- Adding multiple overlay images with precise positioning and transformations
- Creating custom vector masks for precise image shaping
- Applying blend modes and opacity controls for realistic compositing
- Tagging layers for specialized workflows (nail positions, design elements)
- Exporting complete project packages with all assets and settings preserved
- Creating portable templates that work across different image sizes

Perfect for creating nail design mockups, product packaging visualizations, screen mockups, apparel designs, and more. Specialized features for nail design apps include layer tagging for position mapping and normalized scaling for template portability.

## Key Features

### ✅ **Currently Implemented**

#### **Core Editing Tools**

- **Floating Toolbar**: Clean tool selection with Select, Mask, Transform, and Skew modes
- **Interactive Canvas**: Fabric.js-powered canvas with smooth transforms and handles
- **Precise Controls**: Move, scale, rotate, and skew overlays with visual handles and numeric inputs
- **Layer Management**: Full layer stack with reordering, visibility, and lock controls
- **Mask Drawing**: Create custom polygon masks with real-time preview and feathering
- **Layer Tagging**: Tag layers with custom names for specialized workflows (e.g., "left_pinky", "design_element")

#### **Professional Features**

- **Blend Modes**: Support for all standard blend modes (Normal, Multiply, Screen, Overlay, etc.)
- **Opacity Control**: Per-layer opacity with smooth transitions
- **Layer Locking**: Prevent accidental modifications to finalized layers
- **Resolution Independence**: All transforms stored in normalized coordinates
- **Template Portability**: Normalized scaling ensures designs work across different base image sizes
- **Legacy Compatibility**: Automatic migration of old projects to new scaling system

#### **Project Management**

- **Complete Project Export**: ZIP files containing original assets, rendered composite, and project JSON
- **Project Loading**: Full support for loading saved ZIP and JSON projects
- **Asset Preservation**: Original image files maintained with proper MIME types
- **Reproducible Results**: Projects can be reopened and re-rendered identically

#### **Modern UI/UX**

- **Responsive Design**: Works seamlessly across desktop and tablet devices
- **Icon-Based Interface**: Comprehensive Lucide React icons throughout
- **Automatic Tool Switching**: Smart context-aware tool transitions
- **Clean Header**: Streamlined interface focusing on essential controls

### 🔮 **Future Enhancements**

- Perspective warping with Three.js and WebGL
- Color adjustment controls (exposure, contrast, saturation)
- Batch processing capabilities
- Cloud storage integration
- Advanced mask feathering options

## Technical Architecture

### **Core Technologies**

- **Next.js 15** with App Router and Turbopack for fast development
- **React 19** with modern hooks and concurrent features
- **Fabric.js 6.7** for 2D canvas manipulation and interactive transforms
- **JSZip 3.10** for project packaging and asset management
- **TypeScript 5** throughout for type safety and developer experience
- **Tailwind CSS 4** for consistent, responsive styling

### **Canvas System**

- **Fabric.js Canvas**: Handles all 2D transforms with interactive handles and smooth animations
- **Custom Mask Overlay**: Vector polygon drawing with real-time preview
- **Dual Rendering**: Optimized preview with high-resolution export capability

### **Data Model**

Projects use a JSON structure with normalized coordinates (0-1 range) relative to base image dimensions, ensuring resolution independence and template portability:

```json
{
  "version": 1,
  "metadata": {
    "created": "2025-01-15T10:30:00Z",
    "modified": "2025-01-15T11:45:00Z",
    "author": "User"
  },
  "base": {
    "name": "model-hand.png",
    "width": 1200,
    "height": 1600
  },
  "layers": [
    {
      "id": "uuid-string",
      "name": "nail-design.png",
      "tag": "left_pinky",
      "transform": {
        "left": 0.5,
        "top": 0.5,
        "scaleX": 0.25,
        "scaleY": 0.25,
        "angle": 15.0,
        "skewX": 0,
        "skewY": 0,
        "normalizedScaleX": 0.15,
        "normalizedScaleY": 0.12
      },
      "mask": {
        "enabled": true,
        "visible": true,
        "path": [
          [0.45, 0.35],
          [0.55, 0.35],
          [0.55, 0.65],
          [0.45, 0.65]
        ],
        "feather": 2.0
      },
      "opacity": 0.8,
      "blendMode": "multiply",
      "visible": true,
      "locked": false
    }
  ]
}
```

#### **Key Features of the Data Model:**

- **Layer Tags**: Optional `tag` field for workflow-specific layer identification
- **Dual Scaling System**: Both legacy (`scaleX`/`scaleY`) and normalized scale values for backward compatibility
- **Normalized Scaling**: `normalizedScaleX`/`normalizedScaleY` represent rendered size as fraction of base image dimensions
- **Template Portability**: Normalized values ensure consistent visual appearance across different overlay image sizes

## Getting Started

### **Installation**

1. **Clone the repository:**

   ```bash
   git clone <repository-url>
   cd image-placer
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Start development server:**

   ```bash
   npm run dev
   ```

4. **Open in browser:**
   ```
   http://localhost:3000
   ```

### **Basic Usage**

1. **Load Base Image**: Click the upload button and select your background/base image
2. **Add Overlay Layers**: Click "Add Overlay" to add images that will be positioned on the base
3. **Transform Layers**:
   - Use the floating toolbar to select your editing tool
   - Use interactive canvas handles for visual editing
   - Use the properties panel for precise numeric control
   - Create masks by switching to Mask mode and drawing polygons
   - Add optional tags to layers for workflow organization
4. **Manage Layers**:
   - Toggle visibility with the eye icon
   - Lock layers to prevent changes
   - Adjust opacity and blend modes
   - Reorder layers by dragging
   - Add descriptive tags for specialized workflows
5. **Export Your Work**:
   - Click "Export ZIP" to save a complete project package
   - The ZIP contains original assets, composite render, and project JSON

### **Tool Modes**

- **Select** (MousePointer2): Select and move layers
- **Transform** (Move3D): Access all transform handles (move, scale, rotate, skew)
- **Skew** (Square): Specialized skew transformation mode
- **Mask** (Scissors): Draw custom vector masks with polygon paths

### **Layer Properties**

Each layer supports:

- **Transform**: Position, scale, rotation, skew with numeric precision
- **Appearance**: Opacity (0-100%) and blend mode selection
- **Mask**: Custom polygon shapes with adjustable feathering
- **Management**: Visibility toggle, lock protection, and layer ordering
- **Tagging**: Optional custom tags for workflow-specific identification
- **Scaling**: Both legacy and normalized scale values for template portability

### **Specialized Workflows**

#### **Nail Design Templates**

- **Layer Tagging**: Tag layers with nail positions (e.g., "left_pinky", "right_thumb")
- **Template Portability**: Create designs that work across different hand model images
- **JSON Export**: Exports include both display names and workflow tags
- **Scale Independence**: Normalized scaling ensures consistent appearance regardless of overlay image dimensions

## Project Structure

```
src/
├── app/                 # Next.js app router pages
├── components/          # React components
│   ├── ImagePlacer.tsx    # Main application component
│   ├── FabricCanvas.tsx   # Canvas rendering and interactions
│   ├── LayerProperties.tsx # Layer control panel
│   └── FloatingToolbar.tsx # Tool selection interface
├── types/               # TypeScript type definitions
├── utils/               # Utility functions
│   ├── export.ts         # Project export/import logic
│   └── mask.ts          # Mask rendering utilities
└── styles/              # Global styles and Tailwind config
```

## Performance Considerations

- **Optimized Rendering**: Canvas updates only when necessary
- **Memory Management**: Automatic cleanup of blob URLs and unused resources
- **Efficient Storage**: Projects store only essential data with asset references
- **Smooth Interactions**: Debounced updates and optimized event handling
- **Scalable Architecture**: Component-based design for easy feature additions
- **Legacy Migration**: Automatic upgrade of old projects to new scaling system
- **Template Optimization**: Normalized scaling calculations cached for performance

## Browser Support

- **Modern Browsers**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **Canvas API**: Full HTML5 Canvas and Fabric.js support required
- **File API**: Blob/File handling for image uploads and project management
- **ES2020+**: Modern JavaScript features utilized throughout

## Contributing

This project uses:

- **ESLint** for code linting
- **TypeScript** for type checking
- **Prettier** for code formatting (recommended)
- **Conventional Commits** for consistent commit messages

Run `npm run lint` to check code quality before committing.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
