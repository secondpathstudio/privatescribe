export default function Og() {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-8 font-sans">
      <div className="space-y-3">
        <div className="text-xs font-mono text-gray-600 uppercase tracking-wider">
          1200 × 630 — open in a window ≥1280px wide, screenshot the card below, crop to its outer border
        </div>

        <div
          className="relative border-4 border-black overflow-hidden"
          style={{
            width: '1200px',
            height: '630px',
            background: 'linear-gradient(to right, #2b0f54, #5d1d91, #fd3777)',
            boxShadow: '12px 12px 0px 0px rgba(0,0,0,1)',
          }}
        >
          {/* Subtle grid pattern */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 2px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 2px)',
              backgroundSize: '60px 60px',
            }}
          />

          {/* Top-right pills — stacked */}
          <div className="absolute top-12 right-12 z-10 flex flex-col items-end gap-2">
            <div className="border-2 border-white text-white font-bold text-sm px-3 py-1 uppercase tracking-wider bg-black/30">
              100% Offline
            </div>
            <div className="border-2 border-white text-white font-bold text-sm px-3 py-1 uppercase tracking-wider bg-black/30">
              256-Bit Encrypted
            </div>
          </div>

          {/* Content column — wordmark, headline, audience sub-line */}
          <div className="relative h-full p-12 flex flex-col justify-between z-10">
            <div className="font-black text-3xl tracking-wider">
              <span className="text-white">Private</span>
              <span style={{ color: '#fd3777' }}>Scribe</span>
              <span className="text-white">.ai</span>
            </div>

            <h1
              className="text-white font-extrabold uppercase leading-[0.95] tracking-tight"
              style={{ fontSize: '100px' }}
            >
              Private Conversations<br />
              Deserve <span style={{ color: '#fd3777' }}>Private AI</span>
            </h1>

            <p className="text-white text-2xl font-bold leading-snug max-w-5xl">
              Fully local AI transcription for clinicians, therapists, attorneys &mdash; and anyone with conversations worth keeping quiet.
            </p>
          </div>
        </div>

        <div className="text-xs font-mono text-gray-500 max-w-[1200px]">
          Tip: macOS <kbd>⌘⇧4</kbd> then space-bar to capture a window, or drag a precise rect. Final asset goes at <code>frontend/public/og-card.png</code>.
        </div>
      </div>
    </div>
  );
}
