# Parking-Space Segmentation

## Current status

`yolo11n-seg.pt` is the official Ultralytics COCO segmentation **training base**,
not a trained parking-space detector. It is deliberately not used by the
automatic parking-space detection endpoint. Vehicle inference stays separate.

Source: https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n-seg.pt
Upstream licensing: https://www.ultralytics.com/license
Review upstream license requirements before product distribution.

## Training

1. Open the existing CCTV coordinate editor for the intended parking lot/floor.
2. Load an image, draw or correct the actual parking-space polygons, and review
   every space. Do not label pedestrian hatching, vehicles or driving aisles.
3. Expand the training-data section. Supply a capture group and explicitly save
   the current image plus coordinates. This action stores the source image on
   the server under `datasets/parking-spaces`; normal detection does not do so.
4. Collect separate training and validation groups, preferably different capture
   sessions/cameras. Repeated frames of the same scene are not independent
   validation. The exporter rejects sharing a group or identical image between
   these splits. Review retained images for privacy before collecting them.
5. Run `python3 scripts/train-parking-spaces.py --epochs 100 --device cpu`.
   The script requires reviewed images and labels in both splits. It evaluates
   the trained model and installs `models/parking-spaces-seg.pt`.

No accuracy or operational readiness is claimed until validation and a camera
test have been completed. The downloaded base alone does not enable detection.

## Configuration and workflow

- `PARKVIEW_SLOT_MODEL_PATH`: optional absolute path to the trained `.pt` file.
- `PARKVIEW_SLOT_CLASSES`: comma-separated parking-space class names; default
  accepts `parking_space`, `parking_slot`, `parking-space`, `parking-slot`.
- A dedicated segmentation model is required. Generic car bounding boxes are
  never substituted for parking-space polygons.
- Automatic detection returns normalized mask polygons as a numbered draft.
  Apply, edit/add/delete, then save explicitly for the selected lot/floor.
- Saving preserves other configurations. A revision conflict means that the
  same lot/floor changed after loading; reload before deliberately replacing it.
- The active root configuration remains the last saved lot/floor for the
  existing single-camera worker. This is not a multi-camera routing system.
- Occupancy uses polygon/vehicle-box intersection divided by the smaller area
  with threshold 0.3, followed by temporal stabilization. `occupied` is 1 or 0;
  unknown is null. Existing detector class filtering remains configurable.

## Relay connectivity

The API responds to approved-origin OPTIONS requests, including Authorization
and the localtunnel reminder-bypass header. Configure the allowed origin as
`https://jaden70749.github.io`. Keep the relay and local API running.
An expired/disconnected tunnel can return its own response without CORS headers;
application CORS code cannot repair that external response. Do not use `no-cors`
or publish an unauthenticated camera endpoint as a workaround.
