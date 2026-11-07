# RapVideoMaker identity

The master artwork is the Play + Beat triangle with three transparent rhythm cuts. The 16px icon uses the same silhouette without the cuts.

Use `logo-horizontal-dark.svg` on dark surfaces and `logo-horizontal-light.svg` on light surfaces. The matching wordmark and symbol files are available separately. `-white` and `-black` assets are true single-color versions. Keep the logo's aspect ratio and clear space; do not add effects or recolor it outside the palette in `lib/rap/brand-tokens.ts`.

The wordmark is outlined from the repository's commercial-use Geist typeface so the exported SVGs do not depend on installed fonts. Source text is **RAPvideomaker**. The website uses these same outlined assets through `BrandLogo`.

To regenerate assets after changing the masters, run `python scripts/generate-rap-brand.py` (requires `fonttools`) followed by `node scripts/generate-rap-brand.mjs` (uses the project's existing `sharp`). The latter exports 180px and 512px PNGs, a 1200 × 630 OG PNG, and a multi-size ICO (16/32/48/64px).
