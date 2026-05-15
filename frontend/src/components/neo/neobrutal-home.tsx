import { useState } from 'react';
import NeoPricingCard from './neo-pricing-card';
import NeoAccordion from './accordion';
import NeoCTA from './neo-cta';
import NeoFooter from './neo-footer';
import NeoHero from './neo-hero';
import NeoFeatureCard from './neo-feature-card';
import NeoDemo from './neo-demo';
import NeoScreenshots from './neo-screenshots';
import ContactModal from './neo-contact-modal';

const TranscriptionApplications = [
  { name: 'Healthcare', emoji: '🏥' },
  { name: 'Legal', emoji: '🧑‍⚖️' },
  { name: 'Mental Health', emoji: '🧠' },
  { name: 'Personal', emoji: '📔' },
]

const NeobrutalHome = () => {
  const [contactModalOpen, setContactModalOpen] = useState(false);

  return (
    <div className="min-h-screen font-sans">

      {/* Hero Section */}
      <NeoHero />

      {/* Grid Pattern Section - scroll? */}
      <div className="bg-white py-6 border-b-4 border-black">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {TranscriptionApplications.map(({name,emoji}, index) => (
              <div key={index} className="flex flex-col items-center justify-center border-4 border-black p-4 font-bold text-xl text-center bg-white">
                <div>{emoji}</div>
                <div>{name}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Features Section */}
      <section id="features" className="py-20 bg-white border-b-4 border-black">
        <div className="container mx-auto px-4">
          <h2 className="text-4xl font-black mb-12 text-center">FEATURES</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <NeoFeatureCard
              emoji="🔒"
              title="Fully Private"
              description="Fully private AI transcription - your data is yours and only yours."
              style={{
                background: "linear-gradient(to bottom right, #00ffff, white)",
              }}
            />
            
            <NeoFeatureCard
              emoji="🛠️"
              title="Customizable Templates"
              description="Quickly change tasks or specialization with easily customizable transcription templates."
              style={{
                background: "linear-gradient(to bottom right, #ff00ff, white)",
              }}
            />
            
            <NeoFeatureCard
              emoji="🔌"
              title="Completely Offline"
              description="Experience all the benefits of a full-featured AI transcription service, completely offline."
              style={{
                background: "linear-gradient(to bottom right, #ff9900, white)",
              }}
            />
          </div>
        </div>
      </section>

      {/* Demo Section */}
      <NeoDemo />

      {/* Real product screenshots + dual-path "Get it on your machine" */}
      <NeoScreenshots onNotifyClick={() => setContactModalOpen(true)} />

      {/* Pricing Section */}
      <section id="pricing" className="py-20 border-b-4 border-black relative" style={{
        background: "linear-gradient(to top, #2b0f54, #5d1d91)",
      }}>
        
        <div className="container mx-auto px-4">
          <h2 className="text-4xl font-black mb-12 text-center text-white">PRICING</h2>
          <div className="grid md:grid-cols-3 gap-8">
          <NeoPricingCard
            title='PERSONAL'
            price='0'
            pricePeriod='mo'
            features={[
              "Open source transcription engine (MIT license)",
              "Basic UI and controls",
              "Community support",
              "Self-hosted via terminal (best for technically comfortable users — standalone installer in development)",
              "Works with publicly available models"
            ]}
            buttonText='100% Free!'
          />
      
          <NeoPricingCard
            title='PROFESSIONAL'
            price='soon'
            pricePeriod='yr'
            features={[
              "PrivateScribe Studio — a dedicated builder for richer, more customizable note templates",
              "Manage and standardize note templates across your whole organization",
              "Optionally link the PrivateScribe app to the Studio so templates update automatically",
              "Email support",
            ]}
            buttonText='Coming Soon'
            backgroundColor='linear-gradient(to right, #fe4164, #ff9900)'
            textColor='white'
          />
        
          <NeoPricingCard
            title='ENTERPRISE'
            price='soon'
            pricePeriod='yr'
            features={[
              "Custom model training for specific use cases",
              "Deployment assistance",
              "Custom integrations",
              "Workflow consultation",
              "Priority support",
            ]}
            buttonText='Contact Us' 
            onClick={() => setContactModalOpen(true)}
          />
        
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className=" bg-white border-black">
        <NeoAccordion />
      </section>

      {/* Call to Action Section */}
      <NeoCTA />

      {/* Footer */}
      <NeoFooter />

      <ContactModal 
        isOpen={contactModalOpen} 
        onClose={() => setContactModalOpen(false)} 
      />
    </div>
  );
};

export default NeobrutalHome;
