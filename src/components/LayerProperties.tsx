"use client";

import { Layer } from "@/types";
import { Lock, Move, RotateCw, Maximize2, Eye, Zap } from "lucide-react";

interface LayerPropertiesProps {
  layer: Layer | null;
  onUpdateLayer: (updates: Partial<Layer>) => void;
}

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

  const handlePropertyChange = (
    property: keyof Layer,
    value: Layer[keyof Layer]
  ) => {
    onUpdateLayer({ [property]: value });
  };

  return (
    <div className="p-4 space-y-4 text-gray-900">
      <div>
        <h3 className="font-semibold mb-2 text-gray-900">Layer Properties</h3>
        <div className="text-sm text-gray-700 mb-4">
          {layer.name}
          {layer.locked && <span className=" text-yellow-600"> • Locked</span>}
        </div>
      </div>

      {layer.locked && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800 flex items-center gap-2">
          <Lock size={16} />
          This layer is locked. Unlock it to make changes.
        </div>
      )}

      {/* Position Controls */}
      <div>
        <label className="text-sm font-medium mb-2 text-gray-900 flex items-center gap-2">
          <Move size={16} className="text-gray-600" />
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
              disabled={layer.locked}
              className={`w-full px-2 py-1 text-xs border-2 rounded focus:border-blue-500 focus:outline-none ${
                layer.locked
                  ? "border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed"
                  : "border-gray-300 bg-white text-gray-900"
              }`}
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
              disabled={layer.locked}
              className={`w-full px-2 py-1 text-xs border-2 rounded focus:border-blue-500 focus:outline-none ${
                layer.locked
                  ? "border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed"
                  : "border-gray-300 bg-white text-gray-900"
              }`}
            />
          </div>
        </div>
      </div>

      {/* Scale Controls */}
      <div>
        <label className="text-sm font-medium mb-2 text-gray-900 flex items-center gap-2">
          <Maximize2 size={16} className="text-gray-600" />
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
              disabled={layer.locked}
              className={`w-full px-2 py-1 text-xs border-2 rounded focus:border-blue-500 focus:outline-none ${
                layer.locked
                  ? "border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed"
                  : "border-gray-300 bg-white text-gray-900"
              }`}
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
              disabled={layer.locked}
              className={`w-full px-2 py-1 text-xs border-2 rounded focus:border-blue-500 focus:outline-none ${
                layer.locked
                  ? "border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed"
                  : "border-gray-300 bg-white text-gray-900"
              }`}
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
            disabled={layer.locked}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              layer.locked
                ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
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
            disabled={layer.locked}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              layer.locked
                ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
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
            disabled={layer.locked}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              layer.locked
                ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                : "bg-green-600 hover:bg-green-700 text-white"
            }`}
          >
            1:1 Ratio
          </button>
        </div>
      </div>

      {/* Rotation */}
      <div>
        <label className="text-sm font-medium mb-2 text-gray-900 flex items-center gap-2">
          <RotateCw size={16} className="text-gray-600" />
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
          disabled={layer.locked}
          className={`w-full px-2 py-1 text-xs border rounded ${
            layer.locked
              ? "border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed"
              : "border-gray-300 bg-white text-gray-900"
          }`}
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
          disabled={layer.locked}
          className={`w-full mt-1 ${
            layer.locked ? "cursor-not-allowed opacity-50" : ""
          }`}
        />
      </div>

      {/* Skew Controls */}
      <div>
        <label className="text-sm font-medium mb-2 text-gray-900 flex items-center gap-2">
          <Zap size={16} className="text-gray-600" />
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
              disabled={layer.locked}
              className={`w-full px-2 py-1 text-xs border-2 rounded focus:border-blue-500 focus:outline-none ${
                layer.locked
                  ? "border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed"
                  : "border-gray-300 bg-white text-gray-900"
              }`}
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
              disabled={layer.locked}
              className={`w-full px-2 py-1 text-xs border-2 rounded focus:border-blue-500 focus:outline-none ${
                layer.locked
                  ? "border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed"
                  : "border-gray-300 bg-white text-gray-900"
              }`}
            />
          </div>
        </div>
      </div>

      {/* Opacity */}
      <div>
        <label className="text-sm font-medium mb-2 text-gray-900 flex items-center gap-2">
          <Eye size={16} className="text-gray-600" />
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
          disabled={layer.locked}
          className={`w-full ${
            layer.locked ? "cursor-not-allowed opacity-50" : ""
          }`}
        />
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
          disabled={layer.locked}
          className={`w-full px-3 py-2 text-sm rounded font-medium transition-colors ${
            layer.locked
              ? "bg-gray-200 text-gray-400 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-700 text-white"
          }`}
        >
          Reset Transform
        </button>
      </div>
    </div>
  );
}
