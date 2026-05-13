import { useEffect, useState } from 'react';
import NeoButton from './neo-button';
import CassetteSVG from './cassette';

type TemplateKey = 'medical' | 'legal' | 'therapy' | 'personal';

type DiarizedSegment = { speaker: string; text: string };

type Template = {
  name: string;
  emoji: string;
  color: string;
  fields: string[];
  sampleTranscript: string;
  processedNote: Record<string, string>;
  speakerCount?: number;
  diarizedTranscript?: DiarizedSegment[];
};

const SPEAKER_COLORS: Record<string, string> = {
  Clinician: '#fce7f3',
  Client: '#f3e8ff',
};

const templates: Record<TemplateKey, Template> = {
  medical: {
    name: "Medical Visit",
    emoji: "🏥",
    color: "linear-gradient(to bottom right, #00ffff, white)",
    fields: ["Chief Complaint", "History of Present Illness", "Assessment", "Plan"],
    sampleTranscript: "okay so this is a 58 year old male presents to the ER complaining of chest pain pain started about two hours ago he was sitting watching TV describes it as sharp kind of stabbing seven out of ten radiates down the left arm no shortness of breath no nausea didn't sweat or anything he has a history of high blood pressure takes lisinopril otherwise no cardiac history that he knows of dad had a heart attack at 62 vitals look okay BP one forty over ninety heart rate ninety-two going to get an ECG troponins chest x-ray and keep him on the monitor while we work this up",
    processedNote: {
      "Chief Complaint": "Chest pain, 2 hours duration",
      "History of Present Illness": "58yo M with sharp, stabbing chest pain at rest, 7/10 severity, radiating to left arm. No SOB, nausea, or diaphoresis. PMH: HTN on lisinopril. FH: father MI at 62. Vitals on presentation: BP 140/90, HR 92.",
      "Assessment": "Possible acute coronary syndrome — requires immediate cardiac workup",
      "Plan": "ECG, troponins, chest X-ray, continuous cardiac monitoring. Reassess after initial workup."
    }
  },
  legal: {
    name: "Legal Consultation",
    emoji: "🧑‍⚖️",
    color: "linear-gradient(to bottom right, #ff00ff, white)",
    fields: ["Client Information", "Legal Issue", "Facts", "Action Items"],
    sampleTranscript: "initial consult with John Smith came in this morning about a non-compete situation with his former employer DataCorp he left them about three months ago to join a competitor called Inflexion and now DataCorp's general counsel sent him a cease and desist saying he's violating his non-compete he wants to know if it's enforceable here's the wrinkle he signed the original agreement when he was based in Texas but he relocated to California two years ago and was working remotely from there for the last eighteen months agreement has a Delaware choice of law clause he's been at Inflexion for two months similar role but different vertical B2C versus B2B he hasn't taken any client lists or trade secrets just general industry knowledge action items pull the actual agreement research Delaware versus California non-compete enforceability particularly the recent California ban and get back to him by end of week",
    processedNote: {
      "Client Information": "John Smith — former DataCorp employee (departed 3 months ago), now at Inflexion (2 months)",
      "Legal Issue": "Cease-and-desist alleging non-compete violation. Cross-jurisdictional enforceability question (TX signing, CA resident, DE choice-of-law).",
      "Facts": "Signed agreement while based in TX; relocated to CA 2 years ago, remote for last 18 months. Similar role at competitor in a different vertical (B2C vs B2B). No client lists or trade secrets taken — general industry knowledge only.",
      "Action Items": "Pull executed agreement. Research DE vs. CA non-compete enforceability, particularly CA's recent statutory ban. Respond to client by end of week."
    }
  },
  therapy: {
    name: "Therapy Session",
    emoji: "💬",
    color: "linear-gradient(to bottom right, #9d4edd, white)",
    fields: ["Presenting Concerns", "Session Content", "Functional Impact", "Plan"],
    speakerCount: 2,
    sampleTranscript: "thanks for coming in today how have you been since our last session pretty rough honestly the panic attacks came back twice this week the second one was at work and I had to leave early that sounds really difficult can you walk me through what was happening just before the first one I had a meeting on the calendar that I'd been dreading all week",
    diarizedTranscript: [
      { speaker: "Clinician", text: "Thanks for coming in today — how have you been since our last session?" },
      { speaker: "Client", text: "Pretty rough, honestly. The panic attacks came back twice this week. The second one was at work and I had to leave early." },
      { speaker: "Clinician", text: "That sounds really difficult. Can you walk me through what was happening just before the first one?" },
      { speaker: "Client", text: "I had a meeting on the calendar that I'd been dreading all week." },
    ],
    processedNote: {
      "Presenting Concerns": "Recurrence of panic attacks — two episodes in the past week",
      "Session Content": "Client reports anticipatory anxiety preceding a scheduled work meeting as the trigger for the first episode; second episode occurred at the workplace",
      "Functional Impact": "Required early departure from work; ongoing avoidance of work-related stressors",
      "Plan": "Review CBT coping strategies for anticipatory anxiety; consider exposure hierarchy for work meetings; follow-up in one week"
    }
  },
  personal: {
    name: "Personal Journal",
    emoji: "📔",
    color: "linear-gradient(to bottom right, #ff9900, white)",
    fields: ["Date", "Mood", "Key Events", "Reflections"],
    sampleTranscript: "okay journal entry for today work was actually really good today like surprisingly good I finished the quarterly report which I'd been dreading for like two weeks got it done by lunch which never happens Sarah looked at it and said it was solid she only had a couple small edits I think the framework I tried pulling the key metrics into one summary slide up front actually worked but yeah presentation to leadership is tomorrow and I keep going back and forth between feeling like I've got this and feeling like I'm going to forget half of what I want to say probably going to run through it one more time tonight after dinner trying not to spiral about it also need to remember to email mom back she sent that thing on Sunday and I keep forgetting",
    processedNote: {
      "Date": "Today",
      "Mood": "Accomplished and relieved about work output; anxious about tomorrow's leadership presentation",
      "Key Events": "Finished quarterly report by lunch — well ahead of schedule. Sarah reviewed positively with only minor edits. New summary-slide framework validated.",
      "Reflections": "Pre-presentation anxiety oscillating between confidence and self-doubt. Plan to rehearse once tonight after dinner. Personal todo: respond to mom's Sunday message."
    }
  }
};

