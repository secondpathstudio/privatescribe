import NeoPricingCard from './pricing-card';
import NeoAccordion from './accordion';
import NeoCTA from './neo-cta';
import NeoFooter from './neo-footer';
import NeoHero from './neo-hero';

const NeobrutalHome = () => {
  return (
    <div className="min-h-screen font-sans">

      {/* Background Animation? */}

      {/* Hero Section */}
      <NeoHero />

      {/* Grid Pattern Section */}
      <div className="bg-white py-6 border-b-4 border-black">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {['🏥 Healthcare', '🧑‍⚖️ Legal', '🧠 Mental Health', '📔 Personal'].map((item, index) => (
              <div key={index} className="border-4 border-black p-4 font-bold text-xl text-center bg-white" style={{boxShadow: "4px 4px 0px 0px rgba(0,0,0,1)"}}>
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
      <section id="pricing" className="py-20 -z-10 border-b-4 border-black relative" style={{
        background: "linear-gradient(to top, #2b0f54, #5d1d91)",
      }}>
        
        <div className="container mx-auto px-4 z-10">
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
            title='CUSTOM MODELS'
            price='199'
            pricePeriod='yr'
            features={[
              "Access to premium, fine-tuned transcription models",
              "Regular model updates",
              "Email support",
            ]}
            buttonText='Get Access Now'
            backgroundColor='linear-gradient(to right, #fe4164, #ff9900)'
            textColor='white'
          />
        
        
        {/* Pricing Card 3 */}
          <NeoPricingCard
            title='ENTERPRISE'
            price='1999'
            pricePeriod='yr'
            features={[
              "Custom model training for specific use cases",
              "Deployment assistance",
              "Custom integrations",
              "Workflow consultation",
              "Priority support",
            ]}
            buttonText='Contact Sales' 
          />
        
          </div>

          {/* gridlines */}
          {/* <div className="absolute inset-0 z-0" style={{
            backgroundImage: "linear-gradient(to right, rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            transform: "perspective(500px) rotateX(60deg)",
            transformOrigin: "bottom",
          }} /> */}
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

      {/* Background Animation */}
    </div>
  );
};

export default NeobrutalHome;
