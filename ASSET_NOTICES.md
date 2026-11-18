# Visual Asset Sources

## GitHub repository mark

The GitHub mark in `src/components/SystemUpdates.tsx` identifies the link to
the project's GitHub repository. GitHub and the Invertocat mark are trademarks
of GitHub, Inc. Brand reference: https://github.com/logos.
The inline SVG is served with the application and requires no external image request.

## Bundled default avatars

The 24 PNG avatars in `public/assets/avatars/` are unmodified **Fluent Emoji 3D**
artwork, © Microsoft Corporation, distributed under the MIT license. They were
selected as animal, nature and playful account pictures for this desktop UI;
they are not Apple-provided macOS artwork.

- Source: https://github.com/microsoft/fluentui-emoji
- Pinned revision: `1ffb34c752ecf5d402f04cfb4b392c77f57c54bc`
- Full upstream license: [`public/assets/avatars/LICENSE.txt`](public/assets/avatars/LICENSE.txt)
- Individual upstream paths and SHA-256 checksums: [`public/assets/avatars/catalog.json`](public/assets/avatars/catalog.json)
- Reproducible collector: `node scripts/collect-avatars.mjs`

All avatar files and their catalog are served locally. The matching catalog in
`server/avatar_catalog.json` is embedded in the API binary as an avatar-only
allowlist. No external avatar service is needed at runtime.

## User-supplied default wallpapers

Seven wallpapers were supplied by the user and are bundled in
`public/assets/wallpapers` with their original bytes and recorded checksums.
No separate license or upstream attribution was supplied for this collection;
the ThanasOS MIT notice below does not apply to it.

| Supplied file | Bundled file under `public/assets/wallpapers` | Details |
| --- | --- | --- |
| 春至.mp4 | spring.mp4 | Unmodified H.264, 1920 × 1080, 30 fps, 10.63 seconds, no audio track |
| 咖啡.jpg | coffee.jpg | Unmodified JPEG, 3840 × 2560 |
| 卡通.jpg | cartoon.jpg | Unmodified JPEG, 3840 × 2160 |
| 蜡笔小新.png | shin-chan.jpg | Unmodified bytes; actual format is JPEG, 2730 × 1535, so the extension is corrected |
| 海边.jpg | seaside.jpg | Unmodified JPEG, 6016 × 3384 |
| 霞光.jpg | sunset-glow.jpg | Unmodified JPEG, 1920 × 1280 |
| 雪山.jpg | snow-mountain.jpg | Unmodified JPEG, 1920 × 1285 |

`spring-poster.jpg` is a JPEG extracted from the video's first frame for the
picker, initial display and playback-error fallback. Source mappings, dimensions,
file sizes and SHA-256 checksums are recorded in
[`public/assets/wallpapers/import-report.json`](public/assets/wallpapers/import-report.json).
`python scripts/import-wallpapers.py` imports available sources and verifies/reuses
previously archived files when their source files are absent. Pillow is required.
`--inspect` describes available source images without writing; `--check` verifies
the complete bundled collection and report. Pass `--ffmpeg PATH` only when the
video changes or its poster needs generation. These tools are not runtime or
Docker build dependencies.

## Bundled search engine icons

The default Google, Twitter, Baidu and Bing icons are served only from
`public/assets/icons/`; the application makes no external request for these images.
Google reuses `google-icon-new.png` from the ThanasOS collection described below.
The other three SVG paths come from **Simple Icons 11.15.0**, under CC0 1.0 Universal:

| Local file | Pinned source | Added fill color |
| --- | --- | --- |
| `twitter.svg` | https://cdn.jsdelivr.net/npm/simple-icons@11.15.0/icons/twitter.svg | `#1DA1F2` |
| `baidu.svg` | https://cdn.jsdelivr.net/npm/simple-icons@11.15.0/icons/baidu.svg | `#2932E1` |
| `bing.svg` | https://cdn.jsdelivr.net/npm/simple-icons@11.15.0/icons/microsoftbing.svg | `#008373` |

Only explicit fill colors and a trailing newline are added; path geometry is unchanged.
The full upstream license is bundled at
[`public/assets/icons/simple-icons-LICENSE.md`](public/assets/icons/simple-icons-LICENSE.md).
Source project: https://github.com/simple-icons/simple-icons.
Brand names and marks remain the property of their respective owners.
`node scripts/collect-icons.mjs` reuses these local files, fetches missing SVGs from
the pinned sources, and includes all three in the public catalog and API allowlist.

## Original desktop icons and wallpapers

