/**
 * filmstripGenerator.jsx
 * Photoshop ExtendScript - JUCE Filmstrip Generator
 *
 * Creates a vertical filmstrip from any layer or layer group using
 * one of three motion modes:
 *   1. Up/Down    - translates vertically (sliders, faders)
 *   2. Left/Right - translates horizontally
 *   3. Rotate     - rotates between start/end angles (knobs)
 *                   Optional pivot layer for off-center rotation (gauge needles)
 *
 * A separate "bounds" layer defines the crop region for each frame.
 *
 * Usage:
 *   1. Open your .psd in Photoshop.
 *   2. Create a shape layer covering the desired frame area.
 *   3. File > Scripts > Browse > filmstripGenerator.jsx
 *   4. Pick layers, mode, frame count. Click Generate.
 *
 * Compatible with Photoshop CS6 through CC 2026+ (ExtendScript .jsx).
 */

#target photoshop

(function () {

    // ================================================================
    //  HELPERS
    // ================================================================

    function getBounds(layer) {
        var b = layer.bounds;
        return {
            left:   b[0].as("px"),
            top:    b[1].as("px"),
            right:  b[2].as("px"),
            bottom: b[3].as("px")
        };
    }

    function hideAllLayers(doc) {
        for (var i = 0; i < doc.layers.length; i++) {
            doc.layers[i].visible = false;
        }
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function collectLayers(container, depth, parentPath, results) {
        for (var i = 0; i < container.layers.length; i++) {
            var lyr = container.layers[i];
            var indent = "";
            for (var d = 0; d < depth; d++) indent += "  ";
            var tag = (lyr.typename === "LayerSet") ? " [Group]" : " [Layer]";
            var path = parentPath.concat([lyr.name]);

            results.push({
                name: lyr.name,
                displayName: indent + lyr.name + tag,
                path: path,
                isGroup: (lyr.typename === "LayerSet")
            });

            if (lyr.typename === "LayerSet") {
                collectLayers(lyr, depth + 1, path, results);
            }
        }
    }

    function findLayerByPath(doc, path) {
        var container = doc;
        for (var p = 0; p < path.length; p++) {
            var found = false;
            for (var i = 0; i < container.layers.length; i++) {
                if (container.layers[i].name === path[p]) {
                    container = container.layers[i];
                    found = true;
                    break;
                }
            }
            if (!found) return null;
        }
        return container;
    }

    function makeParentsVisible(layer) {
        var parent = layer.parent;
        while (parent && parent.typename === "LayerSet") {
            parent.visible = true;
            parent = parent.parent;
        }
    }

    function getPivotCenter(layer) {
        var b = getBounds(layer);
        return {
            x: (b.left + b.right) / 2,
            y: (b.top + b.bottom) / 2
        };
    }

    function rotateAroundPivot(layer, angleDeg, pivotX, pivotY) {
        var b = getBounds(layer);
        var cx = (b.left + b.right) / 2;
        var cy = (b.top + b.bottom) / 2;

        var rad = angleDeg * Math.PI / 180;
        var vx = pivotX - cx;
        var vy = pivotY - cy;
        var newPivotX = cx + vx * Math.cos(rad) - vy * Math.sin(rad);
        var newPivotY = cy + vx * Math.sin(rad) + vy * Math.cos(rad);
        var dx = pivotX - newPivotX;
        var dy = pivotY - newPivotY;

        var doc = layer.parent;
        while (doc.typename !== "Document") doc = doc.parent;
        doc.activeLayer = layer;

        var desc = new ActionDescriptor();
        var ref = new ActionReference();
        ref.putEnumerated(
            charIDToTypeID("Lyr "),
            charIDToTypeID("Ordn"),
            charIDToTypeID("Trgt")
        );
        desc.putReference(charIDToTypeID("null"), ref);
        desc.putEnumerated(
            charIDToTypeID("FTcs"),
            charIDToTypeID("QCSt"),
            charIDToTypeID("Qcsa")
        );

        var ofstDesc = new ActionDescriptor();
        ofstDesc.putUnitDouble(
            charIDToTypeID("Hrzn"), charIDToTypeID("#Pxl"), dx
        );
        ofstDesc.putUnitDouble(
            charIDToTypeID("Vrtc"), charIDToTypeID("#Pxl"), dy
        );
        desc.putObject(
            charIDToTypeID("Ofst"), charIDToTypeID("Ofst"), ofstDesc
        );

        desc.putUnitDouble(
            charIDToTypeID("Angl"), charIDToTypeID("#Ang"), angleDeg
        );
        executeAction(charIDToTypeID("Trnf"), desc, DialogModes.NO);
    }

    // ================================================================
    //  PRE-FLIGHT
    // ================================================================

    if (app.documents.length === 0) {
        alert("No document is open.\n\nOpen your PSD and run again.");
        return;
    }

    var src = app.activeDocument;

    if (src.layers.length === 0) {
        alert("The document has no layers.");
        return;
    }

    // ================================================================
    //  COLLECT LAYERS
    // ================================================================

    var layerEntries = [];
    collectLayers(src, 0, [], layerEntries);

    if (layerEntries.length < 2) {
        alert("Need at least two layers: one to animate, one for bounds.");
        return;
    }

    var displayNames = [];
    for (var li = 0; li < layerEntries.length; li++) {
        displayNames.push(layerEntries[li].displayName);
    }

    // ================================================================
    //  DIALOG
    // ================================================================

    var dlg = new Window("dialog", "JUCE Filmstrip Generator");
    dlg.orientation = "column";
    dlg.alignChildren = ["fill", "top"];
    dlg.spacing = 10;
    dlg.margins = 16;

    // -- Layer Selection --
    var layerPanel = dlg.add("panel", undefined, "Layer Selection");
    layerPanel.orientation = "column";
    layerPanel.alignChildren = ["fill", "top"];
    layerPanel.margins = 12;
    layerPanel.spacing = 10;

    var animGrp = layerPanel.add("group");
    animGrp.orientation = "row";
    animGrp.alignChildren = ["left", "center"];
    animGrp.add("statictext", undefined, "Animate:");
    var animateDropdown = animGrp.add("dropdownlist", undefined, displayNames);
    animateDropdown.selection = 0;
    animateDropdown.helpTip =
        "The layer or group that moves or rotates.\n" +
        "Only this element is visible in each frame.";

    var boundsGrp = layerPanel.add("group");
    boundsGrp.orientation = "row";
    boundsGrp.alignChildren = ["left", "center"];
    boundsGrp.add("statictext", undefined, "Bounds:");
    var boundsDropdown = boundsGrp.add("dropdownlist", undefined, displayNames);
    boundsDropdown.selection = Math.min(1, displayNames.length - 1);
    boundsDropdown.helpTip =
        "Defines the crop area for each frame.\n" +
        "Hidden during capture. Use a rectangle shape.";

    // -- Motion --
    var motionPanel = dlg.add("panel", undefined, "Motion");
    motionPanel.orientation = "column";
    motionPanel.alignChildren = ["fill", "top"];
    motionPanel.margins = 12;
    motionPanel.spacing = 8;

    var modeGrp = motionPanel.add("group");
    modeGrp.orientation = "row";
    modeGrp.alignChildren = ["left", "center"];
    modeGrp.add("statictext", undefined, "Mode:");
    var modeDropdown = modeGrp.add(
        "dropdownlist", undefined,
        ["Up/Down", "Left/Right", "Rotate"]
    );
    modeDropdown.selection = 0;

    var rotSep = motionPanel.add("statictext", undefined,
        "\u2500\u2500 Rotation Settings \u2500\u2500");
    rotSep.alignment = ["center", "top"];

    var r1 = motionPanel.add("group");
    r1.orientation = "row";
    r1.alignChildren = ["left", "center"];
    r1.add("statictext", undefined, "Start angle (\u00B0):");
    var startAngleInput = r1.add("edittext", undefined, "0");
    startAngleInput.characters = 8;

    var r2 = motionPanel.add("group");
    r2.orientation = "row";
    r2.alignChildren = ["left", "center"];
    r2.add("statictext", undefined, "End angle (\u00B0):");
    var endAngleInput = r2.add("edittext", undefined, "270");
    endAngleInput.characters = 8;

    var previewGrp = motionPanel.add("group");
    previewGrp.orientation = "row";
    previewGrp.alignment = ["center", "top"];
    var previewStartBtn = previewGrp.add("button", undefined, "Preview Start");
    var previewEndBtn = previewGrp.add("button", undefined, "Preview End");

    var resetGrp = motionPanel.add("group");
    resetGrp.alignment = ["center", "top"];
    var resetPreviewBtn = resetGrp.add("button", undefined, "Reset Preview");

    var pivotSep = motionPanel.add("statictext", undefined,
        "\u2500\u2500 Pivot Settings \u2500\u2500");
    pivotSep.alignment = ["center", "top"];

    var pivotChkGrp = motionPanel.add("group");
    pivotChkGrp.orientation = "row";
    pivotChkGrp.alignChildren = ["left", "center"];
    var pivotCheckbox = pivotChkGrp.add("checkbox", undefined, "Use pivot layer");
    pivotCheckbox.value = false;
    pivotCheckbox.helpTip =
        "Rotate around the center of a separate pivot layer\n" +
        "instead of the animate layer\u2019s own center.";

    var pivotDropGrp = motionPanel.add("group");
    pivotDropGrp.orientation = "row";
    pivotDropGrp.alignChildren = ["left", "center"];
    pivotDropGrp.add("statictext", undefined, "Pivot:");
    var pivotDropdown = pivotDropGrp.add("dropdownlist", undefined, displayNames);
    pivotDropdown.selection = 0;
    pivotDropdown.enabled = false;
    pivotDropdown.helpTip =
        "The center of this layer\u2019s bounding box\n" +
        "becomes the rotation origin.";

    pivotCheckbox.onClick = function () {
        pivotDropdown.enabled = pivotCheckbox.value;
    };

    // -- Frames --
    var framesPanel = dlg.add("panel", undefined, "Frames");
    framesPanel.orientation = "column";
    framesPanel.alignChildren = ["fill", "top"];
    framesPanel.margins = 12;
    framesPanel.spacing = 8;

    var fGrp = framesPanel.add("group");
    fGrp.orientation = "row";
    fGrp.alignChildren = ["left", "center"];
    fGrp.add("statictext", undefined, "Number of frames:");
    var framesInput = fGrp.add("edittext", undefined, "101");
    framesInput.characters = 8;

    // -- Mode toggle --
    function updateModeFields() {
        var isRotate = modeDropdown.selection
            ? (modeDropdown.selection.index === 2) : false;
        startAngleInput.enabled = isRotate;
        endAngleInput.enabled = isRotate;
        previewStartBtn.enabled = isRotate;
        previewEndBtn.enabled = isRotate;
        resetPreviewBtn.enabled = isRotate;
        pivotCheckbox.enabled = isRotate;
        if (!isRotate) {
            pivotCheckbox.value = false;
            pivotDropdown.enabled = false;
        } else {
            pivotDropdown.enabled = pivotCheckbox.value;
        }
    }
    modeDropdown.onChange = updateModeFields;
    updateModeFields();

    // -- Preview handlers --
    var previewState = src.activeHistoryState;

    function makePreviewHandler(angleInput, label) {
        return function () {
            var idx = animateDropdown.selection
                ? animateDropdown.selection.index : -1;
            if (idx < 0) return;
            var angle = parseFloat(angleInput.text);
            if (isNaN(angle)) { alert("Invalid " + label + " angle."); return; }
            try {
                app.activeDocument = src;
                src.activeHistoryState = previewState;
                var layer = findLayerByPath(src, layerEntries[idx].path);
                if (layer && angle !== 0) {
                    src.activeLayer = layer;
                    if (pivotCheckbox.value && pivotDropdown.selection) {
                        var pvLayer = findLayerByPath(
                            src,
                            layerEntries[pivotDropdown.selection.index].path
                        );
                        if (pvLayer) {
                            var pc = getPivotCenter(pvLayer);
                            rotateAroundPivot(layer, angle, pc.x, pc.y);
                        } else {
                            layer.rotate(angle, AnchorPosition.MIDDLECENTER);
                        }
                    } else {
                        layer.rotate(angle, AnchorPosition.MIDDLECENTER);
                    }
                }
            } catch (e) {
                alert("Preview failed: " + e.message);
            }
        };
    }
    previewStartBtn.onClick = makePreviewHandler(startAngleInput, "start");
    previewEndBtn.onClick = makePreviewHandler(endAngleInput, "end");

    resetPreviewBtn.onClick = function () {
        try {
            app.activeDocument = src;
            src.activeHistoryState = previewState;
        } catch (e) { alert("Reset failed: " + e.message); }
    };

    // -- Buttons --
    var btnGrp = dlg.add("group");
    btnGrp.alignment = ["center", "top"];
    btnGrp.add("button", undefined, "Cancel", {name: "cancel"});
    btnGrp.add("button", undefined, "Generate", {name: "ok"});

    var dialogResult = dlg.show();

    // undo any preview rotation
    try { src.activeHistoryState = previewState; } catch (ignore) {}

    if (dialogResult !== 1) { return; }

    // ================================================================
    //  VALIDATE
    // ================================================================

    var animIdx = animateDropdown.selection.index;
    var boundsIdx = boundsDropdown.selection.index;

    if (animIdx === boundsIdx) {
        alert("Animate and bounds layers cannot be the same.");
        return;
    }

    var animEntry = layerEntries[animIdx];
    var boundsEntry = layerEntries[boundsIdx];
    var mode = modeDropdown.selection.index;  // 0=Up/Down, 1=Left/Right, 2=Rotate

    var numFrames = parseInt(framesInput.text, 10);
    if (isNaN(numFrames) || numFrames < 1) {
        alert("Frame count must be a whole number of 1 or more.");
        return;
    }
    if (numFrames > 500) {
        alert("Frame count (" + numFrames + ") exceeds 500. Edit the script to raise this.");
        return;
    }

    var startAngle = 0;
    var endAngle = 270;
    if (mode === 2) {
        startAngle = parseFloat(startAngleInput.text);
        endAngle = parseFloat(endAngleInput.text);
        if (isNaN(startAngle)) { alert("Invalid start angle."); return; }
        if (isNaN(endAngle))   { alert("Invalid end angle."); return; }
    }

    var usePivot = false;
    var pivotIdx = -1;
    var pivotEntry = null;

    if (mode === 2 && pivotCheckbox.value) {
        pivotIdx = pivotDropdown.selection ? pivotDropdown.selection.index : -1;
        if (pivotIdx < 0) {
            alert("Pivot is enabled but no pivot layer is selected.");
            return;
        }
        if (pivotIdx === animIdx) {
            alert("Pivot layer cannot be the same as the animate layer.");
            return;
        }
        if (pivotIdx === boundsIdx) {
            alert("Pivot layer cannot be the same as the bounds layer.");
            return;
        }
        pivotEntry = layerEntries[pivotIdx];
        usePivot = true;
    }

    // ================================================================
    //  SETUP
    // ================================================================

    var originalUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    var boundsLayer = findLayerByPath(src, boundsEntry.path);
    var animLayer = findLayerByPath(src, animEntry.path);

    if (!animLayer) {
        alert("Could not find animate layer \"" + animEntry.name + "\".");
        app.preferences.rulerUnits = originalUnits;
        return;
    }
    if (!boundsLayer) {
        alert("Could not find bounds layer \"" + boundsEntry.name + "\".");
        app.preferences.rulerUnits = originalUnits;
        return;
    }

    var pivotLayer = null;
    if (usePivot) {
        pivotLayer = findLayerByPath(src, pivotEntry.path);
        if (!pivotLayer) {
            alert("Could not find pivot layer \"" + pivotEntry.name + "\".");
            app.preferences.rulerUnits = originalUnits;
            return;
        }
        var pivBounds = getBounds(pivotLayer);
        var pivW = pivBounds.right - pivBounds.left;
        var pivH = pivBounds.bottom - pivBounds.top;
        if (pivW < 1 || pivH < 1) {
            alert("Pivot layer has zero dimensions.\nMake sure it has visible content.");
            app.preferences.rulerUnits = originalUnits;
            return;
        }
    }

    // ================================================================
    //  FRAME DIMENSIONS & MOTION
    // ================================================================

    var refB = getBounds(boundsLayer);
    var frameW = Math.round(refB.right - refB.left);
    var frameH = Math.round(refB.bottom - refB.top);

    if (frameW < 1 || frameH < 1) {
        alert("Bounds layer has zero dimensions.\nMake sure it has visible content.");
        app.preferences.rulerUnits = originalUnits;
        return;
    }

    var selRect = [
        [refB.left, refB.top],
        [refB.right, refB.top],
        [refB.right, refB.bottom],
        [refB.left, refB.bottom]
    ];

    var animB = getBounds(animLayer);
    var animW = animB.right - animB.left;
    var animH = animB.bottom - animB.top;

    var angleStep = 0;

    if (mode === 0 && animH > (refB.bottom - refB.top)) {
        if (!confirm("Animate layer is taller than bounds.\nIt will be clipped. Continue?")) {
            app.preferences.rulerUnits = originalUnits;
            return;
        }
    } else if (mode === 1 && animW > (refB.right - refB.left)) {
        if (!confirm("Animate layer is wider than bounds.\nIt will be clipped. Continue?")) {
            app.preferences.rulerUnits = originalUnits;
            return;
        }
    } else if (mode === 2) {
        angleStep = (numFrames === 1) ? 0 : (endAngle - startAngle) / (numFrames - 1);
    }

    // ================================================================
    //  CREATE DESTINATION
    // ================================================================

    var outW = frameW;
    var outH = frameH * numFrames;

    var newMode;
    switch (src.mode) {
        case DocumentMode.CMYK:      newMode = NewDocumentMode.CMYK;      break;
        case DocumentMode.GRAYSCALE: newMode = NewDocumentMode.GRAYSCALE; break;
        case DocumentMode.LAB:       newMode = NewDocumentMode.LAB;       break;
        default:                     newMode = NewDocumentMode.RGB;       break;
    }

    var dst;
    try {
        dst = app.documents.add(outW, outH, src.resolution,
            "Filmstrip", newMode, DocumentFill.TRANSPARENT);
    } catch (e) {
        alert("Could not create output (" + outW + " x " + outH + " px).\n" +
              "Try fewer frames.\n\n" + e.message);
        app.preferences.rulerUnits = originalUnits;
        return;
    }

    // background layers don't support transparency
    try {
        if (dst.artLayers.length > 0 && dst.artLayers[0].isBackgroundLayer) {
            dst.artLayers[0].isBackgroundLayer = false;
        }
    } catch (ignore) {}

    // ================================================================
    //  RENDER
    // ================================================================

    var aborted = false;

    // Copy-merged only captures the content bounding box, discarding
    // position within the selection. For translation modes, we copy
    // once and reposition the paste per frame. Rotation must copy
    // per-frame since the content changes.

    // pre-compute per-frame destination offsets
    var frameDeltaX = [];
    var frameDeltaY = [];

    var intraStartY = 0, intraEndY = 0;
    var intraStartX = 0, intraEndX = 0;

    if (mode === 0) {
        // Up/Down: frame 0 = cap at bottom, frame N-1 = cap at top
        intraStartY = (frameH / 2) - (animH / 2);
        intraEndY   = -(frameH / 2) + (animH / 2);
    } else if (mode === 1) {
        // Left/Right: frame 0 = cap at left, frame N-1 = cap at right
        intraStartX = -(frameW / 2) + (animW / 2);
        intraEndX   = (frameW / 2) - (animW / 2);
    }

    for (var p = 0; p < numFrames; p++) {
        var t = (numFrames === 1) ? 0 : p / (numFrames - 1);
        var slotCenterY = p * frameH + frameH / 2;
        var oY = 0, oX = 0;
        if (mode === 0) oY = Math.round(lerp(intraStartY, intraEndY, t));
        else if (mode === 1) oX = Math.round(lerp(intraStartX, intraEndX, t));
        frameDeltaX[p] = oX;
        frameDeltaY[p] = Math.round(slotCenterY - (outH / 2)) + oY;
    }

    // For translation modes, the source never changes between frames.
    // Copy once and reuse the clipboard for all frames.
    if (mode !== 2) {
        app.activeDocument = src;
        var savedState = src.activeHistoryState;

        hideAllLayers(src);
        var anim = findLayerByPath(src, animEntry.path);
        if (!anim) {
            alert("Could not find animate layer.");
            app.preferences.rulerUnits = originalUnits;
            return;
        }
        anim.visible = true;
        makeParentsVisible(anim);
        src.selection.select(selRect);
        src.selection.copy(true);

        for (var i = 0; i < numFrames; i++) {
            try {
                app.activeDocument = dst;
                dst.paste();

                if (frameDeltaX[i] !== 0 || frameDeltaY[i] !== 0) {
                    dst.activeLayer.translate(
                        new UnitValue(frameDeltaX[i], "px"),
                        new UnitValue(frameDeltaY[i], "px")
                    );
                }

                // merge incrementally to keep memory flat
                if (dst.artLayers.length > 1) {
                    dst.mergeVisibleLayers();
                }
            } catch (e) {
                alert("Error on frame " + (i + 1) + ":\n" + e.message +
                      "\n(line " + e.line + ")");
                aborted = true;
                break;
            }
        }

        // restore source
        try {
            app.activeDocument = src;
            src.activeHistoryState = savedState;
            src.selection.deselect();
        } catch (ignore) {}

    } else {
        // Rotation mode: per-frame transform required
        app.activeDocument = src;
        var savedState2 = src.activeHistoryState;

        var pivotX = 0, pivotY = 0;
        if (usePivot) {
            var pc = getPivotCenter(pivotLayer);
            pivotX = pc.x;
            pivotY = pc.y;
        }

        for (var i = 0; i < numFrames; i++) {
            try {
                app.activeDocument = src;
                src.activeHistoryState = savedState2;
                hideAllLayers(src);

                var anim2 = findLayerByPath(src, animEntry.path);
                if (!anim2) {
                    throw new Error("Lost animate layer on frame " + (i + 1));
                }
                anim2.visible = true;
                makeParentsVisible(anim2);

                // hide pivot layer so it doesn't appear in copy-merged
                if (usePivot) {
                    var pivRef = findLayerByPath(src, pivotEntry.path);
                    if (pivRef) pivRef.visible = false;
                }

                src.activeLayer = anim2;

                var angle = startAngle + angleStep * i;
                if (angle !== 0) {
                    if (usePivot) {
                        rotateAroundPivot(anim2, angle, pivotX, pivotY);
                    } else {
                        anim2.rotate(angle, AnchorPosition.MIDDLECENTER);
                    }
                }

                // Measure content position within the selection before
                // copy-merged, which crops the clipboard to content bounds.
                var rotB = getBounds(anim2);
                var clipL = Math.max(rotB.left, refB.left);
                var clipT = Math.max(rotB.top, refB.top);
                var clipR = Math.min(rotB.right, refB.right);
                var clipBt = Math.min(rotB.bottom, refB.bottom);
                var contentCX = (clipL + clipR) / 2;
                var contentCY = (clipT + clipBt) / 2;
                var selCX = (refB.left + refB.right) / 2;
                var selCY = (refB.top + refB.bottom) / 2;
                var corrX = contentCX - selCX;
                var corrY = contentCY - selCY;

                src.selection.select(selRect);
                src.selection.copy(true);

                app.activeDocument = dst;
                dst.paste();

                var tX = corrX;
                var tY = frameDeltaY[i] + corrY;
                if (tX !== 0 || tY !== 0) {
                    dst.activeLayer.translate(
                        new UnitValue(tX, "px"),
                        new UnitValue(tY, "px")
                    );
                }

                if (dst.artLayers.length > 1) {
                    dst.mergeVisibleLayers();
                }
            } catch (e) {
                try {
                    app.activeDocument = src;
                    src.activeHistoryState = savedState2;
                } catch (ignore) {}

                alert("Error on frame " + (i + 1) + ":\n" + e.message +
                      "\n(line " + e.line + ")");
                aborted = true;
                break;
            }
        }

        try {
            app.activeDocument = src;
            src.activeHistoryState = savedState2;
            src.selection.deselect();
        } catch (ignore) {}
    }

    // ================================================================
    //  CLEANUP
    // ================================================================

    try {
        app.activeDocument = dst;
        if (dst.artLayers.length > 1) {
            dst.mergeVisibleLayers();
        }
        dst.artLayers[0].name = "filmstrip";
        dst.selection.deselect();
    } catch (ignore) {}

    app.preferences.rulerUnits = originalUnits;

    // ================================================================
    //  SUMMARY & SAVE
    // ================================================================

    if (!aborted) {
        var modeLabel;
        switch (mode) {
            case 0: modeLabel = "Up/Down"; break;
            case 1: modeLabel = "Left/Right"; break;
            case 2:
                modeLabel = "Rotate (" + startAngle + "\u00B0 to " +
                    endAngle + "\u00B0, step " +
                    angleStep.toFixed(2) + "\u00B0)";
                if (usePivot) {
                    modeLabel += "\nPivot:        \"" + pivotEntry.name + "\"";
                }
                break;
        }

        alert(
            "Filmstrip complete!" +
            "\n\nAnimate:      \"" + animEntry.name + "\"" +
            "\nBounds:       \"" + boundsEntry.name + "\"" +
            "\nMode:         " + modeLabel +
            "\nFrames:       " + numFrames +
            "\nFrame size:   " + frameW + " x " + frameH + " px" +
            "\nStrip size:   " + outW + " x " + outH + " px" +
            "\n\nSave dialog opens next."
        );

        try {
            var saveFile = File.saveDialog(
                "Save Filmstrip",
                "PNG Files:*.png,PSD Files:*.psd,All Files:*.*"
            );
            if (saveFile) {
                var fileName = saveFile.name.toLowerCase();
                if (fileName.indexOf(".psd") !== -1) {
                    var psdOpts = new PhotoshopSaveOptions();
                    psdOpts.layers = false;
                    dst.saveAs(saveFile, psdOpts, true);
                } else {
                    var pngOpts = new PNGSaveOptions();
                    pngOpts.compression = 9;
                    pngOpts.interlaced = false;
                    dst.saveAs(saveFile, pngOpts, true);
                }
            }
        } catch (e) {
            alert("Save failed: " + e.message +
                  "\n\nSave manually via File > Save As.");
        }
    }

})();
