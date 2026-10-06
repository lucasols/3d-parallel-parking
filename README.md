# Parallel Park 3D

A browser game for practicing parallel parking, built with Three.js and TypeScript.
All of the art is generated in code at startup. There are no external assets.

## Run

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle in dist/
```

## Features

- **7 vehicles** with realistic dimensions, wheelbases and steering locks: City Micro, Hatchback, Sedan, Sports Coupe, SUV, Pickup Truck and Cargo Van. Each one has a different turning circle and different overhangs, so each one parks differently.
- **Realistic rendering**: PBR clear-coat paint, glass reflections from a sky-based environment map, soft sun shadows, ACES tone mapping and bloom. There are three times of day (day, sunset and night), with working headlights, brake lights and reverse lights, and street lamps.
- **Driving physics**: a kinematic bicycle model with Ackermann front-wheel steering. Collision checks use oriented boxes. Curb strikes are detected per tire, and the body overhang can pass over the curb the way it does in real life.
- **Driver's-seat view**: a detailed interior with a sculpted two-tone dashboard, an instrument binnacle, air vents, a climate panel, a centre console with gear selector, perforated leather seats, door cards with armrests and speakers, and a fabric headliner with sun visors. Materials (leather grain, soft-touch plastic, fabric, carpet, brushed aluminium, piano black) are generated procedurally.
  - The steering wheel turns with your inputs.
  - A live digital cluster shows speed, gear and park-assist distance.
  - The side and rear-view mirrors show real reflections, and the passenger mirror tilts down in reverse so the curb stays in view (`T` toggles it).
  - The backup camera plays on the dashboard screen.
  - Camera controls: free look with the mouse, `IJKL` or the right stick; hold-to-glance and look-back over the shoulder (the head leans with the gaze); zoom; seat height. Zoom and seat height are saved.
- **Driving aids** (each one can be turned off): projected path lines (on by default for Easy), a highlighted space, a minimap, numeric distance and angle readouts, ultrasonic-style parking sensors with beeps, and a mirrored backup camera. In views other than the driver's seat, the backup camera appears at the top of the screen.
- **Cameras**: Driver, Chase, Elevated, Bird's-eye, Orbit (drag the mouse) and Curb view.
- **Scoring**: distance to the curb (aim for ≤ 30 cm), alignment, centering, clean driving and the number of direction changes. Personal bests are saved for each vehicle and difficulty.
- **Difficulty** sets the size of the space: car length + 2.4 m / 1.6 m / 1.05 m / 0.75 m.

## Tutorial

Choose **Tutorial** in the menu for a guided lesson on a roomy space, with every driving aid switched on. A card on the left walks you through a reverse parallel park, one step at a time:

1. Pull up alongside the car ahead.
2. Turn to full right lock.
3. Reverse to the target angle.
4. Straighten and reverse to the turn point.
5. Turn to full left lock until the car is straight.
6. Centre the car in the space.

Each step checks your car's actual position and gives live feedback (angle, distance to the turn point, curb gap). The target angle and turn point are calculated for your vehicle's turning circle and the space. A green ghost outline shows where to stop. Scores from the tutorial don't count toward personal bests.

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Drive forward |
| `S` / `↓` | Reverse (brakes first if you are rolling forward) |
| `A` `D` / `←` `→` | Turn the steering wheel |
| `Space` | Brake |
| `Shift` | Creep (reduced throttle) |
| `C`, `1`–`6` | Change camera (`1` = driver's seat) |
| Mouse drag, `I` `J` `K` `L` | Look around (driver view) |
| `Q` / `E` (hold) | Glance at the left / right mirror, zooming in on it (driver view) |
| `B` (hold) | Look back over the right shoulder (driver view) |
| Scroll, `Z` / `X` | Zoom out / in (driver view) |
| `[` / `]` | Lower / raise the seat (driver view) |
| `T` | Tilt the passenger mirror down / up (it also tilts down automatically in reverse) |
| `V`, double-click | Recentre the view and reset zoom (double-click only recentres) |
| `Enter` | Finish and get scored |
| `R` / `N` | Retry / new street |
| `G` / `M` / `Esc` | Toggle guides / mute / pause |

Gamepads also work: the left stick steers, RT/LT drive forward and reverse, B brakes, A finishes and Y changes camera. In the driver view the right stick looks around, LB/RB glance and R3 recentres.

## Code layout

| File | Purpose |
| --- | --- |
| `src/game.ts` | Game loop, state machine, cameras, rendering |
| `src/physics.ts` | Vehicle dynamics, OBB collision, sensor ray casts |
| `src/carModel.ts` | Procedural car meshes built from side profiles |
| `src/interior.ts` | Driver-view cabin: dashboard, seats, steering wheel, mirrors, live cluster |
| `src/vehicles.ts` | Vehicle specifications |
| `src/world.ts` | Street, buildings, trees, props, sky and lighting presets |
| `src/textures.ts` | Procedural canvas textures (asphalt, concrete, facades, leaves) |
| `src/level.ts` / `src/scoring.ts` | Space and traffic generation, parking evaluation |
| `src/hud.ts` / `src/guides.ts` / `src/audio.ts` | UI, path guides, Web Audio |
