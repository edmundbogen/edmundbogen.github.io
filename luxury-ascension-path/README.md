# The Luxury Ascension Path

A 6-level gamified course teaching agents how to break into luxury real estate. Self-contained single-page app (`index.html`), zero dependencies, Edmund Bogen brand.

**Live URL (after deploy):** https://edmundbogen.github.io/luxury-ascension-path/

## The 6 Levels
1. The Luxury Mindset & Positioning
2. Country Clubs & Gated Communities
3. Luxury Marketing Standards
4. High-Net-Worth Communication
5. Pricing Trophy Properties
6. Winning the Luxury Listing Interview (capstone)

Each level = teaching content → 5-question quiz (4/5 = 80% to pass) → field-mission checkbox. A level completes only when the quiz is passed **and** the mission is checked; that unlocks the next level and clears its padlock. Finishing all six shows a personalized completion certificate.

## How it works
- **Entry gate** captures name + email (powers the certificate + lead capture).
- **Progress** persists in `localStorage` (`luxuryAscension_v1`), with a memory-only fallback so it never breaks in private browsing.
- **No backend required** — it runs entirely client-side.

## TODO before going live
1. **Lead capture endpoint.** Open `index.html`, find `const LEAD_ENDPOINT = "";` near the top of the `<script>` and paste your Formspree endpoint (e.g. `https://formspree.io/f/xxxxxxx`). Until set, capture is a graceful no-op — the course still works, it just won't POST leads.
2. **Certificate CTA link.** The certificate's "Explore the Mastermind" button points to `https://www.edmundbogen.com` — swap for the exact page you want.
3. **Deploy:** commit + push to `edmundbogen.github.io` main → GitHub Pages auto-serves.

## Swapping in your own teaching content
All lesson copy, quiz questions/answers, and field missions live in the single `LEVELS` array in `index.html`. Each level object has:
- `teach` — the teaching HTML
- `quiz` — 5 objects `{ q, o:[4 options], a: correctIndex }`
- `mission` — `{ title, desc, label, sub }`

Edit those fields to drop in your outlines; nothing else needs to change.
