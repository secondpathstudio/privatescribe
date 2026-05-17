import React from 'react';
import NeoButton from './neo-button';

interface ExportWarningModalProps {
  /** Format being exported; also gates visibility (null = closed). */
  format: 'pdf' | 'docx' | null;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Shown before a note is exported to PDF/DOCX. The downloaded file is plain,
 * unencrypted PHI — it leaves PrivateScribe's encryption boundary the moment
 * it lands in the user's Downloads folder. HIPAA makes safeguarding it the
 * covered entity's responsibility, so we require an explicit acknowledgement.
 */
const ExportWarningModal: React.FC<ExportWarningModalProps> = ({ format, onConfirm, onClose }) => {
  if (!format) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-warning-title"
    >
      <div className="bg-white border-4 border-black max-w-lg w-full">
        <div className="bg-yellow-300 border-b-4 border-black px-6 py-4">
          <h2 id="export-warning-title" className="text-2xl font-black uppercase text-black">
            ⚠ Unencrypted {format} export
          </h2>
        </div>

        <div className="p-6 space-y-4 text-black font-bold">
          <p>
            The {format.toUpperCase()} you're about to download is{' '}
            <span className="underline">not encrypted</span>. It contains the full note,
            including real patient and participant names, in plain text.
          </p>
          <p>
            Once saved, the file leaves PrivateScribe's encryption boundary — it lands in
            your Downloads folder with no password and no protection.
          </p>
          <p className="text-sm">
            Safeguarding this file — where it's stored, how it's shared, and when it's
            deleted — is your responsibility as the covered entity under HIPAA.
          </p>
        </div>

        <div className="flex gap-4 px-6 pb-6">
          <NeoButton type="button" onClick={onClose} label="Cancel" />
          <NeoButton type="button" onClick={onConfirm} label="I understand — download" />
        </div>
      </div>
    </div>
  );
};

export default ExportWarningModal;
