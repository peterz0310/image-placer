"use client";

import { Layer, BlendMode } from "@/types";

interface LayerPropertiesProps {
  layer: Layer | null;
  onUpdateLayer: (updates: Partial<Layer>) => void;
}

const BLEND_MODES: BlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "soft-light",
  "hard-light",
  "color-dodge",
  "color-burn",
  "darken",
  "lighten",
  "difference",
  "exclusion",
];

export default function LayerProperties({
  layer,
  onUpdateLayer,
}: LayerPropertiesProps) {
  if (!layer) {
    return (
      <div className="p-4 text-center text-gray-700 bg-gray-50">
        <p className="text-sm font-medium text-gray-800">
          Select a layer to edit its properties
        </p>
        <p className="text-xs text-gray-600 mt-2">
          Click on a layer in the layers panel to start editing
        </p>
      </div>
    );
  }

  const handleTransformChange = (
    property: keyof Layer["transform"],
    value: number
  ) => {
    onUpdateLayer({
      transform: {
        ...layer.transform,
        [property]: value,
      },
    });
  };

  const handlePropertyChange = (property: keyof Layer, value: any) => {
    onUpdateLayer({ [property]: value });
  };

  return (
    <div className="p-4 space-y-4 text-gray-900">
      <div>
        <h3 className="font-semibold mb-2 text-gray-900">Layer Properties</h3>
        <div className="text-sm text-gray-700 mb-4">{layer.name}</div>
      </div>

      {/* Position Controls */}
      <div>
        <label className="block text-sm font-medium mb-2 text-gray-900">
          Position
        </label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-700 mb-1 font-medium">
              Left
            </label>
            <input
              type="number"
              step="0.001"
              min="0"
              max="1"
              value={layer.transform.left.toFixed(3)}
              onChange={(e) =>
                handleTransformChange("left", parseFloat(e.target.value))
              }
              className="w-full px-2 py-1 text-xs border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none bg-white text-gray-900"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-700 mb-1 font-medium">
              Top
            </label>
            <input
              type="number"
              step="0.001"
              min="0"
              max="1"
              value={layer.transform.top.toFixed(3)}
              onChange={(e) =>
                handleTransformChange("top", parseFloat(e.target.value))
              }
              className="w-full px-2 py-1 text-xs border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none bg-white text-gray-900"
            />
          </div>
        </div>
      </div>

      {/* Scale Controls */}
      <div>
        <label className="block text-sm font-medium mb-2 text-gray-900">
          Scale
        </label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-700 mb-1 font-medium">
              Scale X
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max="10"
              value={layer.transform.scaleX.toFixed(2)}
              onChange={(e) =>
                handleTransformChange("scaleX", parseFloat(e.target.value))
              }
              className="w-full px-2 py-1 text-xs border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none bg-white text-gray-900"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-700 mb-1 font-medium">
              Scale Y
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max="10"
              value={layer.transform.scaleY.toFixed(2)}
              onChange={(e) =>
                handleTransformChange("scaleY", parseFloat(e.target.value))
              }
              className="w-full px-2 py-1 text-xs border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none bg-white text-gray-900"
            />
          </div>
        </div>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => {
              // Make scaleY match scaleX to maintain current aspect ratio
              onUpdateLayer({
                transform: {
                  ...layer.transform,
                  scaleY: layer.transform.scaleX,
                },
              });
            }}
            className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
          >
            Match X→Y
          </button>
          <button
            onClick={() => {
              // Make scaleX match scaleY to maintain current aspect ratio
              onUpdateLayer({
                transform: {
                  ...layer.transform,
                  scaleX: layer.transform.scaleY,
                },
              });
            }}
            className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
          >
            Match Y→X
          </button>
          <button
            onClick={() => {
              // Reset to 1:1 aspect ratio
              const avgScale =
                (layer.transform.scaleX + layer.transform.scaleY) / 2;
              onUpdateLayer({
                transform: {
                  ...layer.transform,
                  scaleX: avgScale,
                  scaleY: avgScale,
                },
              });
            }}
            className="text-xs px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
          >
            1:1 Ratio
          </button>
        </div>
      </div>

      {/* Rotation */}
      <div>
        <label className="block text-sm font-medium mb-2 text-gray-900">
          Rotation
        </label>
        <input
          type="number"
          step="1"
          min="-360"
          max="360"
          value={Math.round(layer.transform.angle)}
          onChange={(e) =>
            handleTransformChange("angle", parseFloat(e.target.value))
          }
          className="w-full px-2 py-1 text-xs border rounded"
        />
        <input
          type="range"
          min="-180"
          max="180"
          step="1"
          value={layer.transform.angle}
          onChange={(e) =>
            handleTransformChange("angle", parseFloat(e.target.value))
          }
          className="w-full mt-1"
        />
      </div>

      {/* Skew Controls */}
      <div>
        <label className="block text-sm font-medium mb-2 text-gray-900">
          Skew
        </label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-700 mb-1 font-medium">
              Skew X
            </label>
            <input
              type="number"
              step="1"
              min="-45"
              max="45"
              value={Math.round(layer.transform.skewX || 0)}
              onChange={(e) =>
                handleTransformChange("skewX", parseFloat(e.target.value))
              }
              className="w-full px-2 py-1 text-xs border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none bg-white text-gray-900"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-700 mb-1 font-medium">
              Skew Y
            </label>
            <input
              type="number"
              step="1"
              min="-45"
              max="45"
              value={Math.round(layer.transform.skewY || 0)}
              onChange={(e) =>
                handleTransformChange("skewY", parseFloat(e.target.value))
              }
              className="w-full px-2 py-1 text-xs border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none bg-white text-gray-900"
            />
          </div>
        </div>
      </div>

      {/* Opacity */}
      <div>
        <label className="block text-sm font-medium mb-2 text-gray-900">
          Opacity ({Math.round(layer.opacity * 100)}%)
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={layer.opacity}
          onChange={(e) =>
            handlePropertyChange("opacity", parseFloat(e.target.value))
          }
          className="w-full"
        />
      </div>

      {/* Blend Mode */}
      <div>
        <label className="block text-sm font-medium mb-2 text-gray-900">
          Blend Mode
        </label>
        <select
          value={layer.blendMode}
          onChange={(e) =>
            handlePropertyChange("blendMode", e.target.value as BlendMode)
          }
          className="w-full px-2 py-1 text-sm border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none bg-white text-gray-900"
        >
          {BLEND_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode.charAt(0).toUpperCase() + mode.slice(1).replace("-", " ")}
            </option>
          ))}
        </select>
      </div>

      {/* Visibility and Lock */}
      <div className="flex gap-2">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={layer.visible}
            onChange={(e) => handlePropertyChange("visible", e.target.checked)}
            className="mr-2"
          />
          <span className="text-sm text-gray-900">Visible</span>
        </label>
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={layer.locked}
            onChange={(e) => handlePropertyChange("locked", e.target.checked)}
            className="mr-2"
          />
          <span className="text-sm text-gray-900">Locked</span>
        </label>
      </div>

      {/* Reset Transform */}
      <div className="pt-4 border-t">
        <button
          onClick={() => {
            onUpdateLayer({
              transform: {
                left: 0.5,
                top: 0.5,
                scaleX: 0.25,
                scaleY: 0.25,
                angle: 0,
                skewX: 0,
                skewY: 0,
              },
            });
          }}
          className="w-full px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors"
        >
          Reset Transform
        </button>
      </div>
    </div>
  );
}
