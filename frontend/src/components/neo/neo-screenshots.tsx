import NeoButton from './neo-button';
import NeoHardwareCallout from './neo-hardware-callout';
import { GithubIcon } from 'lucide-react';

type Props = {
  onNotifyClick: () => void;
};

type Screenshot = {
  slug: string;
  title: string;
  caption: string;
  alt: string;
  gradient: string;
};

const screenshots: Screenshot[] = [
  {
    slug: 'notes-list',
    title: 'Every conversation in one place',
    caption: 'Sortable, searchable list of every transcript and generated note. Soft-delete keeps mistakes recoverable.',
    alt: 'PrivateScribe notes list page with multiple notes sorted by date',
    gradient: 'linear-gradient(135deg, #2b0f54, #5d1d91)',
  },
  {
    slug: 'note-view',
    title: 'Raw transcript, formatted note, one screen',
    caption: "The Whisper transcript on one side, the AI-formatted note on the other. Both editable. Both encrypted on disk.",
    alt: 'Single note view showing raw transcript and markdown-formatted note side by side',
    gradient: 'linear-gradient(135deg, #5d1d91, #fd3777)',
  },
  {
    slug: 'audio-playback',
    title: 'Audio playback inside every note',
    caption: 'When the exact wording matters, scrub back to the original recording — encrypted on disk, never uploaded.',
    alt: 'Audio playback bar inside a note, showing waveform and time scrubber',
    gradient: 'linear-gradient(135deg, #fd3777, #ff9900)',
  },
  {
    slug: 'diarization',
    title: 'Knows who said what',
    caption: 'For multi-person conversations, transcripts are labeled by speaker — clinician, client, intake nurse, whoever was in the room.',
    alt: 'Speaker-labeled transcript with Clinician and Client turns alternating',
    gradient: 'linear-gradient(135deg, #ff9900, #ffff00)',
  },
  {
    slug: 'template-editor',
    title: 'Templates do the heavy lifting',
    caption: 'Design a template once and apply it to any recording. SOAP notes, intake summaries, progress notes — whatever shape your work needs.',
    alt: 'Template editor with markdown skeleton and bracketed instruction fields',
    gradient: 'linear-gradient(135deg, #9d4edd, #00ffff)',
  },
  {
    slug: 'admin-audit',
    title: 'A self-watching audit log',
    caption: 'Every login, password reset, role change, and key access is recorded — with a security alert when an admin views the encryption key.',
    alt: 'Admin audit log showing timestamped entries with a highlighted key-access alert',
    gradient: 'linear-gradient(135deg, #2b0f54, #fd3777)',
  },
];

const NeoScreenshots = ({ onNotifyClick }: Props) => {
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
            return (
              <div key={shot.slug} className="grid md:grid-cols-2 gap-8 items-center">
                <div className={imageFirst ? '' : 'md:order-2'}>
                  <div
                    className="aspect-video border-4 border-black overflow-hidden"
                    style={{
                      background: shot.gradient,
                      boxShadow: '8px 8px 0px 0px rgba(0,0,0,1)',
                    }}
                  >
                    <img
                      src={`/screenshots/${shot.slug}.png`}
                      alt={shot.alt}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                      }}
                    />
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
          className="mt-24 border-4 border-black p-8 bg-gray-50 max-w-6xl mx-auto"
          style={{ boxShadow: '8px 8px 0px 0px rgba(0,0,0,1)' }}
        >
          <h3 className="text-3xl md:text-4xl font-black mb-2 text-center">GET IT ON YOUR MACHINE</h3>
          <p className="text-base md:text-lg text-center mb-8 max-w-2xl mx-auto">
            PrivateScribe is open source. You can run it today if you're comfortable with a terminal — a standalone download-and-install app is in development for everyone else.
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
                Interested in a standalone Mac or Windows app you can download and install? It's currently in development — tell us about your workflow and we'll be in touch with more details.
              </p>
              <NeoButton onClick={onNotifyClick} backgroundColor="#fd3777" textColor="#ffffff">
                Contact us
              </NeoButton>
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
