import React from 'react';
import { CheckCircle, Circle } from 'lucide-react';

// TypeScript interface for the component props
interface RoadmapPhaseProps {
  phase: string;
  title: string;
  status: string; // 'completed' | 'in-progress' | 'upcoming' | 'planned' | 'future'
  items: Array<{
    text: string;
    completed: boolean;
  }>;
  gradient: string;
  icon: React.ReactNode;
  index: number;
}

const RoadmapPhase = ({ 
  phase, 
  title, 
  status, 
  items, 
  gradient, 
  icon, 
  index 
}: RoadmapPhaseProps) => {
  
  const getStatusColor = (status: String) => {
    switch (status) {
      case 'completed': return '#00ff88';
      case 'in-progress': return '#fd3777';
      case 'upcoming': return '#ff9900';
      case 'planned': return '#5d1d91';
      case 'future': return '#2b0f54';
      default: return '#ffffff';
    }
  };

  const getStatusText = (status: String) => {
    switch (status) {
      case 'completed': return 'COMPLETED';
      case 'in-progress': return 'IN PROGRESS';
      case 'upcoming': return 'UPCOMING';
      case 'planned': return 'PLANNED';
      case 'future': return 'FUTURE';
      default: return 'UNKNOWN';
    }
  };

  return (
    <div className={`relative mb-16 ${index % 2 === 0 ? 'md:pr-1/2' : 'md:pl-1/2 md:ml-auto'}`}>      
      {/* Phase Card */}
      <div className={`md:ml-0 ${index % 2 === 0 ? 'md:mr-16' : 'md:ml-16'}`}>
        <div 
          className="border-4 border-black p-8 relative"
          style={{
            background: gradient,
            boxShadow: "12px 12px 0px 0px rgba(0,0,0,1)"
          }}
        >
          {/* Status Badge */}
          <div 
            className="absolute -top-4 -right-4 px-4 py-2 bg-black border-4 border-black text-white font-black text-sm"
            style={{ backgroundColor: getStatusColor(status) }}
          >
            {getStatusText(status)}
          </div>
          
          {/* Phase Header */}
          <div className="flex items-center gap-4 mb-6">
            <div className="p-3 bg-black text-white border-2 border-white">
              {icon}
            </div>
            <div>
              <h3 className="text-lg md:text-xl font-black text-white mb-1">{phase}</h3>
              <h4 className="text-xl md:text-3xl font-black text-white">{title}</h4>
            </div>
          </div>
          
          {/* Feature List */}
          <div className="space-y-3">
            {items.map((item, itemIndex) => (
              <div key={itemIndex} className="flex items-center gap-3 p-3 bg-black bg-opacity-20 border-2 border-white">
                {item.completed ? (
                  <CheckCircle className="w-6 h-6 text-green-400 flex-shrink-0" />
                ) : (
                  <Circle className="w-6 h-6 text-white flex-shrink-0" />
                )}
                <span className={`text-sm md:text-lg text-white font-bold ${item.completed ? 'line-through opacity-75' : ''}`}>
                  {item.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoadmapPhase;

// Example usage:
/*
import { Shield } from 'lucide-react';

<RoadmapPhase
  phase="PHASE 1"
  title="CORE FOUNDATION"
  status="completed"
  items={[
    { text: "Local AI Model Integration", completed: true },
    { text: "Basic Speech-to-Text Engine", completed: true },
    { text: "Privacy-First Architecture", completed: true },
    { text: "Offline Processing Core", completed: true }
  ]}
  gradient="linear-gradient(135deg, #fd3777, #ff6b9d)"
  icon={<Shield className="w-8 h-8" />}
  index={0}
/>
*/