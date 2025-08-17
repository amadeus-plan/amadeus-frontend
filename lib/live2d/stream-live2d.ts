import { RemoteTrack } from "livekit-client";

/**
 * Audio data state interface
 */
export interface AudioDataState {
  /** Whether the stream is active */
  isActive: boolean;
  /** Whether an analyzer exists */
  hasAnalyzer: boolean;
  /** AudioContext state */
  contextState?: string;
}

/**
 * StreamLive2DModel interface definition
 */
export interface IStreamLive2DModel {
  /**
   * Connect LiveKit audio track for real-time lip sync
   */
  connectLiveKitAudio(audioElement: HTMLAudioElement, track?: RemoteTrack): Promise<boolean>;

  /**
   * Connect MediaStream for real-time lip sync
   */
  connectMediaStream(mediaStream: MediaStream): Promise<boolean>;

  /**
   * Disconnect audio stream
   */
  disconnectStream(): void;

  /**
   * Check whether the stream is active
   */
  readonly isStreaming: boolean;

  /**
   * Get current audio analysis data (for debugging)
   */
  getAudioData(): AudioDataState;
}

/**
 * Streaming Live2D audio processor
 * Adds real-time audio stream lip-sync capability to any Live2DModel instance
 */
export class StreamLive2DAudioProcessor implements IStreamLive2DModel {
  private streamAudioElement?: HTMLAudioElement;
  private streamAnalyzer?: AnalyserNode;
  private streamContext?: AudioContext;
  private streamSource?: MediaElementAudioSourceNode | MediaStreamAudioSourceNode;
  private silentGain?: GainNode;
  private isStreamActive = false;
  private animationFrameId?: number;
  private targetModel?: any; // Live2DModel instance
  // Noise gate threshold (after amplification, 0-1). Below this is treated as silence
  private noiseGateThreshold = 0.2;
  // Previous value for simple low-pass smoothing of mouth parameter
  private lastMouthValue = 0;

  constructor(targetModel?: any) {
    this.targetModel = targetModel;
  }

  /**
   * Set target Live2D model
   * @param model - Live2DModel instance
   */
  setTargetModel(model: any): void {
    this.targetModel = model;
  }

  /**
   * Connect LiveKit audio track for real-time lip sync
   * @param audioElement - HTMLAudioElement from LiveKit
   * @param track - LiveKit RemoteTrack (optional, for additional info)
   */
  async connectLiveKitAudio(audioElement: HTMLAudioElement, track?: RemoteTrack): Promise<boolean> {
    try {
      console.log('Connecting LiveKit audio for lip sync');

      // Stop previous audio stream
      this.disconnectStream();

      // Set audio element
      this.streamAudioElement = audioElement;

      // Create AudioContext (compatible with webkit prefix)
      const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      this.streamContext = new AC();

      // Prefer MediaStreamAudioSourceNode for Android compatibility
      const srcObj = (audioElement as any).srcObject as MediaStream | null | undefined;
      if (srcObj instanceof MediaStream) {
        // Use MediaStream when available
        this.streamSource = this.streamContext.createMediaStreamSource(srcObj);
      } else {
        // Fallback to media element source
        this.streamSource = this.streamContext.createMediaElementSource(audioElement);
      }

      // Create analyzer
      this.streamAnalyzer = this.streamContext.createAnalyser();
      this.streamAnalyzer.fftSize = 256;
      this.streamAnalyzer.smoothingTimeConstant = 0.9;

      // Connect audio graph; keep graph alive via zero-gain node to avoid double playback
      this.silentGain = this.streamContext.createGain();
      this.silentGain.gain.value = 0;
      this.streamSource.connect(this.streamAnalyzer);
      this.streamSource.connect(this.silentGain);
      this.silentGain.connect(this.streamContext.destination);

      // Try to ensure playback and resume the context on Chrome/WebView
      const tryResume = async () => {
        try {
          if (this.streamContext && this.streamContext.state === 'suspended') {
            await this.streamContext.resume();
          }
        } catch {}
      };

      // Ensure element attempts to play (Chrome may require this before WebAudio pulls data)
      try {
        if (audioElement.paused) {
          await audioElement.play().catch(() => {});
        }
      } catch {}

      await tryResume();

      // Fallback: resume context on first user gesture
      const resumeOnGesture = async () => {
        await tryResume();
        document.removeEventListener('click', resumeOnGesture);
        document.removeEventListener('touchstart', resumeOnGesture);
        document.removeEventListener('keydown', resumeOnGesture);
      };
      document.addEventListener('click', resumeOnGesture, { once: true });
      document.addEventListener('touchstart', resumeOnGesture, { once: true });
      document.addEventListener('keydown', resumeOnGesture, { once: true });

      // Also resume when the element starts playing
      const onPlaying = () => { tryResume(); audioElement.removeEventListener('playing', onPlaying); };
      audioElement.addEventListener('playing', onPlaying, { once: true });

      // Mark active and start analysis
      this.isStreamActive = true;
      this.startAudioAnalysis();

      console.log('LiveKit audio connected successfully');
      return true;

    } catch (error) {
      console.error('Failed to connect LiveKit audio:', error);
      return false;
    }
  }

