import { useState } from 'react';
import NeoHardwareCallout from './neo-hardware-callout';
import { GithubIcon, DownloadIcon } from 'lucide-react';
import { PLATFORM_DOWNLOADS, DOWNLOAD_SECTION_ID } from '@/lib/downloads';

type Props = {
  onNotifyClick: () => void;
};

type Screenshot = {
  slug: string;
  title: string;
  caption: string;
  alt: string;
  gradient: string;
  media?: 'image' | 'video';
};

const screenshots: Screenshot[] = [
  {
    slug: 'template-edit',
    title: 'Templates do the heavy lifting',
    caption: 'Design a template once and apply it to any recording. SOAP notes, intake summaries, progress notes — whatever shape your work needs.',
    alt: 'Template editor with markdown skeleton and bracketed instruction fields',
    gradient: 'linear-gradient(135deg, #9d4edd, #00ffff)',
    media: 'video',
  },
  {
    slug: 'live-transcription',
    title: 'Watch the transcript appear as you talk',
    caption: 'Record in real time and the words land on screen the moment they are spoken — no upload, no waiting for a file to process.',
    alt: 'Live transcription view with words appearing on screen as a recording runs',
    gradient: 'linear-gradient(135deg, #fd3777, #ff9900)',
    media: 'video',
  },
  {
    slug: 'signing-note',
    title: 'Draft, finalize, sign.',
    caption: 'A note moves draft → finalized → signed. Once signed it\'s immutable; corrections are appended as dated addenda, never silent edits.',
    alt: 'Note status workflow showing a signed, locked note with an addendum below it',
    gradient: 'linear-gradient(135deg, #5d1d91, #fd3777)',
    media: 'video',
  },
  {
    slug: 'diarization-example',
    title: 'Knows who said what',
    caption: 'For multi-person conversations, transcripts are labeled by speaker — clinician, client, intake nurse, whoever was in the room.',
    alt: 'Speaker-labeled transcript with Clinician and Client turns alternating',
    gradient: 'linear-gradient(135deg, #ff9900, #ffff00)',
    media: 'video',
  },
  {
    slug: 'notes-list',
    title: 'Every conversation in one place',
    caption: 'Sortable, searchable list of every transcript and generated note. Soft-delete keeps mistakes recoverable.',
    alt: 'PrivateScribe notes list page with multiple notes sorted by date',
    gradient: 'linear-gradient(135deg, #2b0f54, #5d1d91)',
    media: 'video'
  },
  {
    slug: 'admin-page',
    title: 'Robust administrative controls',
    caption: 'Manage users and roles, set retention and storage policies, and require 2FA — all backed by a self-watching audit log that records every login, password reset, and key access.',
    alt: 'Admin settings area showing user management, retention policies, and the audit log',
    gradient: 'linear-gradient(135deg, #2b0f54, #fd3777)',
  },
];

const NeoScreenshots = ({ onNotifyClick }: Props) => {
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  return (
    <section id="screenshots" className="py-20 bg-white border-b-4 border-black">
      <div className="container mx-auto px-4">
        <h2 className="text-4xl font-black mb-4 text-center">SEE IT FOR REAL</h2>
        <p className="text-xl text-center mb-16 max-w-3xl mx-auto">
          Not mockups — the actual app, running on a laptop with no internet connection.
        </p>

        <div className="space-y-20 max-w-6xl mx-auto">
          {screenshots.map((shot, index) => {
            const imageFirst = index % 2 === 0;
            const hasFailed = failed[shot.slug];
            const markFailed = () => setFailed((f) => ({ ...f, [shot.slug]: true }));
            return (
              <div key={shot.slug} className="grid md:grid-cols-2 gap-8 items-center">
                <div className={imageFirst ? '' : 'md:order-2'}>
                  <div
                    className={`border-4 border-black overflow-hidden${hasFailed ? ' aspect-video' : ''}`}
                    style={{
                      background: shot.gradient,
                      boxShadow: '8px 8px 0px 0px rgba(0,0,0,1)',
                    }}
                  >
                    {hasFailed ? null : shot.media === 'video' ? (
                      <video
                        src={`/screenshots/${shot.slug}.mp4`}
                        aria-label={shot.alt}
                        className="w-full h-auto block"
                        autoPlay
                        loop
                        muted
                        playsInline
                        onError={markFailed}
                      />
                    ) : (
                      <img
                        src={`/screenshots/${shot.slug}.png`}
                        alt={shot.alt}
                        className="w-full h-auto block"
                        onError={markFailed}
                      />
                    )}
                  </div>
                </div>
                <div className={imageFirst ? '' : 'md:order-1'}>
                  <h3 className="text-2xl md:text-3xl font-black mb-3 uppercase leading-tight">
                    {shot.title}
                  </h3>
                  <p className="text-lg">{shot.caption}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Get it on your machine — honest dual-path */}
        <div
          id={DOWNLOAD_SECTION_ID}
          className="mt-24 border-4 border-black p-8 bg-gray-50 max-w-6xl mx-auto scroll-mt-24"
          style={{ boxShadow: '8px 8px 0px 0px rgba(0,0,0,1)' }}
        >
          <h3 className="text-3xl md:text-4xl font-black mb-2 text-center">GET IT ON YOUR MACHINE</h3>
          <p className="text-base md:text-lg text-center mb-8 max-w-2xl mx-auto">
            PrivateScribe is open source. Run it from source if you're comfortable with a terminal, or download the ready-to-run Mac app — everything runs on your device either way.
          </p>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="border-4 border-black p-6 bg-white">
              <h4 className="text-xl font-black mb-2 uppercase">For developers</h4>
              <p className="text-sm mb-4">
                Clone the repo and run it locally. Full source under MIT license, no telemetry, fork it if you want to.
              </p>
              <a
                href="https://github.com/secondpathstudio/privatescribe"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 border-4 border-black bg-black text-white font-bold uppercase tracking-wider px-4 py-2"
                style={{ boxShadow: '4px 4px 0px 0px #fd3777' }}
              >
                <GithubIcon size={18} /> View on GitHub
              </a>
            </div>
            <div className="border-4 border-black p-6 bg-white">
              <h4 className="text-xl font-black mb-2 uppercase">For everyone else</h4>
              <p className="text-sm mb-4">
                Download the app for your platform, open it, and start recording. No terminal, no setup — the transcription and AI both run entirely on your device.
              </p>
              <div className="flex flex-col gap-3">
                {PLATFORM_DOWNLOADS.map((d) => (
                  <a
                    key={d.os}
                    href={d.url}
                    className="flex items-center gap-3 border-4 border-black bg-[#fd3777] text-white font-bold px-4 py-3"
                    style={{ boxShadow: '4px 4px 0px 0px rgba(0,0,0,1)' }}
                  >
                    <DownloadIcon size={20} className="shrink-0" />
                    <span className="flex flex-col leading-tight text-left">
                      <span className="uppercase tracking-wider">Download for {d.os}</span>
                      <span className="text-xs font-semibold normal-case opacity-90">
                        {d.format} · {d.requirement}
                      </span>
                    </span>
                  </a>
                ))}
              </div>
              <p className="text-xs text-gray-600 mt-3">
                Using an Intel Mac or need another build?{' '}
                <button
                  type="button"
                  onClick={onNotifyClick}
                  className="underline font-semibold"
                >
                  Get in touch
                </button>
                .
              </p>
            </div>
          </div>

          {/* Recommended hardware tiers */}
          <NeoHardwareCallout />
        </div>
      </div>
    </section>
  );
};

export default NeoScreenshots;
