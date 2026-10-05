let context: AudioContext | null = null;

export function beep(): void {
  if (!navigator.userActivation?.hasBeenActive) return;
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") context.resume().catch(() => {});
    const start = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.4);
  } catch {
    context = null;
  }
}