  /**
   * Connect MediaStream for real-time lip sync
   * @param mediaStream - audio MediaStream
   */
  async connectMediaStream(mediaStream: MediaStream): Promise<boolean> {
    try {
      console.log('Connecting MediaStream for lip sync');

      // Stop previous audio stream
      this.disconnectStream();

      // Create AudioContext (compatible with webkit prefix)
      const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      this.streamContext = new AC();

      // Create audio source
      this.streamSource = this.streamContext.createMediaStreamSource(mediaStream);

      // Create analyzer
      this.streamAnalyzer = this.streamContext.createAnalyser();
      this.streamAnalyzer.fftSize = 256;
      this.streamAnalyzer.smoothingTimeConstant = 0.9;

      // Connect audio graph; keep graph alive via zero-gain node to avoid double playback
      this.silentGain = this.streamContext.createGain();
      this.silentGain.gain.value = 0;
      this.streamSource.connect(this.streamAnalyzer);
      this.streamSource.connect(this.silentGain);
      this.silentGain.connect(this.streamContext.destination);

      // Resume context if needed
      if (this.streamContext.state === 'suspended') {
        try { await this.streamContext.resume(); } catch {}
      }

      // Mark as active
      this.isStreamActive = true;

      // Start audio analysis loop
      this.startAudioAnalysis();

      console.log('MediaStream connected successfully');
      return true;

    } catch (error) {
      console.error('Failed to connect MediaStream:', error);
      return false;
    }
  }

  /**
   * Start audio analysis and lip-sync update loop
   */
  private startAudioAnalysis(): void {
    if (!this.isStreamActive || !this.streamAnalyzer) {
      return;
    }

    const updateLipSync = () => {
      if (!this.isStreamActive || !this.streamAnalyzer || !this.targetModel) {
        return;
      }

      // Get audio data
      const audioValue = this.analyzeAudio(this.streamAnalyzer);

      // Update Live2D model mouth parameters
      this.updateMouthParameters(audioValue);

      // Continue to next frame
      this.animationFrameId = requestAnimationFrame(updateLipSync);
    };

    // Start update loop
    this.animationFrameId = requestAnimationFrame(updateLipSync);
  }

  /**
   * Analyze audio data and compute lip-sync value
   * @param analyzer - Web Audio API AnalyserNode
   * @returns audio intensity (0-1)
   */
  private analyzeAudio(analyzer: AnalyserNode): number {
    const pcmData = new Float32Array(analyzer.fftSize);
    let sumSquares = 0.0;
    analyzer.getFloatTimeDomainData(pcmData);

    for (const amplitude of pcmData) {
      sumSquares += amplitude * amplitude;
    }

    // Compute RMS value and amplify
    const rms = Math.sqrt(sumSquares / pcmData.length);
    const amplified = rms * 20;

    // Clamp to 0-1 range
    return Math.min(Math.max(amplified, 0), 1);
  }

