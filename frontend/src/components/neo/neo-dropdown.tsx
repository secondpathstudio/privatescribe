import React, { useState, useRef, useEffect, ReactNode } from 'react';
import { Link } from 'react-router';

// Dropdown Item component - simplified without onClick handler
interface NeoDropdownItemProps {
  route?: string;
  children: ReactNode;
  id: string;
  className?: string;
  isLast?: boolean;
}

const NeoDropdownItem: React.FC<NeoDropdownItemProps> = ({
  route,
  children,
  id,
  className,
  isLast = false
}) => {

  if (route && route !== "") {
    return (
      <div
      className={`cursor-pointer font-bold text-lg uppercase tracking-wider hover:bg-[#fd3777] hover:text-white overflow-auto ${className}`}
          style={{
            borderBottom: isLast ? "none" : "2px solid black",
          }}
          data-id={id} // Add data attribute for identification in parent
      >
        <Link
          to={route}
          className='w-full h-full block p-3'
        >
          {children}
        </Link>
      </div>
    );
  }
  
  // If no href is provided, render as a div
  return (
    <div
      className={`cursor-pointer font-bold text-lg uppercase tracking-wider hover:bg-[#fd3777] hover:text-white overflow-auto ${className}`}
      style={{
        borderBottom: isLast ? "none" : "2px solid black",
        // background: isSelected ? "#f0f0f0" : "#ffffff",
      }}
      data-id={id} // Add data attribute for identification in parent
    >
      {children}
    </div>
  );
};

// Type for a React element that is a NeoDropdownItem
type NeoDropdownItemElement = React.ReactElement<NeoDropdownItemProps>;

// Main Dropdown component
interface NeoDropdownProps {
  children: ReactNode;
  defaultId?: string;
  backgroundColor?: string;
  textColor?: string;
  username: string;
  onChange?: (id: string) => void;
}

const NeoDropdown: React.FC<NeoDropdownProps> = (props) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(props.defaultId);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // Extract and properly type dropdown items
  const childrenArray = React.Children.toArray(props.children);
  
  // Define a type guard function
  const isNeoDropdownItem = (child: React.ReactNode): child is NeoDropdownItemElement => {
    return React.isValidElement(child) && 
           (child.type === NeoDropdownItem);
  };
  
  // Filter to get only NeoDropdownItem elements with proper typing
  const dropdownItems = childrenArray.filter(isNeoDropdownItem);
  
  // Get the button content - always show username if provided
  const getButtonContent = (): ReactNode => {
    if (props.username) {
      return props.username;
    } else if (dropdownItems.length > 0) {
      return dropdownItems[0].props.children;
    } else {
      return "Select Option";
    }
  };
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    
    // Cleanup event listeners on component unmount
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const toggleDropdown = (): void => {
    setIsOpen(!isOpen);
  };

  // Handle menu item click - moved from individual items to parent
  const handleMenuClick = (event: React.MouseEvent): void => {
    // Only process clicks on the menu items, not the container
    const target = event.target as HTMLElement;
    const menuItem = target.closest('[data-id]') as HTMLElement | null;
    
    if (menuItem) {
      const id = menuItem.getAttribute('data-id');
      if (id) {
        setSelectedId(id);
        setIsOpen(false);
        if (props.onChange) {
          props.onChange(id);
        }
      }
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Dropdown Button */}
      <button
        className={`cursor-pointer font-bold text-lg py-3 px-6 min-h-16 uppercase tracking-wider bg-white text-black border-4 border-black relative w-full flex justify-between items-center`}
        style={{
          boxShadow: isOpen ? "4px 4px 0px 0px #000000" : "8px 8px 0px 0px #000000",
          transform: isOpen ? "translate(4px, 4px)" : "translate(0px, 0px)",
          transition: "transform 0.1s, box-shadow 0.1s",
          background: props.backgroundColor || "#ffffff",
          color: props.textColor || "#000000",
        }}
        onMouseDown={(e: React.MouseEvent<HTMLButtonElement>): void => {
          if (!isOpen) {
            e.currentTarget.style.transform = "translate(4px, 4px)";
            e.currentTarget.style.boxShadow = "4px 4px 0px 0px #000000";
          }
        }}
        onMouseUp={(e: React.MouseEvent<HTMLButtonElement>): void => {
          if (!isOpen) {
            e.currentTarget.style.transform = "translate(0px, 0px)";
            e.currentTarget.style.boxShadow = "8px 8px 0px 0px #000000";
          }
        }}
        onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>): void => {
          if (!isOpen) {
            e.currentTarget.style.transform = "translate(0px, 0px)";
            e.currentTarget.style.boxShadow = "8px 8px 0px 0px #000000";
          }
        }}
        onClick={toggleDropdown}
      >
        <span className="flex-1 text-left">{getButtonContent()}</span>
        <span className="ml-2">▼</span>
      </button>

      {/* Dropdown Menu - click handler moved to container */}
      {isOpen && (
        <div 
          className="absolute w-full mt-1 border-t-0 border-4 border-black bg-white z-10 ml-1"
          style={{
            boxShadow: "4px 4px 0px 0px #000000",
          }}
          onClick={handleMenuClick}
        >
          {dropdownItems.map((child, index) => {
            return React.cloneElement(child, {
              key: index,
              isLast: index === dropdownItems.length - 1,
            });
          })}
        </div>
      )}
    </div>
  );
};

export { NeoDropdown, NeoDropdownItem };