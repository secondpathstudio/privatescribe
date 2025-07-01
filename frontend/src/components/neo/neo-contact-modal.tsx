import { error } from 'console';
import React, { useState } from 'react';

const ContactModal = ({ isOpen, onClose }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    message: ''
  });

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const messageData = {
      service_id: import.meta.env.VITE_EMAILJS_SERVICE,
      template_id: import.meta.env.VITE_EMAILJS_TEMPLATE,
      user_id: import.meta.env.VITE_EMAILJS_USER,
      template_params: {
        name: formData.name,
        email: formData.email,
        message: formData.message,
      }
    }

    //emailjs api call
    try {
      const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messageData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Network response was not ok:', response.statusText, errorText);
        throw new Error('Network response was not ok');
      }

      // EmailJS returns plain text "OK" on success, not JSON
      const result = await response.text();
      console.log('Email sent successfully:', result); // This will log "OK"
      
    } catch (error) {
      console.error('Error sending email:', error);
    }
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-white border-4 border-black max-w-2xl w-full max-h-[90vh] overflow-y-auto relative">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 bg-black text-white font-black text-xl border-2 border-black hover:bg-gray-800 flex items-center justify-center"
        >
          ×
        </button>

        <div className="p-8">
          <h2 className="text-4xl font-black mb-8 text-center text-black uppercase">
            CONTACT US
          </h2>
          
          <div className="space-y-6">
            {/* Name Field */}
            <div>
              <label 
                htmlFor="name" 
                className="block text-xl font-black mb-3 text-black uppercase tracking-wider"
              >
                NAME
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                className="w-full p-4 border-4 border-black font-bold text-lg focus:outline-none bg-white text-black"
                placeholder="Your name here"
              />
            </div>

            {/* Email Field */}
            <div>
              <label 
                htmlFor="email" 
                className="block text-xl font-black mb-3 text-black uppercase tracking-wider"
              >
                EMAIL
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                className="w-full p-4 border-4 border-black font-bold text-lg focus:outline-none bg-white text-black"
                placeholder="your.email@domain.com"
              />
            </div>

            {/* Comment Field */}
            <div>
              <label 
                htmlFor="comment" 
                className="block text-xl font-black mb-3 text-black uppercase tracking-wider"
              >
                MESSAGE
              </label>
              <textarea
                id="message"
                name="message"
                value={formData.message}
                onChange={handleChange}
                required
                rows={6}
                className="w-full p-4 border-4 border-black font-bold text-lg focus:outline-none resize-none bg-white text-black"
                placeholder="Are you interested in a demo or have questions about 100% private AI transcription? Let us know!"
              />
            </div>

            {/* Buttons */}
            <div className="flex gap-4 pt-4">
              <button
                onClick={onClose}
                className="flex-1 px-6 py-4 border-4 border-black font-black text-xl uppercase tracking-wider bg-gray-200 text-black hover:bg-gray-300 transition-colors"
              >
                CANCEL
              </button>
              <button
                onClick={handleSubmit}
                className="flex-1 px-6 py-4 border-4 border-black font-black text-xl uppercase tracking-wider bg-black text-white hover:bg-gray-800 transition-colors"
              >
                SEND MESSAGE
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContactModal;