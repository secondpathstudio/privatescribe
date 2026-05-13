import React, { useState } from 'react'
import NeoAccordionItem from './accordion-item';


const NeoAccordion = () => {
    
  const faqs = [
    {
      question: "What happens to my notes if my laptop is lost or stolen?",
      answer: "Full-disk encryption (FileVault on Mac, BitLocker on Windows) is what protects a stolen laptop — when it's locked or powered off, the drive doesn't even mount. PrivateScribe assumes you have it on, the same way a banking app assumes you have a screen lock. On top of that, every transcript, note, and recording is encrypted with its own 256-bit key, so if the data ever travels without the laptop — a backup, a recovered disk sector, an admin who has to re-authenticate to view the key (and gets logged when they do) — it stays unreadable."
    },
    {
      question: "Will my conversations be used to train an AI model?",
      answer: "No. The transcription and the AI formatting both run on your computer, using models that are already trained. There's no telemetry, no upload step, and no account with a vendor who 'may use your data to improve our services.' Pull the network cable and PrivateScribe keeps working."
    },
    {
      question: "Is this HIPAA compliant?",
      answer: "HIPAA compliance is an organizational matter, not a software feature — no piece of software is HIPAA-compliant on its own. What PrivateScribe gives you is the technical foundation a covered entity would need: data that never leaves the device, no third-party processors, encryption at rest, and a full audit log. The policies, BAAs, and risk assessments remain your responsibility."
    },
    {
      question: "Are the original audio recordings private too?",
      answer: "Yes. Every recording is encrypted on disk with the same 256-bit standard as the notes, using a key derived from your database key. You can play it back inside the note when the exact wording matters, and nothing about the audio is ever transmitted off the device."
    },
    {
      question: "Can a team or practice use this together?",
      answer: "Yes. There's an admin console for user management, password resets, and a full audit log — including a security alert if an admin ever accesses the encryption key. Login rate-limiting slows down anyone guessing passwords. Each note template can also use a different local AI model, so different document types can be tuned independently."
    },
    {
      question: "What does it cost?",
      answer: "PrivateScribe is open source under MIT — free for personal use and for commercial use inside a practice. Paid tiers (coming soon) layer on top: PrivateScribe Studio for designing richer, more customizable templates than the built-in editor allows (with central management across a team if you have one — one edit propagates to everyone, no version drift), access to fine-tuned and custom-trained premium models for specialized workflows, deployment assistance, and priority support. The privacy guarantees don't change between tiers: paid or free, your data still never leaves your machine."
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