The original three default wallpapers and macOS-style Dock icons are bundled locally in
`public/assets` and served from `/assets/`; no runtime GitHub access is required.
They originate from the public
[ThanasOS repository](https://github.com/Thanas-R/Thanas-OS), © 2026 Thanas R.
Their repository includes the following MIT license notice. Verify the license
of any third-party images or icons before redistribution or commercial use.

## Local asset provenance

Retrieved from the upstream live deployment at https://thanasos.thanas.dev,
whose `/assets/index-PU8HcIpj.js` references the resources below. The matching
source names were confirmed in the GitHub `src/assets` directory via its public
API. Direct raw.githubusercontent.com requests timed out in the repair environment.
The bytes are unmodified; the three upstream `.jpg` files have PNG signatures,
so their local extensions are corrected to `.png`.

| Local file under `public/assets` | Original live URL |
| --- | --- |
| finder-icon.png | https://thanasos.thanas.dev/assets/finder-icon-IZz6vORp.png |
| launchpad-icon.png | https://thanasos.thanas.dev/assets/launchpad-icon-SygrAZyf.png |
| safari-icon.png | https://thanasos.thanas.dev/assets/safari-icon-DmWifTLR.png |
| settings-icon.png | https://thanasos.thanas.dev/assets/settings-icon-C6aMVGiU.png |
| appstore-icon.png | https://thanasos.thanas.dev/assets/appstore-icon-CQ25EaFK.png |
| projects-icon.png | https://thanasos.thanas.dev/assets/projects-icon-UQtJpvrU.png |
| wallpaper-mountain.png | https://thanasos.thanas.dev/assets/wallpaper-mountain-DcPyjnHv.jpg |
| wallpaper-bigsur.png | https://thanasos.thanas.dev/assets/wallpaper-bigsur-C-N6uGxi.jpg |
| wallpaper-aurora.png | https://thanasos.thanas.dev/assets/wallpaper-aurora-C4Ed5SXT.jpg |

## Upstream MIT notice

The image picker adds 16 PNG files from the same repository under
`public/assets/icons`, alongside the existing six bundled icons. Source filenames
and original URLs are recorded by `scripts/collect-icons.mjs`; their base is
`https://raw.githubusercontent.com/Thanas-R/Thanas-OS/main/src/assets/`.
These include AirDrop, Music, Calculator, Calendar, Contacts, Maps, Notes,
Terminal, Trash, User Profile, Folder, Document, GitHub, Google, LinkedIn and VS Code.
The repository's MIT notice is reproduced below; product names and brand marks
remain the property of their respective owners and imply no affiliation.

The other 55 icons are SVG exports from the installed `lucide-react` package.
Its complete ISC/Feather MIT notices are distributed at
[`public/assets/icons/lucide-LICENSE.txt`](public/assets/icons/lucide-LICENSE.txt).
Copyright for Feather portions: Cole Bemis 2013–2023; other Lucide portions:
Lucide Contributors 2025. Export changes: 64px size, 1.65 stroke width and a blue
stroke color. Source: https://github.com/lucide-icons/lucide.

`public/assets/icons/catalog.json` records the local URL, name and category of
each of the 152 selectable images (77 original icons, three search icons and 72 imported icons).
No remote image request is needed at runtime.

### User-supplied macOS 27 style collection

The user supplied a 95-file export from https://macos27.kimi.page/ captured on
2026-11-16. Its PNG images were rendered at 4× scale; sidebar SVGs were exported
from the page. The original source description and manifest are preserved in
`public/assets/icons/macos27/source-README.md` and `source-manifest.json`.
These are website-rendered iOS-style designs, not an official Apple icon pack.
The supplied export did not include a separate license grant; this provenance
record does not assign the ThanasOS MIT license to the imported artwork.

The import retains 72 icons: 17 PNG/SVG pairs use the SVG, and six repeated
silhouettes reuse an existing icon. Identical decoded PNG pixels and SVG shape
geometry are compared; differently drawn icons with the same application name
remain available as separate styles. All 95 source-to-target mappings and file
SHA-256 checksums are recorded in `public/assets/icons/macos27/import-report.json`.
Sidebar SVGs identify Lucide in their source markup; the bundled Lucide license
notices linked above remain included.

`scripts/import-macos27-icons.py` performs the import and verification (Pillow
required). `node scripts/collect-icons.mjs` also preserves this collection when
regenerating the main catalog and the API's embedded allowlist.

```
MIT License

Copyright (c) 2026 Thanas R

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The default site identity is the project artwork in `public/assets/brand-logo.svg`.
