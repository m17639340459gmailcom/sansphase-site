import { profileNameInk } from './community-name-effects.mjs';

type Profile = {
  intro: HTMLElement;
  name: HTMLElement;
  image: HTMLImageElement | null;
  key: string;
  update: () => void;
  observer: ResizeObserver | null;
};

/** Read the already-loaded cover only at the name's actual cover-fitted position.
 * No extra fetch, frame polling, cover filter, layout mutation or saved user data. */
export function createCommunityProfileContrast(document: Document, window: Window) {
  const profiles = new Map<HTMLElement, Profile>();
  let canvas: HTMLCanvasElement | null = null;
  let stopped = false;
  const background = (intro: HTMLElement) => {
    const hero = intro.closest('.community-m-hero') || intro;
    const style = window.getComputedStyle(hero);
    // The shared card is a subtle gradient, so backgroundColor alone is fully
    // transparent. Its lower stop is the existing surface behind the name.
    return style.backgroundImage !== 'none'
      ? style.getPropertyValue('--community-reading-card-bottom').trim() || style.getPropertyValue('--surface').trim()
      : style.backgroundColor;
  };
  const update = (profile: Profile) => {
    if (stopped || !profile.intro.isConnected) return;
    const { intro, name, image } = profile;
    // Built-in covers are dark artwork in either theme; ordinary theme colours
    // must never turn their names black. The image fallback is the visible card.
    let ink = '#ffffff';
    if (image) {
      const base = background(intro);
      const box = image.getBoundingClientRect(), text = name.getBoundingClientRect();
      if (!box.width || !box.height || !text.width || !text.height) return;
      const left = text.left - box.left, top = text.top - box.top;
      const key = [image.currentSrc || image.src, image.complete, image.naturalWidth, image.naturalHeight,
        box.width, box.height, left, top, text.width, text.height, base].join('|');
      if (profile.key === key) return;
      profile.key = key;
      ink = document.body.dataset.communityTheme === 'light' ? '#000000' : '#ffffff';
      try {
        canvas ||= document.createElement('canvas');
        // Reset between covers, including after any unexpectedly tainted image.
        canvas.width = 32; canvas.height = 12;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (context) {
          context.fillStyle = document.body.dataset.communityTheme === 'light' ? '#f3eee4' : '#1c2d46';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = base;
          context.fillRect(0, 0, canvas.width, canvas.height);
          if (image.complete && image.naturalWidth && image.naturalHeight) {
            const scale = Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight);
            // community-profile.css defines object-fit: cover, position: center.
            // Draw through the small sampling window; transparent pixels retain
            // the actual card colour underneath, and the DOM image is untouched.
            context.drawImage(image,
              ((box.width - image.naturalWidth * scale) / 2 - left) * canvas.width / text.width,
              ((box.height - image.naturalHeight * scale) / 2 - top) * canvas.height / text.height,
              image.naturalWidth * scale * canvas.width / text.width,
              image.naturalHeight * scale * canvas.height / text.height);
          }
          ink = profileNameInk(context.getImageData(0, 0, canvas.width, canvas.height).data);
        }
      } catch { /* A failed/CORS-blocked cover keeps readable card fallback ink. */ }
    }
    if (intro.style.getPropertyValue('--profile-name-ink') !== ink) intro.style.setProperty('--profile-name-ink', ink);
  };
  const refresh = () => { for (const profile of profiles.values()) update(profile); };
  const remove = (profile: Profile) => {
    profile.observer?.disconnect();
    profile.image?.removeEventListener('load', profile.update);
    profile.image?.removeEventListener('error', profile.update);
    profiles.delete(profile.intro);
  };
  // Observe only the theme attribute, never a subtree or our own style writes.
  const themeObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(refresh);
  themeObserver?.observe(document.body, { attributes: true, attributeFilter: ['data-community-theme'] });
  document.fonts?.addEventListener('loadingdone', refresh);
  window.addEventListener('resize', refresh, { passive: true });
  return {
    sync(root: ParentNode) {
      if (stopped) return;
      for (const profile of profiles.values()) {
        if (!root.contains(profile.intro) || profile.name !== profile.intro.querySelector('.community-m-name h1 .community-uname')
          || profile.image !== profile.intro.querySelector('.community-m-cover > img')) remove(profile);
      }
      for (const intro of root.querySelectorAll<HTMLElement>('.community-m-intro')) {
        if (profiles.has(intro)) continue;
        const name = intro.querySelector<HTMLElement>('.community-m-name h1 .community-uname');
        if (!name) continue;
        const image = intro.querySelector<HTMLImageElement>('.community-m-cover > img');
        const profile: Profile = { intro, name, image, key: '', update: () => update(profile), observer: null };
        profiles.set(intro, profile);
        if (typeof ResizeObserver !== 'undefined') {
          profile.observer = new ResizeObserver(profile.update);
          profile.observer.observe(intro); profile.observer.observe(name);
        }
        image?.addEventListener('load', profile.update);
        image?.addEventListener('error', profile.update);
      }
      refresh();
    },
    dispose() {
      stopped = true;
      for (const profile of profiles.values()) remove(profile);
      themeObserver?.disconnect();
      document.fonts?.removeEventListener('loadingdone', refresh);
      window.removeEventListener('resize', refresh);
      canvas = null;
    },
  };
}
