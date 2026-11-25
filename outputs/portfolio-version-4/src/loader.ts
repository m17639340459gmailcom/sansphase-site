// Loader: SANSPHASE breathes through Archivo's width axis while assets load and
// a counter runs; at 100% the letters lift away and the veil fades.
import gsap from 'gsap';

export type LoaderOptions = {
  progress: () => number;
  reduced: boolean;
  onHandOver: () => void;
};

export function runLoader(o: LoaderOptions): Promise<void> {
  const root = document.getElementById('loader')!;
  const count = document.getElementById('loader-count')!;
  const word = root.querySelector<HTMLElement>('.loader-word')!;
  word.innerHTML = Array.from('SANSPHASE', (c) => `<span>${c}</span>`).join('');
  const letters = Array.from(word.children) as HTMLElement[];

  const breathe = gsap.timeline({ repeat: -1 });
  if (!o.reduced) {
    letters.forEach((letter, i) => {
      breathe.fromTo(letter, { '--w': 62 }, { '--w': 125, duration: 0.9, ease: 'sine.inOut', yoyo: true, repeat: 1 }, i * 0.09);
    });
  }

  return new Promise((resolve) => {
    let done = false;
    const minimum = gsap.to({}, { duration: o.reduced ? 0.3 : 2.2, ease: 'none' });
    const tick = () => {
      const p = Math.min(minimum.progress(), o.progress());
      count.textContent = String(Math.round(p * 100)).padStart(3, '0');
      if (p >= 1 && !done) finish();
    };
    const finish = () => {
      done = true;
      gsap.ticker.remove(tick);
      breathe.kill();
      root.style.pointerEvents = 'none';
      const tl = gsap.timeline({
        onComplete: () => {
          root.style.display = 'none';
          resolve();
        },
      });
      if (o.reduced) {
        tl.add(() => o.onHandOver()).to(root, { opacity: 0, duration: 0.3 });
        return;
      }
      tl.to(letters, { '--w': 125, duration: 0.45, ease: 'expo.out', stagger: 0.02 })
        .to(letters, { yPercent: -120, opacity: 0, duration: 0.6, ease: 'expo.in', stagger: 0.025 }, '+=0.05')
        .to('.loader-meta, #loader-count', { opacity: 0, y: 20, duration: 0.5, ease: 'expo.in' }, '<')
        .add(() => o.onHandOver(), '-=0.1')
        .to('.loader-veil', { opacity: 0, duration: 0.9, ease: 'power2.inOut' }, '<');
    };
    gsap.ticker.add(tick);
  });
}
