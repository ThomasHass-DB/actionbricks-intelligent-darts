/**
 * Speech Service - Browser Web Speech API wrapper for text-to-speech
 * 
 * This service provides real-time text-to-speech functionality for live commentary
 * using the browser's built-in SpeechSynthesis API.
 */

export interface SpeechOptions {
  /** Speech rate (0.1 to 10, default 1.1 for commentary feel) */
  rate?: number;
  /** Pitch (0 to 2, default 1.0) */
  pitch?: number;
  /** Volume (0 to 1, default 1.0) */
  volume?: number;
  /** Preferred voice name (e.g., "Google UK English Male") */
  voiceName?: string;
  /** Language code (e.g., "en-GB" for British English) */
  lang?: string;
  /** Callback when speech starts */
  onStart?: () => void;
  /** Callback when speech ends */
  onEnd?: () => void;
  /** Callback on error */
  onError?: (error: SpeechSynthesisErrorEvent) => void;
}

const DEFAULT_OPTIONS: SpeechOptions = {
  rate: 1.1,      // Slightly faster for sports commentary
  pitch: 1.0,
  volume: 1.0,
  lang: 'en-GB',  // British English for that classic darts commentary feel
};

/**
 * Check if speech synthesis is supported in the current browser
 */
export function isSpeechSupported(): boolean {
  return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

/**
 * Get available voices, optionally filtered by language
 */
export function getAvailableVoices(lang?: string): SpeechSynthesisVoice[] {
  if (!isSpeechSupported()) return [];
  
  let voices = speechSynthesis.getVoices();
  
  if (lang) {
    voices = voices.filter(v => v.lang.startsWith(lang));
  }
  
  return voices;
}

/**
 * Get the best voice for sports commentary
 * Prefers British English voices, falls back to any English voice
 */
export function getBestCommentaryVoice(): SpeechSynthesisVoice | null {
  const voices = getAvailableVoices();
  
  // Priority order for commentary voices
  const preferredVoices = [
    'Google UK English Male',
    'Google UK English Female', 
    'Daniel',                    // macOS British voice
    'en-GB',                     // Any British English
    'en-US',                     // Fallback to US English
    'en'                         // Any English
  ];
  
  for (const preferred of preferredVoices) {
    const voice = voices.find(v => 
      v.name.includes(preferred) || v.lang.startsWith(preferred)
    );
    if (voice) return voice;
  }
  
  // Return first available voice as last resort
  return voices[0] || null;
}

/**
 * Speak the given text using the Web Speech API
 * 
 * @param text - The text to speak
 * @param options - Speech options (rate, pitch, voice, etc.)
 * @returns Promise that resolves when speech completes
 */
export function speak(text: string, options: SpeechOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isSpeechSupported()) {
      reject(new Error('Speech synthesis not supported in this browser'));
      return;
    }

    // Cancel any ongoing speech
    speechSynthesis.cancel();

    const opts = { ...DEFAULT_OPTIONS, ...options };
    const utterance = new SpeechSynthesisUtterance(text);

    // Set speech parameters
    utterance.rate = opts.rate!;
    utterance.pitch = opts.pitch!;
    utterance.volume = opts.volume!;
    utterance.lang = opts.lang!;

    // Set voice if specified or get best commentary voice
    if (opts.voiceName) {
      const voice = getAvailableVoices().find(v => v.name === opts.voiceName);
      if (voice) utterance.voice = voice;
    } else {
      const bestVoice = getBestCommentaryVoice();
      if (bestVoice) utterance.voice = bestVoice;
    }

    // Event handlers
    utterance.onstart = () => {
      opts.onStart?.();
    };

    utterance.onend = () => {
      opts.onEnd?.();
      resolve();
    };

    utterance.onerror = (event) => {
      opts.onError?.(event);
      reject(event);
    };

    // Speak!
    speechSynthesis.speak(utterance);
  });
}

/**
 * Stop any ongoing speech
 */
export function stopSpeaking(): void {
  if (isSpeechSupported()) {
    speechSynthesis.cancel();
  }
}

/**
 * Check if currently speaking
 */
export function isSpeaking(): boolean {
  if (!isSpeechSupported()) return false;
  return speechSynthesis.speaking;
}

/**
 * Pause current speech
 */
export function pauseSpeech(): void {
  if (isSpeechSupported()) {
    speechSynthesis.pause();
  }
}

/**
 * Resume paused speech
 */
export function resumeSpeech(): void {
  if (isSpeechSupported()) {
    speechSynthesis.resume();
  }
}

/**
 * Speech service class for managing commentary speech with queue
 */
export class CommentarySpeechService {
  private queue: string[] = [];
  private isProcessing = false;
  private enabled = true;
  private options: SpeechOptions;

  constructor(options: SpeechOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    
    // Load voices (they may load asynchronously)
    if (isSpeechSupported()) {
      speechSynthesis.getVoices();
      // Some browsers need this event to load voices
      speechSynthesis.onvoiceschanged = () => {
        speechSynthesis.getVoices();
      };
    }
  }

  /**
   * Enable or disable speech
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stop();
    }
  }

  /**
   * Check if speech is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Add commentary to the speech queue
   */
  async speakCommentary(text: string): Promise<void> {
    if (!this.enabled || !isSpeechSupported()) return;

    this.queue.push(text);
    
    if (!this.isProcessing) {
      await this.processQueue();
    }
  }

  /**
   * Process the speech queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;

    while (this.queue.length > 0 && this.enabled) {
      const text = this.queue.shift();
      if (text) {
        try {
          await speak(text, this.options);
        } catch (error) {
          console.error('Speech error:', error);
        }
      }
    }

    this.isProcessing = false;
  }

  /**
   * Stop speaking and clear the queue
   */
  stop(): void {
    this.queue = [];
    stopSpeaking();
    this.isProcessing = false;
  }

  /**
   * Update speech options
   */
  updateOptions(options: Partial<SpeechOptions>): void {
    this.options = { ...this.options, ...options };
  }
}

// Export a singleton instance for easy use
export const commentarySpeech = new CommentarySpeechService();

