# Image Placer

Image Placer is a React + Fabric.js workspace for composing layered product visuals, nail art previews, and marketing mockups directly in the browser. Upload a base photo, stack overlay assets, refine every transform, and export a reusable project archive that captures the final composite along with all original files.

## Why Image Placer?

- **Purpose-built editor** – Fabric.js powers a responsive canvas with smooth transforms, masking, and pan/zoom controls.
- **Template friendly** – Normalised coordinates keep designs consistent across different source image sizes.
- **Reliable exports** – Download a ZIP that bundles the rendered composite, the project JSON, and the original assets so work is always reproducible.
- **Optimised for sharing** – Layer tagging, history, and undo/redo make collaboration and iteration straightforward.

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Run the development server**
   ```bash
   npm run dev
   ```
3. **Open the app** at [http://localhost:3000](http://localhost:3000) and upload a base image to activate the editor.
4. **Add overlay layers** with the “Add Overlay” control, then position, mask, and blend them using the floating toolbar and properties panel.
5. **Export your project** when you are satisfied. The download contains everything you need to reopen or share the design.

### Keyboard Shortcuts

| Action | Shortcut |
| --- | --- |
| Undo / Redo | Cmd/Ctrl + Z, Cmd/Ctrl + Shift + Z |
| Delete selected layer | Backspace / Delete |
| Toggle mask mode | M |
| Reset canvas zoom | Double-click the zoom indicator |

## Feature Overview

### Canvas Editing

- Fabric.js canvas with smooth pan/zoom and transform handles
- Select, transform, skew, and mask tools accessible via the floating toolbar
- Numeric controls for position, rotation, scale, skew, opacity, and blend mode

### Layer Workflow

- Stack, reorder, lock, and toggle visibility for every layer
- Tag layers (e.g., `left_pinky`, `device_screen`) to support specialised mockup templates
- Non-destructive mask editor with adjustable smoothing and feathering

### Project Management

- Import/export individual overlays, complete projects, or ZIP archives
- Automatic history tracking with undo/redo and keyboard shortcuts
- Exports include a rendered composite preview, metadata, and original files

## Project Files

Exported projects ship with a JSON description that keeps mockups resolution independent. Key fields include:

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
      "tag": "left_pinky",
      "transform": {
        "left": 0.48,
        "top": 0.62,
        "scaleX": 0.3,
        "scaleY": 0.3,
        "angle": 12,
        "normalizedScaleX": 0.18,
        "normalizedScaleY": 0.14
      },
      "mask": {
        "path": [[0.2, 0.1], [0.8, 0.1], [0.6, 0.9]],
        "feather": 2
      },
      "opacity": 0.85,
      "blendMode": "multiply"
    }
  ]
}
```

The `normalizedScaleX`/`normalizedScaleY` values allow templates to scale cleanly across different base images. Masks are stored as polygons and are rehydrated when projects are reopened.

## Tech Stack

- **Next.js 15** with the App Router
- **React 19** and modern hooks
- **TypeScript 5** end-to-end
- **Fabric.js 6.7** for canvas rendering
- **Tailwind CSS** for layout and styling
- **JSZip 3.10** for project packaging

## Development

- `npm run dev` – start the development server
- `npm run build` – create a production build
- `npm run lint` – run ESLint
- `npx tsc --noEmit` – check TypeScript types

Before committing, run linting and type checks to keep the codebase healthy.

## Contributing

Issues and pull requests are welcome! Please follow Conventional Commits for commit messages and run the lint/type checks described above before submitting changes.

## License

Image Placer is released under the MIT License.
