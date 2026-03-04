# Suzanne Damon CMA Generator

**Live URL:** [https://edmundbogen.github.io/suzanne-damon-cma.html](https://edmundbogen.github.io/suzanne-damon-cma.html)

## What This Is

A browser-based Competitive Market Analysis (CMA) generator custom-built for Suzanne Damon and The Damon Home Team at eXp Realty, New Hampshire. It uses the Claude API to generate professional, branded CMA reports written in Suzanne's voice.

## How It Works

1. Suzanne fills out a multi-step form (property details, seller context, comparable sales, market data, notes, closing costs)
2. She can upload CSV exports from PrimeMLS or paste comp data directly
3. The app calls the Claude API to generate a full HTML CMA report branded with her headshot, logo, bio, and credentials
4. The report can be exported as PDF, printed, emailed, or copied

## Features

- **6-Step Form Wizard** — Property details, seller goals, comps (CSV upload or paste), market snapshot, agent notes, closing costs
- **NH Region-Aware** — 6 regions with relevant amenity weighting and market context
- **Save & Resume** — Auto-saves drafts to localStorage every 2 seconds
- **CMA History** — Stores up to 50 completed CMAs for quick recall
- **Email to Client** — Pre-formatted email with pricing summary and Suzanne's credentials
- **Property Photo Upload** — Appears in the report header
- **PDF Export** — Opens styled print window for Save as PDF
- **Hardcoded Branding** — Suzanne's headshot and Damon Home Team logo are hosted on GitHub and automatically injected into every report
- **NH Closing Costs Calculator** — Municipality-aware seller net sheet with NH transfer tax ($7.50/$1,000), title insurance, attorney fees, recording fees, municipal lien certificates, commission calculator, mortgage payoff, and proration fields
- **Claude API Integration** — Calls Claude directly from the browser (API key stored locally, never transmitted except to Anthropic)

## Files in This Repo

| File | Purpose |
|------|---------|
| `suzanne-damon-cma.html` | The complete CMA generator app (single-file, no dependencies) |
| `suzanne-damon-headshot.jpg` | Suzanne's professional headshot (auto-injected into reports) |
| `suzanne-damon-logo.jpg` | The Damon Home Team / eXp Realty logo (auto-injected into reports) |
| `SUZANNE-DAMON-CMA-README.md` | This file |

## Setup Instructions for Suzanne

1. **Open the app:** Go to [https://edmundbogen.github.io/suzanne-damon-cma.html](https://edmundbogen.github.io/suzanne-damon-cma.html)
2. **Enter API Key:** Click "Settings" in the top right and paste your Claude API key (starts with `sk-ant-...`). This is stored only in your browser.
3. **Fill out the form:** Work through all 6 steps. Only fields marked with a gold asterisk (*) are required.
4. **Upload comps:** Export sold comparables from PrimeMLS as CSV, or paste the data directly.
5. **Closing costs (optional):** Enter the estimated sale price in Step 6 to see the seller net sheet. Toggle "Include in CMA" to add it to the report.
6. **Generate:** Click the gold "Generate CMA Report" button. Takes ~15-30 seconds.
7. **Export:** Use "Download PDF", "Print", "Email to Client", or "Copy HTML" buttons.

## Technical Details

- **Single HTML file** — No build tools, no framework, no server. Runs entirely in the browser.
- **API:** Claude API (`claude-sonnet-4-20250514`) via direct browser fetch with `anthropic-dangerous-direct-browser-access` header
- **Storage:** All data (API key, drafts, history, brand images) stored in browser localStorage
- **Images:** Headshot and logo hosted at `edmundbogen.github.io` and hardcoded into the image injection logic
- **Hosting:** GitHub Pages from the `edmundbogen/edmundbogen.github.io` repository

## Updating

To update the app, edit `suzanne-damon-cma.html` and push to the `main` branch. GitHub Pages deploys automatically within 30-60 seconds.

To update Suzanne's headshot or logo, replace the corresponding `.jpg` file in the repo and push.

## Built By

Edmund Bogen / Bogen.ai — AI consulting and automation for real estate professionals.
