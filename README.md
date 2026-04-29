# Forkward 🍴

> A wandering eater's almanack for choosing what to eat, abroad and otherwise.

A static web app that helps you decide where to eat on holiday — or any time you're indecisive. Filter by cuisine, price, distance, and opening hours; or hit "Surprise Me" and let it pick.

## Live demo

Once you've enabled GitHub Pages on this repo, the app lives at:

`https://abumaz99.github.io/food-finder/`

## Features

- 📍 **Location** — by GPS or typed address (city, neighbourhood, full address)
- 📏 **Distance filter** — adjustable from 300 m to 10 km
- 💷 **Price filter** — £ to ££££, pick any combination
- 🍝 **18 cuisine categories** — Italian, Japanese, Middle Eastern, Vegetarian, etc.
- 🕒 **Open now** filter — parses OpenStreetMap opening hours
- 🗺️ **Map view** — interactive Leaflet map with custom price-level markers
- ✦ **Surprise me** — picks one at random from your filtered results
- ★ **Favourites** — bookmark spots for later (saved for the session)

## Stack

- **Vanilla HTML / CSS / JavaScript** — no build step, no framework, no npm
- **[Leaflet](https://leafletjs.com/)** — open-source map library
- **[Overpass API](https://overpass-api.de/)** — queries OpenStreetMap for restaurants
- **[Nominatim](https://nominatim.openstreetmap.org/)** — geocodes typed locations
- **Google Fonts** — Fraunces (display) and JetBrains Mono (UI labels)

No API keys required — all data sources are free and open.

## Project structure

```
food-finder/
├── index.html          Main page
├── css/
│   └── styles.css      All styles (vintage almanack aesthetic)
├── js/
│   ├── cuisines.js     OSM cuisine tag → display label mapping
│   ├── utils.js        Distance calc, opening-hours parser, escaping
│   └── app.js          State, search, render, map
├── README.md
├── LICENSE
└── .gitignore
```

## Running locally

It's a static site — just open `index.html` in a browser.

For best results (some browsers restrict `fetch` on `file://`), serve it over a local HTTP server:

```bash
# Python 3
python3 -m http.server 8000

# Node
npx serve

# PHP
php -S localhost:8000
```

Then visit <http://localhost:8000>.

## Deploying to GitHub Pages

1. Push to GitHub.
2. Go to the repo's **Settings → Pages**.
3. Under "Source", choose **Deploy from a branch**.
4. Select branch `main` and folder `/ (root)`.
5. Save. Within a minute or two the site is live at `https://abumaz99.github.io/food-finder/`.

## Caveats and known limits

- **Price levels are approximated.** OSM has no price tag; we infer from amenity type (`fast_food` → £, `restaurant` → ££) and bump to ££££ on keywords like "michelin" or "fine dining". For real Google-style price tiers, swap the Overpass call for the [Google Places API](https://developers.google.com/maps/documentation/places/web-service/overview) or [Foursquare Places](https://docs.foursquare.com/developer/reference/places-api-overview) — both require API keys.
- **Opening-hours parsing is best-effort.** OSM's `opening_hours` syntax is rich; the parser handles common patterns (e.g. `Mo-Fr 09:00-17:00; Sa,Su 10:00-22:00`, `24/7`) but may show "?" for complex strings.
- **Coverage depends on OSM data quality.** Dense urban areas (London, Lisbon, Tokyo) are excellent. Smaller towns and rural areas may be sparse.
- **Favourites are session-only** in this version — they reset when you close the tab. Persisting them with `localStorage` is a small addition for a future iteration.

## Attribution

Restaurant and map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [Open Database License](https://www.openstreetmap.org/copyright).

## License

MIT — see [LICENSE](LICENSE).
