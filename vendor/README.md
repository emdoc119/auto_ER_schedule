# SheetJS browser distribution

- Version: 0.20.3, matching the pinned npm lockfile package.
- Source package: https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
- Original package path: dist/xlsx.full.min.js
- License: Apache-2.0; see SheetJS-LICENSE.txt and the retained distribution header.
- SHA-256: `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41`

The browser loads this versioned local static file. No runtime dependency on the SheetJS script CDN is required. To update, obtain the official pinned package, verify lockfile integrity and the browser artifact hash, copy its license, then run parser/ICS/browser-distribution regression tests before deployment.
