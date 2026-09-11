# Fixed-Camera Object Occupancy

No vehicle classifier or trained parking-space model is required for this mode.
It detects changes inside reviewed parking polygons, not vehicle identity.

1. Fix the camera and remove all objects from the parking bays.
2. Open CCTV coordinate registration and load a current camera frame.
3. Select the four corners enclosing the parking area using the region tool.
4. Find bays from closed lines. Review all polygons, remove false positives,
   add missing bays, and match bay numbers to the floor plan. In edit mode,
   changing a bay number swaps it with an existing number if necessary.
5. Save coordinates, then explicitly save the current image as the empty
   reference. The server stores this frame privately on the camera computer.
6. Return to management. Background analysis runs approximately every five
   seconds; an empty result requires consecutive confirmations.

Coordinate changes invalidate the reference. Capture a new empty reference
after moving the camera, changing resolution or changing the parking layout.
The algorithm rejects detected camera translation above three pixels and
resolution changes, but does not guarantee detection of every camera movement.

The detector excludes polygon borders and compares interior pixels against
the reference, compensating for a global brightness offset. A connected change
covering at least four percent of the interior counts as an object. Shadows,
reflections and local lighting changes can still trigger occupancy; small or
low-contrast objects can be missed. Test placement/removal in near and far bays
before presenting. Never capture a reference while vehicles are present.

All automatic line results are drafts. Covered or broken lines can cause
missing bays. This is a fixed-camera miniature workflow, not a claim of
validated real-world vehicle detection accuracy.
