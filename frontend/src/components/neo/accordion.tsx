import React, { useState } from 'react'
import NeoAccordionItem from './accordion-item';


const NeoAccordion = () => {
    
  const faqs = [
    {
      question: "How does your open source model work?",
      answer: "Our core transcription engine is 100% open source under MIT license. We provide the complete engine with community support, while paid tiers offer access to premium fine-tuned models, additional languages, and priority support options."
    },
    {
      question: "Is my data private and secure?",
      answer: "Absolutely. Our solution runs completely offline and locally. Your audio, final transcription, and all the data in-between never leave your device unless you explicitly choose to share them, ensuring maximum privacy and security for sensitive content. You can have cutting-edge AI transcription even without an internet connection."
    },
    {
      question: "What paid services do you offer?",
      answer: "Paid services include access to more accurate transcription models based on common templates. Enterprise and custom solutions are available to receive more frequent model updates including custom models fine-tuned to your exact workflow or niche, deployment assistance, and technical support."
    },
    {
      question: "Can I use this for my business?",
      answer: "Yes! The MIT license allows commercial use of this project. You can use our open source engine for any purpose, including commercial applications. Not a developer and github repos are gibberish? Paid services offer additional features and support for business use cases including full deployment."
    }
  ];

  const [openIndex, setOpenIndex] = useState<number | null>(null); // First item open by default

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
      </div>
    </section>
  );
};

export default NeoAccordion