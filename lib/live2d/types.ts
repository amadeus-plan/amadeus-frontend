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
     * @param audioElement - HTMLAudioElement from LiveKit
     * @param track - LiveKit RemoteTrack (optional, for additional info)
     * @returns Promise<boolean> - whether the connection succeeded
     */
    connectLiveKitAudio(audioElement: HTMLAudioElement, track?: RemoteTrack): Promise<boolean>;

    /**
     * Connect MediaStream for real-time lip sync
     * @param mediaStream - audio MediaStream
     * @returns Promise<boolean> - whether the connection succeeded
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
     * @returns audio data state
     */
    getAudioData(): AudioDataState;
}

/**
 * Audio analysis configuration
 */
export interface AudioAnalysisConfig {
    /** FFT size */
    fftSize?: number;
    /** Smoothing time constant */
    smoothingTimeConstant?: number;
    /** Audio amplification factor */
    amplificationFactor?: number;
    /** Bias weight */
    biasWeight?: number;
    /** Bias power */
    biasPower?: number;
}

/**
 * Lip-sync parameter configuration
 */
export interface LipSyncConfig extends AudioAnalysisConfig {
    /** Minimum value */
    minValue?: number;
    /** Maximum value */
    maxValue?: number;
    /** Blend weight for parameters */
    blendWeight?: number;
}

/**
 * Extended Live2DModel type including possible StreamLive2DModel methods
 */
export type ExtendedLive2DModel = any & Partial<IStreamLive2DModel>; 