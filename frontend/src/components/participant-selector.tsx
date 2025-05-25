import React, { useState, useRef, useEffect } from 'react';
import { X, Plus, User, Search, Check, Trash } from 'lucide-react';

// Type definitions
export interface Participant {
  id: string;
  firstName: string;
  lastName?: string;
  email?: string;
}

export interface NewParticipant {
  firstName: string;
  lastName: string;
  email: string;
}

type ParticipantSelectorProps = {
    selectedParticipants: Participant[];
    savedParticipants?: Participant[];
    onChange: (participants: Participant[]) => void;
    onCreateParticipant: (newParticipant: NewParticipant) => Promise<Participant>;
    onDeleteParticipant: (participantId: string) => void;
    disabled?: boolean;
    onBlur?: () => void;
    className?: string;
};

const ParticipantSelector: React.FC<ParticipantSelectorProps> = ({
    selectedParticipants,
    savedParticipants,
    onChange,
    onCreateParticipant,
    onDeleteParticipant,
    disabled = false,
    onBlur,
    className = '',
}) => {
  // Use value from field if provided, otherwise use selectedParticipants
  const currentParticipants = selectedParticipants || [];
  
  // Use onChange from field if provided, otherwise use onChange prop
  const handleChange = onChange || (() => {});
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showNewParticipantForm, setShowNewParticipantForm] = useState<boolean>(false);
  const [newParticipant, setNewParticipant] = useState<NewParticipant>({
    firstName: '',
    lastName: '',
    email: ''
  });

  const [existingParticipants, setExistingParticipants] = useState<Participant[]>(
    savedParticipants || []
  );

  const [isCreating, setIsCreating] = useState<boolean>(false);
  
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Update existing participants when prop changes
  useEffect(() => {
    if (savedParticipants) {
      setExistingParticipants(savedParticipants);
    }
  }, [savedParticipants]);

  // Filter participants based on search term
  const filteredParticipants = existingParticipants.filter((participant: Participant) => {
    const fullName = `${participant.firstName} ${participant.lastName}`.toLowerCase();
    const email = participant.email?.toLowerCase() || '';
    const search = searchTerm.toLowerCase();
    return fullName.includes(search) || email.includes(search);
  });

  // Check if participant is already selected
  const isSelected = (participantId: string): boolean => {
    return currentParticipants.some((p: Participant) => p.id === participantId);
  };

  // Toggle participant selection
  const toggleParticipant = (participant: Participant): void => {
    if (isSelected(participant.id)) {
      const updated = currentParticipants.filter((p: Participant) => p.id !== participant.id);
      handleChange(updated);
    } else {
      handleChange([...currentParticipants, participant]);
    }
  };

  // Remove participant
  const removeParticipant = (participantId: string): void => {
    const updated = currentParticipants.filter((p: Participant) => p.id !== participantId);
    handleChange(updated);
  };

  // Add new participant
  const addNewParticipant = async (): Promise<void> => {
    if (!newParticipant.firstName.trim()) return;
    
    setIsCreating(true);
    
    try {
      let participant: Participant;
      
      if (onCreateParticipant) {
        // Use the provided API function
        participant = await onCreateParticipant(newParticipant);
      } else {
        // Fallback for demo purposes
        participant = {
          id: Date.now().toLocaleString(), // Generate a random ID
          firstName: newParticipant.firstName,
          lastName: newParticipant.lastName,
          email: newParticipant.email || undefined
        };
      }
      
      // Add to existing participants list and select it
      const updatedExisting = [...existingParticipants, participant];
      setExistingParticipants(updatedExisting);
      handleChange([...currentParticipants, participant]);
      
      // Reset form
      setNewParticipant({ firstName: '', lastName: '', email: '' });
      setShowNewParticipantForm(false);
      setSearchTerm('');
    } catch (error) {
      console.error('Error creating participant:', error);
      // Handle error - could show a toast or error message
    } finally {
      setIsCreating(false);
    }
  };

  // Handle dropdown close with onBlur
  const handleDropdownClose = (): void => {
    setIsOpen(false);
    setShowNewParticipantForm(false);
    if (onBlur) {
      onBlur();
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        handleDropdownClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onBlur]);

  // Focus search when dropdown opens
  useEffect(() => {
    if (isOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [isOpen]);

  // Format participant display name
  const formatParticipantName = (participant: Participant): string => {
    const name = participant.lastName 
      ? `${participant.firstName} ${participant.lastName}`
      : participant.firstName;
    return participant.email ? `${name} (${participant.email})` : name;
  };

  // Handle form input changes
  const handleNewParticipantChange = (field: keyof NewParticipant, value: string): void => {
    setNewParticipant(prev => ({ ...prev, [field]: value }));
  };

  // Handle keyboard events
  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' && !isCreating) {
      event.preventDefault();
      addNewParticipant();
    }
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Selected Participants */}
      <div className="space-y-2 mb-2">
        {currentParticipants.map((participant: Participant) => (
          <div
            key={participant.id}
            className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-md px-3 py-2"
          >
            <div className="flex items-center space-x-2">
              <User className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-900">
                {formatParticipantName(participant)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => removeParticipant(participant.id)}
              className="text-blue-600 hover:text-blue-800 transition-colors"
              aria-label={`Remove ${formatParticipantName(participant)}`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Add Participant Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className={`w-full flex cursor-pointer items-center justify-center space-x-2 border-2 border-dashed border-gray-300 rounded-md px-3 py-2 text-gray-600 hover:border-gray-400 hover:text-gray-700 transition-colors ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <Plus className="w-4 h-4" />
        <span className="text-sm">Add Participant</span>
      </button>

      {/* Dropdown */}
      {isOpen && !disabled && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-50 max-h-80 overflow-y-auto">
          {/* Search */}
          <div className="p-3 border-b border-gray-200">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search participants..."
                value={searchTerm}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                aria-label="Search participants"
              />
            </div>
          </div>

          {/* Participant List */}
          <div className="max-h-40 overflow-y-auto">
            {filteredParticipants.length > 0 ? (
              filteredParticipants.map((participant: Participant) => (
                <button
                  key={participant.id}
                  type="button"
                  onClick={() => toggleParticipant(participant)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 text-left transition-colors"
                  role="option"
                  aria-selected={isSelected(participant.id)}
                >
                  <div className="flex items-center space-x-2">
                    <User className="w-4 h-4 text-gray-400" />
                    <span className="text-sm">
                      {formatParticipantName(participant)}
                    </span>
                  </div>
                  {isSelected(participant.id) && (
                    <Check className="w-4 h-4 text-green-600" />
                  )}
                  {!isSelected(participant.id) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation(); // Prevent toggling selection
                        onDeleteParticipant(participant.id);
                      }}
                    >
                      <Trash className="w-4 h-4 text-gray-400 hover:text-red-600 transition-colors cursor-pointer" />
                    </button>
                  )}
                </button>
              ))
            ) : (
              <div className="px-3 py-4 text-center text-gray-500 text-sm">
                No participants found
              </div>
            )}
          </div>

          {/* Add New Participant */}
          <div className="border-t border-gray-200">
            {!showNewParticipantForm ? (
              <button
                type="button"
                onClick={() => setShowNewParticipantForm(true)}
                className="w-full flex items-center space-x-2 px-3 py-2 text-blue-600 hover:bg-blue-50 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span className="text-sm">Add New Participant</span>
              </button>
            ) : (
              <div className="p-3 space-y-2">
                <input
                  type="text"
                  placeholder="First Name *"
                  value={newParticipant.firstName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => 
                    handleNewParticipantChange('firstName', e.target.value)
                  }
                  onKeyPress={handleKeyPress}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  aria-required="true"
                  disabled={isCreating}
                />
                <input
                  type="text"
                  placeholder="Last Name"
                  value={newParticipant.lastName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => 
                    handleNewParticipantChange('lastName', e.target.value)
                  }
                  onKeyPress={handleKeyPress}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={isCreating}
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={newParticipant.email}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => 
                    handleNewParticipantChange('email', e.target.value)
                  }
                  onKeyPress={handleKeyPress}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={isCreating}
                />
                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={addNewParticipant}
                    disabled={!newParticipant.firstName.trim() || isCreating}
                    className="flex-1 bg-blue-600 text-white px-3 py-2 rounded-md text-sm hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                  >
                    {isCreating ? 'Adding...' : 'Add'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewParticipantForm(false);
                      setNewParticipant({ firstName: '', lastName: '', email: '' });
                    }}
                    disabled={isCreating}
                    className="flex-1 bg-gray-200 text-gray-700 px-3 py-2 rounded-md text-sm hover:bg-gray-300 disabled:bg-gray-100 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Example usage in your form with TypeScript
// export const ExampleParticipantForm: React.FC = () => {
//   const [selectedParticipants, setSelectedParticipants] = useState<Participant[]>([]);

//   // Example API function for creating participants
//   const handleCreateParticipant = async (newParticipant: NewParticipant): Promise<Participant> => {
//     // Replace with your actual API call
//     const response = await fetch('/api/participants', {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//       },
//       body: JSON.stringify(newParticipant),
//     });
    
//     if (!response.ok) {
//       throw new Error('Failed to create participant');
//     }
    
//     return response.json();
//   };

//   return (
//     <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg">
//       <h2 className="text-xl font-semibold mb-4">Add Participants to Recording</h2>
//       <div className="space-y-4">
//         <div>
//           <label className="block text-sm font-medium text-gray-700 mb-2">
//             Participants
//           </label>
//           <ParticipantSelector
//             selectedParticipants={selectedParticipants}
//             onChange={setSelectedParticipants}
//             onCreateParticipant={handleCreateParticipant}
//           />
//         </div>
        
//         {/* Other form fields would go here */}
        
//         <div className="mt-6">
//           <h3 className="text-sm font-medium text-gray-700 mb-2">Selected Participants:</h3>
//           <pre className="text-xs bg-gray-100 p-2 rounded overflow-auto">
//             {JSON.stringify(selectedParticipants, null, 2)}
//           </pre>
//         </div>
//       </div>
//     </div>
//   );
// };

export default ParticipantSelector;