const NeoDemo = () => {
  const [activeStep, setActiveStep] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateKey>('medical');
  const [isRecording, setIsRecording] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

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
          PrivateScribe transforms your voice recordings into perfectly structured notes using customizable templates — and for group conversations, it can tell the speakers apart.
        </p>

        {/* Demo Steps */}
        <div className="flex justify-center mb-12">
          <div 
            className="flex md:space-x-4 overflow-x-auto"
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
                  ${index !== activeStep && "hidden md:inline-flex"}
                `}
                onClick={() => index == 0 && handleStartDemo()}
              >
                {index > activeStep && <div className='absolute top-0 left-0 w-full h-full bg-white z-10'/>}
                <span className={`w-8 h-8 rounded-full border-2 border-black flex items-center justify-center text-sm z-10 ${
                  index <= activeStep ? 'bg-[#fd3777] text-white' : 'bg-white'
                }`}>
                  {index + 1}
                </span>
                <span className='z-10'>{step}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="max-w-4xl mx-auto">
          {/* Step 1: Template Selection */}
          {activeStep === 0 && (
            <div className="border-4 border-black p-8 bg-white">
              <h3 className="text-xl md:text-2xl font-bold mb-6 text-center md:text-left">Step 1: Choose Your Template</h3>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {Object.entries(templates).map(([key, template]) => (
                  <NeoButton
                    key={key}
                    onClick={() => setSelectedTemplate(key as TemplateKey)}
                    selected={selectedTemplate === key}
                  >
                    <div className="flex flex-col items-center justify-center text-center">
                      <div className="text-3xl mb-2">{template.emoji}</div>
                      <div className="text-base lg:text-lg leading-tight">{template.name}</div>
                      {template.speakerCount && (
                        <div className="mt-2 text-xs font-bold bg-black text-white px-2 py-1">
                          👥 {template.speakerCount} speakers
                        </div>
                      )}
                    </div>
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
                {templates[selectedTemplate].speakerCount && (
                  <p className="text-xs mt-3 italic">
                    Multi-speaker conversation — PrivateScribe separates each speaker automatically.
                  </p>
                )}
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
              <h3 className="text-xl md:text-2xl font-bold mb-6 text-center md:text-left">Step 2: Record Your Notes</h3>
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
              <h3 className="text-xl md:text-2xl font-bold mb-6 text-center md:text-left">Step 3: AI Processing</h3>
              <div className="mb-6">
                <div className="w-32 h-32 mx-auto rounded-full border-4 border-black bg-blue-400 flex items-center justify-center text-6xl animate-spin">
                  🧠
                </div>
              </div>
              <p className="text-lg mb-4">AI will analyze your recording and structure it according to your template...</p>
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
              <h3 className="text-xl md:text-2xl font-bold mb-6 text-center md:text-left">Step 4: Structured Transcript Generated!</h3>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-6">
                  <div>
                    <h4 className="font-bold mb-3 bg-[#2b0f54] text-white p-2 border-2 border-black">Raw Transcript:</h4>
                    <div className="bg-gray-50 border-2 border-black p-4 text-sm">
                      {templates[selectedTemplate].sampleTranscript}
                    </div>
                  </div>

                  {templates[selectedTemplate].diarizedTranscript && (
                    <div>
                      <h4 className="font-bold mb-3 bg-[#9d4edd] text-white p-2 border-2 border-black">With Speaker Identification:</h4>
                      <div className="space-y-2">
                        {templates[selectedTemplate].diarizedTranscript!.map((segment, index) => (
                          <div
                            key={index}
                            className="border-2 border-black p-3 text-sm"
                            style={{ background: SPEAKER_COLORS[segment.speaker] ?? '#f5f5f5' }}
                          >
                            <span className="font-bold">{segment.speaker}:</span> {segment.text}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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