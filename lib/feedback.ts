/**
 * Audio and haptic feedback utilities
 * Provides cross-platform feedback for user interactions
 */

/** Trigger haptic feedback on supported devices */
export function hapticFeedback(type: 'light' | 'medium' | 'success' | 'reveal' | 'celebration') {
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
    case 'reveal':
      // Dramatic reveal pattern
      navigator.vibrate([50, 100, 100]);
      break;
    case 'celebration':
      // Celebratory pattern for voting
      navigator.vibrate([30, 80, 30, 80, 50]);
      break;
  }
}

// Shared audio context (created on first use)
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  
  // Get AudioContext constructor (supports both standard and webkit prefix)
  const AudioContextClass = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  
  if (!audioContext) {
    try {
      audioContext = new AudioContextClass();
    } catch {
      return null;
    }
  }
  
  return audioContext;
}

/**
 * Play a subtle audio tone using Web Audio API
 * Works on all devices including iOS
 */
function playTone(frequency: number, duration: number, volume: number = 0.1) {
  const ctx = getAudioContext();
  if (!ctx) return;
  
  try {
    // Resume audio context if suspended (required on iOS after user interaction)
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        // Retry playing after resume
        playToneInternal(ctx, frequency, duration, volume);
      }).catch(() => {
        // Silently fail if resume fails
      });
      return;
    }
    
    playToneInternal(ctx, frequency, duration, volume);
  } catch {
    // Silently fail if audio playback fails
  }
}

function playToneInternal(ctx: AudioContext, frequency: number, duration: number, volume: number) {
  try {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
  } catch {
    // Silently fail
  }
}

/**
 * Combined audio and haptic feedback
 */
export function playFeedback(type: 'check-in' | 'check-out' | 'vote' | 'reveal') {
  // Haptic feedback (works on Android, limited on iOS)
  switch (type) {
    case 'check-in':
      hapticFeedback('success');
      playTone(800, 0.1, 0.08); // Pleasant high tone
      break;
    case 'check-out':
      hapticFeedback('light');
      playTone(400, 0.08, 0.06); // Lower tone
      break;
    case 'vote':
      hapticFeedback('celebration');
      // Ascending chord for celebration
      playTone(523, 0.1, 0.08); // C
      setTimeout(() => playTone(659, 0.1, 0.08), 50); // E
      setTimeout(() => playTone(784, 0.1, 0.08), 100); // G
      break;
    case 'reveal':
      hapticFeedback('reveal');
      // Building tone for reveal
      playTone(440, 0.15, 0.1); // A
      setTimeout(() => playTone(554, 0.2, 0.1), 100); // C#
      break;
  }
}
