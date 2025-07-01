import React from 'react';
import NeoButton from './neo-button';
import NeoAnchorButton from './neo-a-button';
import { GithubIcon } from 'lucide-react';

const NeoCTA = () => {
  return (
    <section className="py-20 border-b-4 border-black relative z-10" style={{
      background: "linear-gradient(to right, #2b0f54, #5d1d91, #9331bf)"
    }}>
      {/* gridlines */}
      <div className="absolute inset-0 z-0" style={{
        backgroundImage: "linear-gradient(to right, rgba(255,255,255,0.1) 1px, transparent 2px), linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 2px)",
        backgroundSize: "60px 60px",
        transform: "perspective(500px) rotateX(60deg)",
        transformOrigin: "bottom",
      }} />

      <div className="container mx-auto px-4 text-center">
        <h2 className="text-4xl font-black mb-6 text-white">TAKE CONTROL OF YOUR INTELLIGENCE</h2>
        <p className="text-xl mb-8 text-white max-w-2xl mx-auto">
          Keep AI transcription where it belongs — on your device.
        </p>
        <div className="mb-12 max-w-lg mx-auto bg-white p-4 rounded-lg border-2 border-white border-opacity-30">
          <p className="text-black font-bold text-sm">
            <span className="font-bold text-xl text-[#fd3777]">100% Privacy Guarantee</span><br />Your data never leaves your device.<br />No cloud processing.<br />No cloud storage.
          </p>
        </div>
        <div className="flex flex-col md:flex-row justify-center items-center gap-6">
          {(window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") ?
          <NeoButton label="Try Free" backgroundColor='#fd3777' textColor="#ffffff" />
          :
          <NeoAnchorButton href="http://www.github.com" backgroundColor='#ffffff' textColor="#000000">
            <GithubIcon />
          </NeoAnchorButton>
          }
        </div>
      </div>
            

    </section>
  );
};

export default NeoCTA;