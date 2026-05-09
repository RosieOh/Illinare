export function speakKorean(text: string) {
  if (typeof window === 'undefined') return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'ko-KR';
  utter.rate = 0.88;
  utter.pitch = 0.75;
  utter.volume = 1;

  const speak = () => {
    const voices = window.speechSynthesis.getVoices();
    const korean = voices.find(v => v.lang.startsWith('ko'));
    if (korean) utter.voice = korean;
    window.speechSynthesis.speak(utter);
  };

  if (window.speechSynthesis.getVoices().length > 0) {
    speak();
  } else {
    window.speechSynthesis.addEventListener('voiceschanged', speak, { once: true });
  }
}
