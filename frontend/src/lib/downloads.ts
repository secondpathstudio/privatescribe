// Single source of truth for the desktop-app download links on the marketing
// site. The hero CTA scrolls to the download section (id = DOWNLOAD_SECTION_ID);
// that section renders one button per platform from PLATFORM_DOWNLOADS.
//
// Links use GitHub's /releases/latest/download/ redirect, so they always resolve
// to the newest published release. CAVEAT: electron-builder bakes the version
// into each artifact filename (there's no custom `artifactName` in
// electron-builder.yml), so APP_VERSION still appears in the filenames below.
// Bump it here — in this one place — when you cut a new release. To make these
// links truly version-less (never touch this file again), add a stable
// `artifactName` per target in electron-builder.yml.

export const GITHUB_REPO = 'secondpathstudio/privatescribe';

// Keep in sync with the root package.json "version" each release.
export const APP_VERSION = '2.0.0';

// Anchor id of the download section on the home page (neo-screenshots.tsx).
export const DOWNLOAD_SECTION_ID = 'download';

const latestAsset = (filename: string) =>
  `https://github.com/${GITHUB_REPO}/releases/latest/download/${filename}`;

export type PlatformDownload = {
  os: string;
  /** Installer format shown beneath the OS name. */
  format: string;
  /** One-line OS/hardware requirement. */
  requirement: string;
  url: string;
};

// One primary download per platform. Filenames follow electron-builder's default
// artifactName for each target in electron-builder.yml:
//   dmg      → ${productName}-${version}-${arch}.dmg
//   nsis     → ${productName} Setup ${version}.exe  (GitHub encodes spaces as ".")
//   AppImage → ${productName}-${version}.AppImage
export const PLATFORM_DOWNLOADS: PlatformDownload[] = [
  {
    os: 'macOS',
    format: '.dmg',
    requirement: 'Apple Silicon (M1 or later)',
    url: latestAsset(`PrivateScribe-${APP_VERSION}-arm64.dmg`),
  },
  {
    os: 'Windows',
    format: 'Installer (.exe)',
    requirement: 'Windows 10 / 11, 64-bit',
    url: latestAsset(`PrivateScribe.Setup.${APP_VERSION}.exe`),
  },
  {
    os: 'Linux',
    format: 'AppImage',
    requirement: '64-bit, glibc-based distros',
    url: latestAsset(`PrivateScribe-${APP_VERSION}.AppImage`),
  },
];
