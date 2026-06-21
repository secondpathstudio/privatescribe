// Single source of truth for the desktop-app download links on the marketing
// site. The hero CTA scrolls to the download section (id = DOWNLOAD_SECTION_ID);
// that section renders one button per platform from PLATFORM_DOWNLOADS.
//
// Links use GitHub's /releases/latest/download/ redirect, so the path always
// resolves to the newest published release. GOAL: version-less artifact
// filenames so this file never needs touching per release — each target now sets
// a stable `artifactName` in electron-builder.yml (PrivateScribe-mac-${arch}.dmg,
// etc.). That only takes effect for releases BUILT with that config, though, so
// the current release still ships electron-builder's default, version-stamped
// names. Until a stable-named build is published, we pin DOWNLOAD_VERSION to the
// latest release's tag so the live buttons resolve instead of 404'ing.
//
// AFTER the next release is published with the stable artifactName, delete
// DOWNLOAD_VERSION and switch the filenames below to the version-less names:
//   PrivateScribe-mac-arm64.dmg / PrivateScribe-win-x64.exe / PrivateScribe-linux-x64.AppImage

export const GITHUB_REPO = 'secondpathstudio/privatescribe';

// Interim — the latest published release uses version-stamped artifact names.
// Bump to match the newest release's tag until the stable-named build ships,
// then this constant goes away (see header).
const DOWNLOAD_VERSION = '2.0.1';

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

// One primary download per platform. Filenames follow electron-builder's DEFAULT
// (version-stamped) artifactName, matching the current release's assets:
//   dmg      → ${productName}-${version}-${arch}.dmg
//   nsis     → ${productName} Setup ${version}.exe   (GitHub encodes spaces as ".")
//   AppImage → ${productName}-${version}.AppImage
export const PLATFORM_DOWNLOADS: PlatformDownload[] = [
  {
    os: 'macOS',
    format: '.dmg',
    requirement: 'Apple Silicon (M1 or later)',
    url: latestAsset(`PrivateScribe-${DOWNLOAD_VERSION}-arm64.dmg`),
  },
  {
    os: 'Windows',
    format: 'Installer (.exe)',
    requirement: 'Windows 10 / 11, 64-bit',
    url: latestAsset(`PrivateScribe.Setup.${DOWNLOAD_VERSION}.exe`),
  },
  {
    os: 'Linux',
    format: 'AppImage',
    requirement: '64-bit, glibc-based distros',
    url: latestAsset(`PrivateScribe-${DOWNLOAD_VERSION}.AppImage`),
  },
];
