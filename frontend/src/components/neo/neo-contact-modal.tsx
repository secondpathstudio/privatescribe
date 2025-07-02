import React, { useState, FormEvent, ChangeEvent, FocusEvent } from 'react';
import NeoButton from './neo-button';

interface FormData {
  name: string;
  email: string;
  message: string;
}

interface FormErrors {
  name?: string;
  email?: string;
  message?: string;
}

interface ContactModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ContactModal: React.FC<ContactModalProps> = ({ isOpen, onClose }) => {
  const [formData, setFormData] = useState<FormData>({
    name: '',
    email: '',
    message: ''
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Validation functions
  const validateName = (name: string): string => {
    if (!name.trim()) return 'Name is required';
    if (name.trim().length < 2) return 'Name must be at least 2 characters';
    if (name.trim().length > 50) return 'Name cannot exceed 50 characters';
    if (!/^[a-zA-Z\s'-]+$/.test(name.trim())) return 'Name can only contain letters, spaces, hyphens, and apostrophes';
    return '';
  };

  const validateEmail = (email: string): string => {
    if (!email.trim()) return 'Email is required';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) return 'Please enter a valid email address';
    if (email.length > 254) return 'Email address is too long';
    return '';
  };

  const validateMessage = (message: string): string => {
    if (!message.trim()) return 'Message is required';
    if (message.trim().length < 10) return 'Message must be at least 10 characters';
    if (message.trim().length > 1000) return 'Message cannot exceed 1000 characters';
    return '';
  };

  const validateField = (name: keyof FormData, value: string): string => {
    switch (name) {
      case 'name':
        return validateName(value);
      case 'email':
        return validateEmail(value);
      case 'message':
        return validateMessage(value);
      default:
        return '';
    }
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    const { name, value } = e.target;
    
    setFormData({
      ...formData,
      [name]: value
    });

    // Clear error when user starts typing and validate in real-time
    if (errors[name as keyof FormErrors]) {
      const fieldError = validateField(name as keyof FormData, value);
      setErrors({
        ...errors,
        [name]: fieldError
      });
    }
  };

  const handleBlur = (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    const { name, value } = e.target;
    const fieldError = validateField(name as keyof FormData, value);
    
    setErrors({
      ...errors,
      [name]: fieldError
    });
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {
      name: validateName(formData.name),
      email: validateEmail(formData.email),
      message: validateMessage(formData.message)
    };

    setErrors(newErrors);
    
    // Return true if no errors
    return !Object.values(newErrors).some(error => error);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    
    // Validate form before submission
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    const messageData = {
      service_id: import.meta.env.VITE_EMAILJS_SERVICE,
      template_id: import.meta.env.VITE_EMAILJS_TEMPLATE,
      user_id: import.meta.env.VITE_EMAILJS_USER,
      template_params: {
        name: formData.name.trim(),
        email: formData.email.trim(),
        message: formData.message.trim(),
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

      alert('Thank you for your message, we will get back to you soon!');
      setIsSubmitting(false);
      // Reset form data and errors
      setFormData({
        name: '',
        email: '',
        message: ''
      });
      setErrors({});
      onClose();
      
    } catch (error: unknown) {
      console.error('Error sending email:', error);
      alert('Sorry, there was an error sending your message. Please try again.');
      setIsSubmitting(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>): void => {
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
        <div className='flex justify-end items-center'>
        <NeoButton
          onClick={onClose}
          className='m-4'
        >
          ×
        </NeoButton>
        </div>

        <div className="p-8">
          <h2 className="text-4xl font-black mb-8 text-center text-black uppercase">
            CONTACT US
          </h2>
          
          <form onSubmit={handleSubmit} noValidate>
            <div className="space-y-6">
              {/* Name Field */}
              <div>
                <label 
                  htmlFor="name" 
                  className="block text-xl font-black mb-3 text-black uppercase tracking-wider"
                >
                  NAME *
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  required
                  className={`w-full p-4 border-4 font-bold text-lg focus:outline-none bg-white text-black ${
                    errors.name ? 'border-red-500' : 'border-black'
                  }`}
                  placeholder="Your name here"
                  maxLength={50}
                />
                {errors.name && (
                  <p className="mt-2 text-red-500 font-bold text-sm">{errors.name}</p>
                )}
              </div>

              {/* Email Field */}
              <div>
                <label 
                  htmlFor="email" 
                  className="block text-xl font-black mb-3 text-black uppercase tracking-wider"
                >
                  EMAIL *
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  required
                  className={`w-full p-4 border-4 font-bold text-lg focus:outline-none bg-white text-black ${
                    errors.email ? 'border-red-500' : 'border-black'
                  }`}
                  placeholder="your.email@domain.com"
                  maxLength={254}
                />
                {errors.email && (
                  <p className="mt-2 text-red-500 font-bold text-sm">{errors.email}</p>
                )}
              </div>

              {/* Message Field */}
              <div>
                <label 
                  htmlFor="message" 
                  className="block text-xl font-black mb-3 text-black uppercase tracking-wider"
                >
                  MESSAGE *
                </label>
                <div className="relative">
                  <textarea
                    id="message"
                    name="message"
                    value={formData.message}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    required
                    rows={6}
                    className={`w-full p-4 border-4 font-bold text-lg focus:outline-none resize-none bg-white text-black ${
                      errors.message ? 'border-red-500' : 'border-black'
                    }`}
                    placeholder="Are you interested in a demo or have questions about 100% private AI transcription? Let us know!"
                    maxLength={1000}
                  />
                  <div className="absolute bottom-2 right-2 text-xs font-bold text-gray-500">
                    {formData.message.length}/1000
                  </div>
                </div>
                {errors.message && (
                  <p className="mt-2 text-red-500 font-bold text-sm">{errors.message}</p>
                )}
              </div>

              {isSubmitting && (
                <div className="text-center text-lg font-bold text-black">
                  Sending message...
                </div>
              )}
              {!isSubmitting && (
                <div className="flex gap-4 pt-4">
                  <NeoButton
                    type="button"
                    onClick={onClose}
                  >
                    CANCEL
                  </NeoButton>
                  <NeoButton
                    type="submit"
                    disabled={Object.values(errors).some(error => error) || !formData.name.trim() || !formData.email.trim() || !formData.message.trim()}
                  >
                    SEND MESSAGE
                  </NeoButton>
                </div>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ContactModal;