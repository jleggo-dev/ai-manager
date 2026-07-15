import type { ReactNode } from 'react';

/**
 * The centered phone chrome (device shell, notch, status bar, home indicator) from the concept
 * mockups. Extracted so both the signed-in app and the pre-auth AuthScreen render inside the same
 * frame. Children fill the screen area between the status bar and the home indicator.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
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
        {children}
        <div className="home-ind" />
      </div>
    </div>
  );
}
