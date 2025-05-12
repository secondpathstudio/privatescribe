import React, { useRef, useState, useEffect } from 'react';

type Props = {
    question: string;
    answer: string;
    isOpen: boolean;
    onClick: (index: number) => void;
    index: number;
}

const NeoAccordionItem = ({question, answer, isOpen, onClick, index}: Props) => {
  const contentRef = useRef(null);
  const [height, setHeight] = useState(0);
  
  React.useEffect(() => {
    if (isOpen) {
      const contentEl = contentRef.current;
      setHeight(contentEl?.scrollHeight);
    } else {
      setHeight(0);
    }
  }, [isOpen]);

  return (
    <div 
      className={`border-4 border-black bg-white mb-6 relative transition-all duration-300`} 
      style={{
        boxShadow: isOpen ? "12px 12px 0px 0px rgba(0,0,0,1)" : "8px 8px 0px 0px rgba(0,0,0,1)",
        transform: isOpen ? "translate(-4px, -4px)" : "translate(0, 0)"
      }}
    >
      <button 
        className="cursor-pointer w-full text-left p-6 flex justify-between items-center focus:outline-none"
        onClick={() => onClick(index)}
        aria-expanded={isOpen}
      >
        <h3 className="text-xl font-black pr-8">{question}</h3>
        <div 
          className={`w-8 h-8 flex items-center justify-center rounded-full border-3 border-black flex-shrink-0 transition-transform duration-300`}
          style={{ 
            backgroundColor: "#fe4164",
            transform: isOpen ? "rotate(45deg)" : "rotate(0deg)" 
          }}
        >
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
        </div>
      </button>
      
      <div 
        ref={contentRef}
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{ height: `${height}px` }}
      >
        <div className={`px-6 pb-6 pt-4 text-gray-700 border-t-2 border-gray-200 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}>
          <p>{answer}</p>
        </div>
      </div>
    </div>
  );
};

export default NeoAccordionItem;