  /**
   * Update Live2D model mouth parameters
   * @param audioValue - audio intensity
   */
  private updateMouthParameters(audioValue: number): void {
    if (!this.targetModel?.internalModel?.motionManager) {
      return;
    }

    // Noise gate: filter out silence/background noise
    let value = audioValue;
    const max_ = 1;
    const bias_weight = 1.2;
    const bias_power = 0.7;

    if (value < this.noiseGateThreshold) {
      value = 0;
    } else {
      // Remove threshold and normalize remaining dynamic range
      value = (value - this.noiseGateThreshold) / (1 - this.noiseGateThreshold);
    }

    // Dynamic shaping
    value = Math.pow(value, bias_power) * bias_weight;
    value = Math.min(Math.max(value, 0), max_);

    // Simple smoothing to suppress high-frequency jitter
    value = 0.5 * value + 0.5 * this.lastMouthValue;
    this.lastMouthValue = value;

    // Get lip-sync parameter IDs
    const lipSyncIds = this.targetModel.internalModel.motionManager.lipSyncIds || [];

    // Update Cubism 2.1 model
    if (this.targetModel.internalModel.coreModel?.setParamFloat) {
      const coreModel = this.targetModel.internalModel.coreModel;
      for (let i = 0; i < lipSyncIds.length; ++i) {
        const paramIndex = coreModel.getParamIndex(lipSyncIds[i]);
        if (paramIndex >= 0) {
          coreModel.setParamFloat(paramIndex, value);
        }
      }
    }

    // Update Cubism 4 model
    if (this.targetModel.internalModel.coreModel?.addParameterValueById) {
      const coreModel = this.targetModel.internalModel.coreModel;
      for (let i = 0; i < lipSyncIds.length; ++i) {
        coreModel.addParameterValueById(lipSyncIds[i], value, 0.8);
      }
    }
  }

  /**
   * Disconnect audio stream
   */
  disconnectStream(): void {
    console.log('Disconnecting audio stream');

    // Stop animation loop
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }

    // Mark as inactive
    this.isStreamActive = false;

    // Disconnect audio graph
    if (this.streamSource) {
      this.streamSource.disconnect();
      this.streamSource = undefined;
    }

    if (this.streamAnalyzer) {
      this.streamAnalyzer.disconnect();
      this.streamAnalyzer = undefined;
    }

    if (this.silentGain) {
      this.silentGain.disconnect();
      this.silentGain = undefined;
    }

    if (this.streamContext && this.streamContext.state !== 'closed') {
      this.streamContext.close();
      this.streamContext = undefined;
    }

    // Clear audio element reference
    this.streamAudioElement = undefined;
  }

  /**
   * Check whether the stream is active
   */
  get isStreaming(): boolean {
    return this.isStreamActive;
  }

  /**
   * Get current audio analysis data (for debugging)
   */
  getAudioData(): AudioDataState {
    return {
      isActive: this.isStreamActive,
      hasAnalyzer: !!this.streamAnalyzer,
      contextState: this.streamContext?.state
    };
  }

  /**
   * Destroy processor and clean up resources
   */
  destroy(): void {
    this.disconnectStream();
    this.targetModel = undefined;
  }
}

/**
 * Factory function to create a StreamLive2DModel
 * Adds streaming audio processing to an existing Live2DModel instance
 * @param baseModel - existing Live2DModel instance
 * @returns extended model instance
 */
export function createStreamLive2DModel(baseModel: any): any {
  const audioProcessor = new StreamLive2DAudioProcessor(baseModel);

  // Attach audio processor methods onto the base model
  baseModel.connectLiveKitAudio = audioProcessor.connectLiveKitAudio.bind(audioProcessor);
  baseModel.connectMediaStream = audioProcessor.connectMediaStream.bind(audioProcessor);
  baseModel.disconnectStream = audioProcessor.disconnectStream.bind(audioProcessor);
  baseModel.isStreaming = audioProcessor.isStreaming;
  baseModel.getAudioData = audioProcessor.getAudioData.bind(audioProcessor);

  // Keep reference for cleanup
  baseModel._streamProcessor = audioProcessor;

  // Override destroy to ensure cleanup
  const originalDestroy = baseModel.destroy?.bind(baseModel);
  baseModel.destroy = () => {
    audioProcessor.destroy();
    if (originalDestroy) {
      originalDestroy();
    }
  };

  return baseModel;
}

// For backward compatibility, export StreamLive2DModel as an alias
export const StreamLive2DModel = StreamLive2DAudioProcessor;
