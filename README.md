# Magenta '67

![Magenta '67](preview.jpg)

An open-world browser racing game by G-Data Labs. Drive a magenta 1967 fastback around a seaside island, up the Sky Highway to the Moon, and through energy portals that turn you into a ball of light.

- 10 sprint races against three rivals, plus a nine-round championship with car upgrades
- The Sky Highway: a launch rail into the clouds, a road to the Moon and a re-entry chute back to Earth
- Energy portals and Portal Rush: become an energy orb, drift for points, skim across the sea
- NOS, slipstreams, drift zones, speed traps, 25 hidden gold snakes, ghosts and replays
- Day, sunset and night; clear, fog and rain
- Build my car: turn photos of your own car into a car you can drive, edit it by typing what to change, and race it with friends

## Controls

| | Keyboard | Gamepad |
|---|---|---|
| Drive | W A S D or arrows | Triggers + stick |
| Handbrake / drift (hop as the orb) | Space | B |
| NOS | Shift or N | LB |
| Camera | C | Y |
| Reset | R | X |
| Pause | Esc | Start |

On a phone, on-screen pedals and steering appear automatically.

## About this repo

This repo holds the playable build: a static site with no build step. `index.html` loads `game.js` (the whole game, built with [three.js](https://threejs.org)) and the sounds in `sfx/`. It deploys to Vercel as is.

`api/car/` holds the small server functions for Build my car (Vercel installs what they need from `package.json`). They keep players' photos and cars in a private Vercel Blob store and never put a key in the code: everything secret is a Vercel environment variable.

### Switching Build my car on (Vercel dashboard, project magenta67)

1. **Storage** → Create → **Blob**, access **Private**, and connect it to this project (that adds `BLOB_READ_WRITE_TOKEN` by itself).
2. **Settings → Environment Variables** (Production), then redeploy:

| Name | What it is |
|---|---|
| `FAL_KEY` or `TRIPO_API_KEY` | The 3D step (Tripo's multiview model). fal.ai bills per car; Tripo's own API uses Tripo credits. One is enough. |
| `M67_INVITES` | Invite codes and how many builds each may use, e.g. `FAMILY=8, FRIENDS=4`. "Build it again" counts as a build. |
| `ANTHROPIC_API_KEY` | Optional. Lets Edit my car understand any wording; without it, simple word rules handle the common changes. |
| `M67_BUILDS_PER_DAY` | Optional. Most builds the whole site starts in a day (default 40). |
| `M67_EDITS_PER_DAY` | Optional. Most AI edits in a day (default 500). |

Friends' own cars are never loaded by themselves: a player chooses Show (or sets Friends' own cars to Always) in the Online panel. Only a car's ID goes between players, and cars load only from this site's `api/car/`.

Sound effects, engine recordings, music and announcer lines were generated with ElevenLabs. The car model was made with Tripo from photos of a real magenta '67.
