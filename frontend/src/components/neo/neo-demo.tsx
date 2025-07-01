import { useEffect, useState } from 'react';
import NeoButton from './neo-button';
import CassetteSVG from './cassette';

const NeoDemo = () => {
  const [activeStep, setActiveStep] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState('medical');
  const [isRecording, setIsRecording] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  const templates = {
    medical: {
      name: "Medical Consultation",
      emoji: "🏥",
      color: "linear-gradient(to bottom right, #00ffff, white)",
      fields: ["Chief Complaint", "History of Present Illness", "Assessment", "Plan"],
      sampleTranscript: "Patient presents with chest pain that started 2 hours ago. Pain is described as sharp, 7/10 severity, radiating to left arm. No shortness of breath or nausea.",
      processedNote: {
        "Chief Complaint": "Chest pain, 2 hours duration",
        "History of Present Illness": "Sharp pain, 7/10 severity, radiating to left arm. No associated SOB or nausea.",
        "Assessment": "Possible cardiac event - requires immediate evaluation",
        "Plan": "ECG, cardiac enzymes, chest X-ray. Monitor vitals."
      }
    },
    legal: {
      name: "Legal Consultation",
      emoji: "🧑‍⚖️",
      color: "linear-gradient(to bottom right, #ff00ff, white)",
      fields: ["Client Information", "Legal Issue", "Facts", "Action Items"],
      sampleTranscript: "Client John Smith seeking advice on contract dispute with former employer. Believes non-compete clause is unenforceable. Contract signed in California, work performed remotely.",
      processedNote: {
        "Client Information": "John Smith - employment contract dispute",
        "Legal Issue": "Non-compete clause enforceability",
        "Facts": "Contract signed in CA, remote work performed, dispute with former employer",
        "Action Items": "Review contract terms, research CA non-compete laws, schedule follow-up"
      }
    },
    personal: {
      name: "Personal Journal",
      emoji: "📔",
      color: "linear-gradient(to bottom right, #ff9900, white)",
      fields: ["Date", "Mood", "Key Events", "Reflections"],
      sampleTranscript: "Had a really productive day at work today. Finished the quarterly report ahead of schedule. Feeling accomplished but also a bit stressed about the presentation tomorrow.",
      processedNote: {
        "Date": "Today",
        "Mood": "Accomplished but stressed",
        "Key Events": "Completed quarterly report ahead of schedule",
        "Reflections": "Productive work day, concern about upcoming presentation"
      }
    }
  };

  const steps = [
    "Choose Template",
    "Record Audio",
    "AI Processing",
    "Structured Notes"
  ];

  const handleStartDemo = () => {
    setActiveStep(0);
    setShowTranscript(false);
    setIsRecording(false);
  };

  const handleNextStep = () => {
    if (activeStep === 1) {
      setIsRecording(true);
      setTimeout(() => {
        setIsRecording(false);
        setActiveStep(2);
        setTimeout(() => {
          setShowTranscript(true);
          setActiveStep(3);
        }, 2000);
      }, 3000);
    } else if (activeStep < 3) {
      setActiveStep(activeStep + 1);
    }
  };

  // Simulate volume changes for demo (replace with your actual volumeLevel prop)
  const [volumeLevel, setVolumeLevel] = useState(0); // Demo volume level (0-255)
  
  useEffect(() => {
    if (!isRecording) return;

    // Simulate volume level changes every 100ms
    const interval = setInterval(() => {
      setVolumeLevel(Math.random() * 255);
    }, 100);
    return () => clearInterval(interval);
  }, [isRecording]);
  
  return (
    <section id="demo" className="py-10 bg-white border-b-4 border-black">
      <div className="container mx-auto px-4">
        <h2 className="text-4xl font-black mb-4 text-center">SEE IT IN ACTION</h2>
        <p className="text-xl text-center mb-12 max-w-3xl mx-auto">
          Watch how PrivateScribe transforms your voice recordings into perfectly structured notes using customizable templates.
        </p>

        {/* Demo Steps */}
        <div className="flex justify-center mb-12">
          <div 
            className="flex space-x-4 overflow-x-auto"
          >
            {steps.map((step, index) => (
              <button 
                key={index}
                style={{
                    background: "linear-gradient(to right, #2b0f54, #5d1d91, #fd3777)",
                    backgroundSize: "90%",
                    backgroundAttachment: "fixed",
                }}
                className={`relative flex items-center space-x-2 px-4 py-2 border-4 border-black font-bold whitespace-nowrap ${
                  index <= activeStep ? 'text-white' : 'text-black'}
                  ${index === 0 && "cursor-pointer"}
                `}
                onClick={() => index == 0 && handleStartDemo()}
              >
                {index > activeStep && <div className='absolute top-0 left-0 w-full h-full bg-white z-20'/>}
                <span className={`w-8 h-8 rounded-full border-2 border-black flex items-center justify-center text-sm z-10 ${
                  index <= activeStep ? 'bg-[#fd3777] text-white' : 'bg-white'
                }`}>
                  {index + 1}
                </span>
                <span>{step}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="max-w-4xl mx-auto">
          {/* Step 1: Template Selection */}
          {activeStep === 0 && (
            <div className="border-4 border-black p-8 bg-white">
              <h3 className="text-2xl font-bold mb-6">Step 1: Choose Your Template</h3>
              <div className="grid md:grid-cols-3 gap-4 mb-6">
                {Object.entries(templates).map(([key, template]) => (
                  <NeoButton
                    key={key}
                    onClick={() => setSelectedTemplate(key)}
                    selected={selectedTemplate === key}
                  >
                    <div className="text-3xl mb-2">{template.emoji}</div>
                    <div className="text-xl">{template.name}</div>
                  </NeoButton>
                ))}
              </div>
              
              <div className="bg-gray-50 border-4 border-black p-4 mb-6">
                <h4 className="font-bold mb-2">Template Fields:</h4>
                <div className="space-y-2">
                  {templates[selectedTemplate].fields.map((field, index) => (
                    <div key={index} className="bg-white border-2 border-black p-2 text-sm">
                      {field}
                    </div>
                  ))}
                </div>
              </div>
            
            <div className='flex justify-center items-center mt-6'>
              <NeoButton 
                onClick={handleNextStep}
              >
                START →
              </NeoButton>
              </div>
            </div>
          )}

          {/* Step 2: Recording */}
          {activeStep === 1 && (
            <div className="border-4 border-black p-8 bg-white text-center">
              <h3 className="text-2xl font-bold mb-6">Step 2: Record Your Notes</h3>
              <div className="flex justify-center mb-6">
                <CassetteSVG
                    isRecording={isRecording}
                    paused={false}
                    labelText={
                        isRecording ? 
                        "Recording..."
                        :
                        "Click to record!"
                    }
                    className="w-1/3 h-1/3"
                    volumeLevel={volumeLevel}
                />
              </div>
              
              {!isRecording ? (
                <div>
                  <p className="text-lg mb-4">Click to start recording your (example) {templates[selectedTemplate].name.toLowerCase()}</p>
                  <NeoButton 
                    onClick={handleNextStep}
                  >
                    🔴 START RECORDING
                  </NeoButton>
                </div>
              ) : (
                <div>
                  <p className="text-lg mb-4 text-red-600 font-bold">Recording in progress...</p>
                  <div className="bg-gray-100 border-4 border-black p-4 text-left max-w-2xl mx-auto">
                    <p className="text-sm italic">"{templates[selectedTemplate].sampleTranscript}"</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Processing */}
          {activeStep === 2 && !showTranscript && (
            <div className="border-4 border-black p-8 bg-white text-center">
              <h3 className="text-2xl font-bold mb-6">Step 3: AI Processing</h3>
              <div className="mb-6">
                <div className="w-32 h-32 mx-auto rounded-full border-4 border-black bg-blue-400 flex items-center justify-center text-6xl animate-spin">
                  🧠
                </div>
              </div>
              <p className="text-lg mb-4">AI is analyzing your recording and structuring it according to your template...</p>
              <div className="bg-gray-100 border-4 border-black p-4">
                <div className="flex items-center justify-center space-x-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Results */}
          {activeStep === 3 && showTranscript && (
            <div className="border-4 border-black p-8 bg-white">
              <h3 className="text-2xl font-bold mb-6">Step 4: Structured Notes Generated!</h3>
              
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-bold mb-3 bg-[#2b0f54] text-white p-2 border-2 border-black">Raw Transcript:</h4>
                  <div className="bg-gray-50 border-2 border-black p-4 text-sm">
                    {templates[selectedTemplate].sampleTranscript}
                  </div>
                </div>
                
                <div>
                  <h4 className="font-bold mb-3 bg-[#fd3777] text-white p-2 border-2 border-black">Structured Output:</h4>
                  <div className="space-y-3">
                    {Object.entries(templates[selectedTemplate].processedNote).map(([field, content], index) => (
                      <div key={index} className="bg-white border-2 border-black p-3">
                        <div className="font-bold text-sm text-gray-600 mb-1">{field}:</div>
                        <div className="text-sm">{content}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-4 justify-center items-center mt-8">
                <NeoButton 
                  onClick={handleStartDemo}
                >
                  TRY AGAIN
                </NeoButton>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default NeoDemo;