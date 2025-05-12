import React from 'react';
import NeoPricingCard from './components/neo/pricing-card';
import NeoAccordion from './components/neo/accordion';
import NeoButton from './components/neo/neo-button';
import NeoCTA from './components/neo/neo-cta';

const Neobrutal = () => {
  return (
    <div className="min-h-screen font-sans" style={{
      // Define CSS variables for our synthwave colors
      "--color-dark-purple": "#2b0f54",
      "--color-purple": "#5d1d91",
      "--color-pink": "#ff00ff",
      "--color-hot-pink": "#fd3777",
      "--color-bright-pink": "#fe4164",
      "--color-orange": "#ff9900",
      "--color-yellow": "#ffff00",
      "--color-cyan": "#00ffff"
    }}>
      {/* Navigation */}
      <nav className="bg-white border-b-4 border-black p-4">
        <div className="container mx-auto flex justify-between items-center">
          <div className="font-black text-2xl">Private<span style={{color: "#fd3777"}}>Scribe</span></div>
          <div className="hidden md:flex space-x-6">
            <a href="#features" className="font-bold hover:underline">Features</a>
            <a href="#pricing" className="font-bold hover:underline">Pricing</a>
            <a href="#faq" className="font-bold hover:underline">FAQ</a>
          </div>
          <NeoButton label="Sign Up" />
        </div>
      </nav>

      {/* Hero Section */}
      <section className="py-20 border-b-4 border-black" style={{
        background: "linear-gradient(to right, #2b0f54, #5d1d91, #fd3777)"
      }}>
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h1 className="text-5xl md:text-7xl font-black text-white mb-6 leading-tight">
                100% PRIVATE<br />AI TRANSCRIPTION
              </h1>
              <p className="text-xl text-white mb-8">
                Leverage artificial intelligence for rapid, fully customizable offline transcription. No more worrying about data leaks or privacy concerns. Your data never leaves your device.
              </p>
              <div className="flex flex-wrap gap-4">
                <NeoButton label="Try Free" backgroundColor='#fd3777' textColor="#ffffff" />
                <NeoButton label="Watch Demo" />
              </div>
            </div>
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black opacity-40"></div>
              <div className="w-full h-64 md:h-96 border-4 border-black" 
                style={{
                  background: "linear-gradient(to right, #fd3777, #ff9900, #ffff00)",
                  boxShadow: "12px 12px 0px 0px rgba(0,0,0,1)"
                }}>
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-6xl">▶️</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Grid Pattern Section */}
      <div className="bg-white py-6 border-b-4 border-black">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {['Reliable', 'Fast', 'Secure', 'Customizable'].map((item, index) => (
              <div key={index} className="border-4 border-black p-4 font-bold text-center bg-white" style={{boxShadow: "4px 4px 0px 0px rgba(0,0,0,1)"}}>
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Features Section */}
      <section id="features" className="py-20 bg-white border-b-4 border-black">
        <div className="container mx-auto px-4">
          <h2 className="text-4xl font-black mb-12 text-center">AWESOME FEATURES</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {/* Feature Card 1 */}
            <div className="border-4 border-black p-6" style={{
              background: "linear-gradient(to bottom right, #00ffff, white)",
              boxShadow: "8px 8px 0px 0px #000000"
            }}>
              <div className="flex items-center mb-4">
                <div className="mr-4 text-3xl">🔒</div>
                <h3 className="text-2xl font-black">Fully Private</h3>
              </div>
              <p>Fully private AI transcription - your data is yours and only yours.</p>
            </div>
            
            {/* Feature Card 2 */}
            <div className="border-4 border-black p-6" style={{
              background: "linear-gradient(to bottom right, #ff00ff, white)",
              boxShadow: "8px 8px 0px 0px #000000"
            }}>
              <div className="flex items-center mb-4">
                <div className="mr-4 text-3xl">🛠️</div>
                <h3 className="text-2xl font-black">Customizable Templates</h3>
              </div>
                <p>Quickly change tasks or specialization with easily customizable transcription templates.</p>
            </div>
            
            {/* Feature Card 3 */}
            <div className="border-4 border-black p-6" style={{
              background: "linear-gradient(to bottom right, #ff9900, white)",
              boxShadow: "8px 8px 0px 0px #000000"
            }}>
              <div className="flex items-center mb-4">
                <div className="mr-4 text-3xl">🔌</div>
                <h3 className="text-2xl font-black">Completely Offline</h3>
              </div>
                <p>Experience all the benefits of a full-featured AI transcription service, completely offline.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 border-b-4 border-black" style={{
        background: "linear-gradient(to right, #2b0f54, #5d1d91)"
      }}>
        <div className="container mx-auto px-4">
          <h2 className="text-4xl font-black mb-12 text-center text-white">PRICING PLANS</h2>
          <div className="grid md:grid-cols-3 gap-8">
        {/* Pricing Card 1 */}
          <NeoPricingCard
            title='PERSONAL'
            price='0'
            pricePeriod='mo'
            features={[
              "Open source transcription engine (MIT license)",
              "Basic UI and controls",
              "Community support",
              "Self-hosted deployment",
              "Works with publicly available models"
            ]}
            buttonText='Try Free'
          />
        
        {/* Pricing Card 2 - Recommended */}
          <NeoPricingCard
            title='TEAM'
            price='49'
            pricePeriod='mo'
            features={[
              "Access to premium transcription models",
              "Advanced formatting options",
              "Email support",
              "Quarterly model updates",
              "Team collaboration tools"
            ]}
            buttonText='Start Now'
            backgroundColor='linear-gradient(to right, #fe4164, #ff9900)'
            textColor='white'
          />
        
        
        {/* Pricing Card 3 */}
          <NeoPricingCard
            title='ENTERPRISE'
            price='99'
            pricePeriod='mo'
            features={[
              "Custom model training",
              "Deployment assistance",
              "Priority support",
              "Custom integrations",
              "Workflow consultation",
            ]}
            buttonText='Contact Sales'
          />
        
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-20 bg-white border-b-4 border-black">
        <NeoAccordion />
      </section>

      {/* Call to Action Section */}
      <NeoCTA />

      {/* Footer */}
      <footer className="bg-white py-12 border-b-4 border-black">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="font-black text-3xl mb-4">PRIVATE<span style={{color: "#fd3777"}}>SCRIBE</span></div>
              <p className="text-gray-600">Fully private AI transcription.</p>
            </div>
            <div>
              <h4 className="font-black text-lg mb-4">PRODUCT</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:underline">Features</a></li>
                <li><a href="#" className="hover:underline">Pricing</a></li>
                <li><a href="#" className="hover:underline">Roadmap</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-black text-lg mb-4">COMPANY</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:underline">About</a></li>
                <li><a href="#" className="hover:underline">Careers</a></li>
                <li><a href="#" className="hover:underline">Blog</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-black text-lg mb-4">CONNECT</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:underline">Twitter</a></li>
                <li><a href="#" className="hover:underline">Instagram</a></li>
                <li><a href="#" className="hover:underline">GitHub</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-12 pt-6 border-t-4 border-black text-center">
            <p>&copy; {new Date().getFullYear()} Second Path Studio. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Neobrutal;
