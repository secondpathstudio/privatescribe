import React, {useState, useRef} from 'react'
import NeoAccordionItem from './accordion-item';
import NeoButton from './neo-button';

type Props = {}


const NeoAccordion = () => {
    
  const faqs = [
    {
      question: "How does your open source model work?",
      answer: "Our core transcription engine is 100% open source under MIT license. Free tier provides the complete engine with community support, while paid tiers offer premium models, additional languages, and priority support to fund ongoing development."
    },
    {
      question: "Is my data private and secure?",
      answer: "Absolutely. Our solution runs completely offline and locally. Your audio never leaves your device unless you explicitly choose to share it, ensuring maximum privacy and security for sensitive content."
    },
    {
      question: "What do paid tiers offer over the free version?",
      answer: "Paid tiers include access to more accurate transcription models, additional language packs, priority support, and enterprise features like custom fine-tuning. Higher tiers receive more frequent model updates and deployment assistance."
    },
    {
      question: "Can I use this for my business?",
      answer: "Yes! The MIT license allows commercial use. We offer scalable options from the Developer tier for small businesses to Enterprise for organizations needing custom solutions, deployment assistance, and SLA guarantees."
    }
  ];

  const [openIndex, setOpenIndex] = useState<number | null>(0); // First item open by default

  const toggleAccordion = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section id="faq" className="py-20 bg-white border-b-4 border-black">
      <div className="container mx-auto px-4">
        <h2 className="text-4xl font-black mb-12 text-center">FREQUENTLY ASKED QUESTIONS</h2>
        <div className="max-w-3xl mx-auto">
          {faqs.map((item, index) => (
            <NeoAccordionItem 
              key={index} 
              question={item.question} 
              answer={item.answer} 
              isOpen={index === openIndex}
              onClick={toggleAccordion}
              index={index}
            />
          ))}
        </div>
        
        <div className="mt-16 text-center">
          <div className="inline-block p-8 mb-8">
            <h3 className="text-xl font-bold mb-4">Still have questions?</h3>
            <p className="mb-6">Check out our <span className="underline font-semibold cursor-pointer hover:text-white transition-colors">documentation</span> or join our <span className="underline font-semibold cursor-pointer hover:text-indigo-600 transition-colors">GitHub discussions</span>.</p>
            <NeoButton label="Contact Us" />
          </div>
        </div>
      </div>
    </section>
  );
};

export default NeoAccordion