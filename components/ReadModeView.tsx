

import React, { useEffect, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LightAsync as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { CloseIcon } from './Icons.tsx';

interface ReadModeViewProps {
  isOpen: boolean;
  content: string;
  onClose: () => void;
}

// Re-using the CodeBlock component logic for consistent styling
const CodeBlock: React.FC<React.PropsWithChildren<{ inline?: boolean; className?: string }>> = memo(({
  inline,
  className,
  children,
}) => {
  const codeString = String(children).replace(/\n$/, '');
  const match = /language-([\w.-]+)/.exec(className || '');
  const lang = match ? match[1] : '';

  if (inline) {
    return (
      <code className="bg-black/30 text-indigo-300 rounded px-1 py-0.5 font-mono text-sm border border-white/10">
        {children}
      </code>
    );
  }

  return (
    <div className="relative my-2 rounded-md overflow-hidden border border-white/10 bg-[#0A0910]">
      <div className="flex justify-between items-center px-4 py-1.5 bg-black/20">
        <span className="text-xs text-gray-300 font-mono">{lang || 'code'}</span>
      </div>
      {lang ? (
        <SyntaxHighlighter
          style={atomOneDark}
          language={lang}
          PreTag="div"
          customStyle={{ margin: 0, padding: '1rem', fontSize: '0.9em', backgroundColor: 'transparent' }}
        >
          {codeString}
        </SyntaxHighlighter>
      ) : (
        <pre className="bg-transparent text-gray-200 p-4 text-sm font-mono overflow-x-auto m-0">
          <code>{codeString}</code>
        </pre>
      )}
    </div>
  );
});

const ReadModeView: React.FC<ReadModeViewProps> = memo(({ isOpen, content, onClose }) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.body.style.overflow = 'hidden'; // Prevent background scrolling
      window.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = 'auto';
    }

    return () => {
      document.body.style.overflow = 'auto';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-40 flex flex-col p-4 sm:p-8 md:p-12 pt-24"
      onClick={onClose} // Close on clicking the background
      role="dialog"
      aria-modal="true"
    >
      <button
        onClick={(e) => {
          e.stopPropagation(); // Prevent background click when clicking the button
          onClose();
        }}
        className="absolute top-4 right-4 text-gray-400 p-2 rounded-full z-10 transition-shadow hover:text-white hover:shadow-[0_0_12px_2px_rgba(255,255,255,0.2)]"
        aria-label="Close Read Mode"
      >
        <CloseIcon className="w-7 h-7" />
      </button>

      <div
        className="flex-grow w-full max-w-4xl mx-auto overflow-y-auto hide-scrollbar markdown-content"
        onClick={(e) => e.stopPropagation()} // Prevent closing when clicking the content area
      >
        <div className="aurora-panel p-6 sm:p-8 rounded-lg">
             <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: CodeBlock }}>
                {content}
            </ReactMarkdown>
        </div>
      </div>
    </div>
  );
});

export default ReadModeView;
