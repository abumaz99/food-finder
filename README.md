# Forkward

> A wandering eater's almanack for choosing what to eat, abroad and otherwise.

Forkward helps you decide where to eat when nobody can choose. Search by GPS or typed location, filter by cuisine, price, and distance, then either browse the short list or let "Surprise Me" pick.

## Features

- **Location** — by GPS, coordinates, city, neighbourhood, or address
- **Distance filter** — adjustable from 300 m to 10 km
- **Price filter** — inferred £ to ££££ price bands
- **18 cuisine categories** — Italian, Japanese, Middle Eastern, Vegetarian, etc.
- **Google Maps view** — results displayed on a Google map
- **Surprise me** — picks one at random from your filtered results
- **Favourites** — bookmark spots for later, saved on this device

## Stack

- **Vanilla HTML / CSS / JavaScript** — no framework
- **Vercel Serverless Functions** — hides the private Google server key
- **Google Places API (New)** — nearby food spot search
- **Google Geocoding API** — typed location lookup
- **Google Maps JavaScript API** — map rendering

## Google API Setup

Create two Google Maps Platform API keys:

1. `GOOGLE_MAPS_BROWSER_KEY`
   - Used by the frontend to load Google Maps JavaScript.
   - Restrict by HTTP referrer, for example your Vercel domain.
   - Enable Maps JavaScript API.

2. `GOOGLE_MAPS_SERVER_KEY`
   - Used only by Vercel functions.
   - Do not expose this in client-side code.
   - Enable Places API (New) and Geocoding API.

Set both as Vercel environment variables.

This first pass intentionally uses a cheaper Places field mask:

```text
places.id
places.displayName
places.formattedAddress
places.location
places.primaryType
places.types
places.businessStatus
places.googleMapsUri
```

Ratings, review counts, phone numbers, websites, price levels, and opening hours are omitted for now because those fields trigger higher Places billing tiers. Price is inferred from place type, and the Open Now toggle is disabled until richer fields are enabled.

## Running Locally

Use Vercel's local dev server so the `/api` functions are available:

```bash
npx vercel dev
```

Then visit the local URL Vercel prints.

Opening `index.html` directly or serving it with a plain static server will show the frontend, but searches will fail because `/api/geocode`, `/api/places`, and `/api/config` will not exist.

## Deploying

1. Import the repo into Vercel.
2. Add `GOOGLE_MAPS_BROWSER_KEY` and `GOOGLE_MAPS_SERVER_KEY` in **Project Settings → Environment Variables**.
3. Deploy `main`.
4. Restrict the browser key to the Vercel production domain.
5. Add Google Cloud budget alerts and API quotas.

## Project Structure

```text
food-finder/
├── api/
│   ├── _google.js      Shared Google helpers and result adapter
│   ├── config.js       Public frontend config
│   ├── geocode.js      Typed location lookup
│   └── places.js       Nearby food spot search
├── css/
│   └── styles.css      Vintage almanack aesthetic
├── js/
│   ├── cuisines.js     Cuisine label → Google Places type mapping
│   ├── utils.js        Distance calculation, escaping helpers
│   └── app.js          State, search, rendering, Google Maps
├── index.html
├── README.md
└── LICENSE
```

## Caveats

- **Nearby Search returns up to 20 places per request.** That fits the "help me decide" flow, but it is not an exhaustive restaurant directory.
- **Price levels are inferred.** The cheaper field mask does not request Google's `priceLevel`.
- **Open Now is disabled.** Nearby Search (New) does not support the old `opennow` parameter, and opening-hours fields cost more.
- **Favourites are device-local.** They are stored in your browser with `localStorage`, so they do not sync across devices.

## Attribution

Place and map data are provided by Google Maps Platform.

## License

MIT — see [LICENSE](LICENSE).
