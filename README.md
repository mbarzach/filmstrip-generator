Created by Michael Barzach

# JUCE Filmstrip Generator

A Photoshop ExtendScript that generates vertical filmstrip PNGs for JUCE audio plugin UIs. Supports sliders, faders, and knobs through three motion modes.

## How It Works

The script takes two layers from your PSD: an **animate layer** (the element that moves) and a **bounds layer** (a rectangle defining the crop area and frame dimensions). It renders the animate layer at each position into a vertical filmstrip where each frame is stacked top-to-bottom.

JUCE draws one frame at a time based on parameter value, creating the illusion of movement.

## Motion Modes

1. **Up/Down** — The animate layer appears to travel from the bottom to the top of the bounds area. Used for vertical sliders and faders.

2. **Left/Right** — The animate layer appears to travel from left to right. Used for horizontal sliders.

3. **Rotate** — The animate layer rotates between a start and end angle. Used for knobs. Layer styles (drop shadows, bevels) stay fixed relative to the canvas while the texture rotates, preserving realistic lighting.

## Setup

1. Open your PSD in Photoshop.
2. Create a rectangle shape layer covering the area you want each filmstrip frame to capture. This is the bounds layer.
3. Run the script via **File > Scripts > Browse > filmstripGenerator.jsx**.

## Dialog Options

- **Animate** — The layer or group that moves or rotates. Only this element is visible in each frame.
- **Bounds** — The layer whose bounding box defines the crop region. Hidden during capture.
- **Mode** — Up/Down, Left/Right, or Rotate.
- **Start/End Angle** — Rotation range in degrees. Only active in Rotate mode.
- **Preview Start / Preview End** — Temporarily applies the rotation to the PSD so you can verify the range. Only active in Rotate mode.
- **Reset Preview** — Undoes any preview rotation.
- **Number of Frames** — Total frames in the filmstrip. Common values: 65, 101, 128.

A Save As dialog opens after generation.

## The Bounds Layer

The bounds layer is a reference rectangle you draw in the PSD. It serves two purposes:

- **Frame dimensions** — Each filmstrip frame matches the bounds layer's width and height.
- **Crop region** — For rotation mode, the bounds layer defines what area around the knob gets captured. For translation modes, it defines the travel range.

The bounds layer itself is hidden during rendering and does not appear in the output.

## Output Format

The output is a single tall PNG with all frames stacked vertically and transparent backgrounds. Frame 0 is at the top of the image.

```
Total height = frame height x number of frames
```

## Requirements

- Photoshop CS6 or later (ExtendScript .jsx)
- At least two layers in the document

## Technical Notes

For translation modes (Up/Down, Left/Right), the script copies the animate layer once and repositions the paste within each filmstrip slot. This works around a Photoshop behavior where copy-merged discards transparent pixels from the clipboard, reducing it to the content bounding box regardless of selection size.

For rotation mode, the script copies per-frame since the rotated content differs each time.

## License

MIT
