import { Zap, Shield, Cpu, Settings, Rocket } from 'lucide-react';
import RoadmapPhase from '@/components/neo/neo-roadmap-phase';
import NeoButton from '@/components/neo/neo-button';
import NeoFooter from '@/components/neo/neo-footer';

const Roadmap = () => {
  const roadmapItems = [
    {
      phase: "PHASE 1",
      title: "CORE FOUNDATION",
      status: "completed",
      items: [
        { text: "Local AI Model Integration", completed: true },
        { text: "Basic Speech-to-Text Engine", completed: true },
        { text: "Privacy-First Architecture", completed: true },
        { text: "Local database structure", completed: true }
      ],
      gradient: "linear-gradient(135deg, #fd3777, #ff6b9d)",
      icon: <Shield className="w-8 h-8" />
    },
    {
      phase: "PHASE 2",
      title: "ENHANCED ACCURACY",
      status: "completed",
      items: [
        { text: "Custom template creation", completed: true },
        { text: "Save and record participants (regular patients, clients, etc.)", completed: true },
        { text: "Custom Model Training", completed: true },
      ],
      gradient: "linear-gradient(135deg, #5d1d91, #9d4edd)",
      icon: <Settings className="w-8 h-8" />
    },
    {
      phase: "PHASE 3",
      title: "ADVANCED FEATURES",
      status: "upcoming",
      items: [
        { text: "Feedback and Sentiment Extraction", completed: true },
        { text: "On-the-fly model selection", completed: false },
        { text: "Transcription time-stamps", completed: false },
        { text: "Speaker Identification", completed: false },
      ],
      gradient: "linear-gradient(135deg, #2b0f54, #5d1d91)",
      icon: <Zap className="w-8 h-8" />
    },
    {
      phase: "PHASE 4",
      title: "PROFESSIONAL SUITE",
      status: "planned",
      items: [
        { text: "Enterprise Dashboard", completed: false },
        { text: "Team Collaboration Tools", completed: false },
        { text: "Advanced Analytics", completed: false }
      ],
      gradient: "linear-gradient(135deg, #ff9900, #ffff00)",
      icon: <Cpu className="w-8 h-8" />
    },
    {
      phase: "PHASE 5",
      title: "ECOSYSTEM EXPANSION",
      status: "future",
      items: [
        { text: "Native mobile app", completed: false },
      ],
      gradient: "linear-gradient(135deg, #fd3777, #ff9900)",
      icon: <Rocket className="w-8 h-8" />
    }
  ];

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="py-16 border-b-4 border-black" style={{
        background: "linear-gradient(to right, #2b0f54, #5d1d91, #fd3777)"
      }}>
        <div className="container mx-auto px-4">
          <div className="text-center">
            <h1 className="text-5xl md:text-7xl font-black text-white mb-2 leading-tight">
              DEVELOPMENT
            </h1>
            <h2 className="text-3xl md:text-5xl font-black text-white mb-8 leading-tight">
              ROADMAP
            </h2>
            <p className="text-md md:text-xl text-white max-w-3xl mx-auto">
              Follow our journey to build the ultimate, completely private AI transcription tool.
            </p>
          </div>
        </div>
      </header>

      {/* Roadmap Timeline */}
      <main className="py-20">
        <div className="container mx-auto px-4">
          <div className="relative">
                        
            {roadmapItems.map((phase, index) => (
              <RoadmapPhase
                key={index}
                phase={phase.phase}
                title={phase.title}
                status={phase.status}
                items={phase.items}
                gradient={phase.gradient}
                icon={phase.icon}
                index={index} />
            ))}
          </div>
        </div>
      </main>
      <footer className="py-16 border-y-4 border-black" style={{
        background: "linear-gradient(to right, #fd3777, #ff9900, #ffff00)"
      }}>
        <div className="container mx-auto px-4 text-center">
          <h3 className="text-4xl md:text-6xl font-black text-black mb-6">
            STAY UPDATED
          </h3>
          <p className="text-xl text-black mb-8 max-w-2xl mx-auto">
            Follow our progress and be the first to know when new features drop.
          </p>
          <a href="https://github.com/secondpathstudio/privatescribe">
          <NeoButton>
            WATCH ON GITHUB
          </NeoButton>
          </a>
        </div>
      </footer>
      <NeoFooter />
    </div>
  );
};

export default Roadmap;