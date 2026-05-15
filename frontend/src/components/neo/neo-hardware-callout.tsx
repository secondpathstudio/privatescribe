type Tier = {
  label: string;
  name: string;
  subtitle: string;
  specs: { label: string; value: string }[];
  examples: string;
  featured?: boolean;
  dark?: boolean;
};

const tiers: Tier[] = [
  {
    label: 'Minimum',
    name: 'Light use',
    subtitle: 'Short transcripts, Gemma 4B only',
    specs: [
      { label: 'Memory', value: '16 GB' },
      { label: 'Chip', value: 'M1 / M2 / M3 base' },
      { label: 'Storage', value: '256 GB+' },
    ],
    examples: 'M1 MacBook Air 16GB · M2 Mac mini 16GB · M3 MacBook Air 16GB',
  },
  {
    label: 'Recommended',
    name: 'Daily driver',
    subtitle: 'Full stack, comfortable inference',
    specs: [
      { label: 'Memory', value: '24–32 GB' },
      { label: 'Chip', value: 'M-series Pro' },
      { label: 'Storage', value: '512 GB+' },
    ],
    examples: 'M4 Pro Mac mini 24GB · M3 Pro MacBook Pro 18GB · M2 Pro Mac mini 32GB',
    featured: true,
  },
  {
    label: 'Ideal',
    name: 'No compromises',
    subtitle: 'Fast inference, larger models',
    specs: [
      { label: 'Memory', value: '32 GB+' },
      { label: 'Chip', value: 'M-series Max' },
      { label: 'Storage', value: '1 TB+' },
    ],
    examples: 'M1/M2/M3/M4 Max MacBook Pro · Mac Studio M2 Max',
    dark: true,
  },
];

const NeoHardwareCallout = () => {
  return (
    <div className="mt-12 max-w-6xl mx-auto">
      {/* Header */}
      <div className="text-center mb-10 max-w-2xl mx-auto">
        <span className="inline-block bg-black text-[#fd3777] px-3 py-1 text-xs font-black uppercase tracking-widest mb-4">
          ◆ Recommended hardware
        </span>
        <h3 className="text-3xl md:text-4xl font-black uppercase leading-none mb-3">
          Real local AI needs real hardware
        </h3>
        <p className="text-base">
          PrivateScribe runs entirely on your machine — no cloud, no API keys, no
          data leaving your network. That power comes from your own silicon.
          Here's what runs it well.
        </p>
      </div>

      {/* Tiers */}
      <div className="grid md:grid-cols-3 gap-6">
        {tiers.map((tier) => (
          <div
            key={tier.label}
            className={`relative border-4 border-black p-6 pt-9 ${
              tier.dark ? 'bg-black text-white' : 'bg-white'
            }`}
            style={{
              boxShadow: tier.featured
                ? '8px 8px 0px 0px #fd3777'
                : '4px 4px 0px 0px rgba(0,0,0,1)',
            }}
          >
            {/* Tier label badge */}
            <span
              className={`absolute -top-1 -left-1 border-2 border-black px-3 py-1 text-[10px] font-black uppercase tracking-wider ${
                tier.featured
                  ? 'bg-[#fd3777] text-black'
                  : tier.dark
                  ? 'bg-white text-black'
                  : 'bg-black text-white'
              }`}
            >
              {tier.label}
            </span>

            <div className="mb-4">
              <div className="text-2xl font-black uppercase leading-tight">
                {tier.name}
              </div>
              <div
                className={`text-sm mt-1 ${
                  tier.dark ? 'text-gray-300' : 'text-gray-600'
                }`}
              >
                {tier.subtitle}
              </div>
            </div>

            {/* Specs */}
            <div
              className={`flex flex-col gap-2 border-t-2 pt-3 ${
                tier.dark ? 'border-white' : 'border-black'
              }`}
            >
              {tier.specs.map((spec) => (
                <div key={spec.label} className="flex justify-between text-sm">
                  <span
                    className={`font-semibold ${
                      tier.dark ? 'text-gray-400' : 'text-gray-600'
                    }`}
                  >
                    {spec.label}
                  </span>
                  <span className="font-black">{spec.value}</span>
                </div>
              ))}
            </div>

            {/* Examples */}
            <div
              className={`mt-4 pt-3 border-t-2 border-dashed ${
                tier.dark ? 'border-gray-600' : 'border-gray-300'
              }`}
            >
              <div
                className={`text-[10px] font-black uppercase tracking-wider mb-1 ${
                  tier.dark ? 'text-[#fd3777]' : 'text-gray-500'
                }`}
              >
                For example
              </div>
              <div
                className={`text-xs leading-relaxed ${
                  tier.dark ? 'text-gray-300' : 'text-gray-700'
                }`}
              >
                {tier.examples}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Mac mini server callout */}
      <div
        className="mt-8 border-4 border-black bg-white p-6 flex items-center gap-5"
        style={{ boxShadow: '8px 8px 0px 0px rgba(0,0,0,1)' }}
      >
        <div className="text-5xl shrink-0">🖥️</div>
        <div>
          <div className="text-xs font-black uppercase tracking-wider text-[#fd3777] mb-1">
            Pro tip
          </div>
          <div className="text-lg font-black uppercase leading-tight mb-1">
            A Mac mini makes a great shared PrivateScribe server.
          </div>
          <p className="text-sm">
            For a clinic, firm, or small team: a Mac mini Pro in the supply
            closet runs quietly, sips power, and serves the whole office over
            your local network. Easy to physically isolate for air-gapped
            setups.
          </p>
        </div>
      </div>

      {/* Footnotes */}
      <p className="text-xs text-gray-500 text-center mt-6 max-w-3xl mx-auto leading-relaxed">
        Tested with Whisper base + pyannote + Gemma 4B / Mistral 7B at Q4
        quantization. Intel Macs, older M1 8GB models, and the MacBook Neo
        (8GB) can run lighter configurations but aren't recommended for daily
        clinical use. Windows and Linux support via llama.cpp.
      </p>
    </div>
  );
};

export default NeoHardwareCallout;
