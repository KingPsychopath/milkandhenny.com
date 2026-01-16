'use client';

import { useState } from 'react';
import { Guest } from '@/lib/types';

type GuestItemProps = {
  guest: Guest;
  onCheckIn: (id: string, checkedIn: boolean) => void;
  searchQuery: string;
};

/** Trigger haptic feedback on supported devices */
function hapticFeedback(type: 'light' | 'medium' | 'success') {
  if (typeof window === 'undefined' || !navigator.vibrate) return;
  
  switch (type) {
    case 'light':
      navigator.vibrate(10);
      break;
    case 'medium':
      navigator.vibrate(25);
      break;
    case 'success':
      // Double tap pattern for success
      navigator.vibrate([15, 50, 15]);
      break;
  }
}

function highlightText(text: string, query: string) {
  if (!query.trim()) return text;
  
  try {
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escapedQuery})`, 'gi'));
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === query.toLowerCase() ? (
            <mark key={i} className="bg-amber-200 rounded px-0.5">
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </>
    );
  } catch {
    return text;
  }
}

function formatPlusOneStatus(plusOnes: Guest[]) {
  const total = plusOnes.length;
  const checkedIn = plusOnes.filter(p => p.checkedIn).length;
  
  if (checkedIn === 0) {
    return { text: `+ ${total} guest${total > 1 ? 's' : ''}`, color: 'text-stone-500' };
  }
  if (checkedIn === total) {
    return { text: `+ ${total} guest${total > 1 ? 's' : ''} ✓`, color: 'text-amber-600' };
  }
  return { text: `+ ${checkedIn}/${total} guests in`, color: 'text-amber-500' };
}

export function GuestItem({ guest, onCheckIn, searchQuery }: GuestItemProps) {
  const [expanded, setExpanded] = useState(false);
  const hasPlusOnes = guest.plusOnes && guest.plusOnes.length > 0;
  const plusOneStatus = hasPlusOnes ? formatPlusOneStatus(guest.plusOnes) : null;

  return (
    <div className={`border-b border-stone-100 transition-colors ${guest.checkedIn ? 'bg-amber-50/50' : 'bg-white'}`}>
      <div 
        className="flex items-center p-4 gap-4"
        role="listitem"
        aria-label={`${guest.name}${guest.checkedIn ? ', checked in' : ''}`}
      >
        {/* Check-in button */}
        <button
          onClick={() => {
            hapticFeedback(guest.checkedIn ? 'light' : 'success');
            onCheckIn(guest.id, !guest.checkedIn);
          }}
          className={`flex-shrink-0 w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all active:scale-95 ${
            guest.checkedIn
              ? 'bg-amber-500 border-amber-500 shadow-sm shadow-amber-200'
              : 'border-stone-300 hover:border-amber-400 hover:bg-amber-50'
          }`}
          aria-label={guest.checkedIn ? 'Mark as not checked in' : 'Mark as checked in'}
          aria-pressed={guest.checkedIn}
        >
          {guest.checkedIn && (
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>

        {/* Guest info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-semibold ${guest.checkedIn ? 'text-amber-900' : 'text-stone-800'}`}>
              {highlightText(guest.name, searchQuery)}
            </span>
            {plusOneStatus && (
              <span className={`text-xs font-medium ${plusOneStatus.color}`}>
                {plusOneStatus.text}
              </span>
            )}
          </div>
          
          {guest.fullName && guest.fullName !== guest.name && (
            <div className="text-sm text-stone-500 mt-0.5 truncate">
              {highlightText(guest.fullName, searchQuery)}
            </div>
          )}
          
          {guest.checkedIn && guest.checkedInAt && (
            <div className="text-xs text-amber-600 mt-1 flex items-center gap-1">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
              </svg>
              {new Date(guest.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>

        {/* Expand button for +1s */}
        {hasPlusOnes && (
          <button
            onClick={() => setExpanded(!expanded)}
            className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
              expanded 
                ? 'bg-stone-200 text-stone-700' 
                : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
            }`}
            aria-label={expanded ? 'Hide guests' : 'Show guests'}
            aria-expanded={expanded}
          >
            <svg
              className={`w-5 h-5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>

      {/* Expanded +1s section */}
      {expanded && hasPlusOnes && (
        <div className="bg-stone-50 border-t border-stone-100">
          {guest.plusOnes.map((plusOne, index) => (
            <div 
              key={plusOne.id} 
              className={`flex items-center py-3 px-4 pl-14 gap-3 ${
                index < guest.plusOnes.length - 1 ? 'border-b border-stone-100' : ''
              }`}
            >
              <button
                onClick={() => {
                  hapticFeedback(plusOne.checkedIn ? 'light' : 'success');
                  onCheckIn(plusOne.id, !plusOne.checkedIn);
                }}
                className={`flex-shrink-0 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all active:scale-95 ${
                  plusOne.checkedIn
                    ? 'bg-amber-500 border-amber-500'
                    : 'border-stone-300 hover:border-amber-400'
                }`}
                aria-label={plusOne.checkedIn ? 'Mark as not checked in' : 'Mark as checked in'}
              >
                {plusOne.checkedIn && (
                  <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              
              <div className="flex-1 min-w-0">
                <span className={`text-sm font-medium ${plusOne.checkedIn ? 'text-amber-800' : 'text-stone-700'}`}>
                  {highlightText(plusOne.name, searchQuery)}
                </span>
                {plusOne.fullName && plusOne.fullName !== plusOne.name && (
                  <div className="text-xs text-stone-500 mt-0.5 truncate">
                    {highlightText(plusOne.fullName, searchQuery)}
                  </div>
                )}
                {plusOne.checkedIn && plusOne.checkedInAt && (
                  <div className="text-xs text-amber-600 mt-0.5">
                    {new Date(plusOne.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
