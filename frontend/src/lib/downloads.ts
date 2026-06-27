// Single source of truth for the desktop-app download links on the marketing
// site. The hero CTA scrolls to the download section (id = DOWNLOAD_SECTION_ID);
// that section renders one button per platform from PLATFORM_DOWNLOADS.
//
// Links use GitHub's /releases/latest/download/ redirect with version-less
// artifact filenames, so this file never needs touching per release. Each build
// target sets a stable `artifactName` in electron-builder.yml:
//   dmg      → PrivateScribe-mac-arm64.dmg
//   nsis     → PrivateScribe-win-x64.exe
//   appImage → PrivateScribe-linux-x86_64.AppImage   (AppImage arch token is x86_64, not x64)
// As long as the newest published release includes those assets, the buttons
// resolve to the latest build. (First stable-named release: v2.0.2.)

export const GITHUB_REPO = 'secondpathstudio/privatescribe';

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

// One primary download per platform, using electron-builder's stable
// (version-less) artifactName — see electron-builder.yml. macOS ships Apple
// Silicon only (arm64); Windows and Linux are x64.
export const PLATFORM_DOWNLOADS: PlatformDownload[] = [
  {
    os: 'macOS',
    format: '.dmg',
    requirement: 'Apple Silicon (M1 or later)',
    url: latestAsset('PrivateScribe-mac-arm64.dmg'),
  },
  {
    os: 'Windows',
    format: 'Installer (.exe)',
    requirement: 'Windows 10 / 11, 64-bit',
    url: latestAsset('PrivateScribe-win-x64.exe'),
  },
  {
    os: 'Linux',
    format: 'AppImage',
    requirement: '64-bit, glibc-based distros',
    // NOTE: electron-builder renders ${arch} as 'x86_64' for the AppImage
    // target (AppImage convention), not 'x64' like the Windows nsis target.
    url: latestAsset('PrivateScribe-linux-x86_64.AppImage'),
  },
];
