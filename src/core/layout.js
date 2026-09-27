// Shared geography. Every system reads positions from here so the world, titans,
// cinematic and director all agree. Units are meters, +Y up.
//
//            -Z (north, inner gate -> rest of Wall Maria)
//                        |
//   -X  ---------- town centre (0,0,0) ----------  +X
//                        |
//            +Z (south, OUTER GATE -> titan territory)
//
// The Shiganshina district is a disc of town enclosed by a circular wall.
// The Colossal Titan appears outside the OUTER gate and kicks it in; pure titans
// pour through the breach heading north into the town.

export const LAYOUT = {
  wall: {
    radius: 380,        // inner face of the wall, measured from town centre
    thickness: 14,
    height: 50,         // canon Wall Maria height
    walkwayY: 50,       // top surface Y (cannons / rail up here)
  },
  outerGate: { x: 0, z: 380, facing: 0 },      // on +Z; the breach happens here
  innerGate: { x: 0, z: -380, facing: Math.PI },
  townRadius: 360,     // houses fill up to here
  plaza: { x: 0, z: 40, radius: 38 },            // central square with the church
  mainStreet: { from: [0, 0, 370], to: [0, 0, -370], width: 16 }, // gate-to-gate avenue
  river: null,         // reserved
  outside: {
    fieldsTo: 1400,     // flat-ish farmland outside the wall
    hillsTo: 4000,      // rolling hills / forest ring
    mountains: 9000,    // distant silhouette ring
  },
  colossal: { x: 0, z: 440, height: 60 },       // stands just outside the outer gate
  titanEntry: { x: 0, z: 470 },                  // pure titans spawn around here and walk in
  playerStart: { x: -22, y: 0, z: 120, yaw: 0 }, // yaw 0 = looking toward +Z (the outer gate); y resolved by world
  sunDir: [-0.35, 0.28, 0.89],                   // low late-afternoon sun, behind the outer wall (backlit breach)
};

export const deg = (d) => (d * Math.PI) / 180;
