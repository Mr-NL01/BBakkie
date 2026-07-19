# BBakkie

A collection of single-device, pass-and-play party games: Inner Clock (time
estimation) and Mexen (dice), with Dertigen coming soon. Vanilla HTML/CSS/JS,
no build step.

## Running locally

The JS files use ES modules (`import`/`export`), which browsers refuse to load
from `file://`. Do not open `index.html` directly — serve the folder over a
local HTTP server instead:

```
python -m http.server 8000
```

or

```
npx serve .
```

Then open `http://localhost:8000` in your browser.

or 

http://192.168.1.30:8000/bbakkie/

## Testing

- All input handlers use pointer events (`pointerdown`), so mouse clicks on a
  desktop browser behave the same as taps on a phone. The full game loop
  (Start, the red Stop screen, the 250ms stop-guard) is testable with a mouse.
- Use the browser DevTools device toolbar (mobile emulation, e.g. iPhone
  viewport) to check the mobile layout. Design is portrait-first.
