import React from 'react';
import NeoButton from './neo-button';

const NeoCTA = () => {
  return (
    <section className="py-20 border-b-4 border-black" style={{
      background: "linear-gradient(to right, #2b0f54, #5d1d91, #9331bf)"
    }}>
      <div className="container mx-auto px-4 text-center">
        <h2 className="text-4xl font-black mb-6 text-white">TAKE CONTROL OF YOUR TRANSCRIPTIONS</h2>
        <p className="text-xl mb-8 text-white max-w-2xl mx-auto">
          Bring AI transcription where it belongs — on your device.
        </p>
        <div className="flex flex-col md:flex-row justify-center items-center gap-6">
          <NeoButton label="Get Started" />
        </div>
        <div className="mt-12 max-w-lg mx-auto bg-white bg-opacity-10 p-4 rounded-lg border-2 border-white border-opacity-30">
          <p className="text-black text-sm">
            <span className="font-bold">100% Privacy Guarantee</span><br />Your audio never leaves your device. No cloud processing. No data collection.<span className='align-text-top text-sm'>*</span>
          </p>
        </div>
      </div>
    </section>
  );
};

export default NeoCTA;