import { useEffect, type ReactNode } from 'react';

/**
 * App shell shared by auth and the signed-in coach. On desktop this is the centered mockup chrome
 * (bezel, notch, status bar, home indicator). On narrow viewports (≤480px) CSS strips that chrome
 * so the same tree fills the real device as a native-feeling app — no doubled status bars, no page scroll.
 *
 * On mobile, pin height/top to the visual viewport so iOS keyboard focus doesn't pan the page
 * (the name field, composer, etc. shrink the shell instead of scrolling it).
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;

    const sync = () => {
      const vv = window.visualViewport;
      if (!vv) {
        root.style.setProperty('--app-height', `${window.innerHeight}px`);
        root.style.setProperty('--app-top', '0px');
        return;
      }
      root.style.setProperty('--app-height', `${vv.height}px`);
      root.style.setProperty('--app-top', `${vv.offsetTop}px`);
    };

    sync();
    window.visualViewport?.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    return () => {
      window.visualViewport?.removeEventListener('resize', sync);
      window.visualViewport?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      root.style.removeProperty('--app-height');
      root.style.removeProperty('--app-top');
    };
  }, []);

  return (
    <div className="device">
      <div className="glass">
        <div className="island" />
        <div className="statusbar">
          <span>9:41</span>
          <span className="sicons">
            <svg width="17" height="11" viewBox="0 0 17 11" aria-hidden>
              <rect x="1" y="6" width="2.5" height="4" rx="1" fill="currentColor" />
              <rect x="5" y="4" width="2.5" height="6" rx="1" fill="currentColor" />
              <rect x="9" y="2" width="2.5" height="8" rx="1" fill="currentColor" />
              <rect x="13" y="0" width="2.5" height="10" rx="1" fill="currentColor" />
            </svg>
            <svg width="25" height="12" viewBox="0 0 25 12" aria-hidden>
              <rect className="stroke" x="1" y="1" width="20" height="10" rx="3" opacity=".5" />
              <rect x="3" y="3" width="13" height="6" rx="1.5" fill="currentColor" />
            </svg>
          </span>
        </div>
        <div className="screen">{children}</div>
        <div className="home-ind" />
      </div>
    </div>
  );
}
