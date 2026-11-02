/** 브라우저 내장 TTS. 한국어 음성이 있으면 우선 사용한다. */
export function speak(text: string, lang = 'ko-KR') {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 1.02;

  const start = () => {
    const voices = window.speechSynthesis.getVoices();
    const match = voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(lang.slice(0, 2)));
    if (match) utterance.voice = match;
    window.speechSynthesis.speak(utterance);
  };

  if (window.speechSynthesis.getVoices().length > 0) start();
  else window.speechSynthesis.addEventListener('voiceschanged', start, { once: true });
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}
