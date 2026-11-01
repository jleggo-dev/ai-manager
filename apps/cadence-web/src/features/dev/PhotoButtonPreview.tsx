import { useState } from 'react';
import { ChatComposer } from '../onboarding/ChatComposer.tsx';
import { useCoachAttachments } from '../onboarding/useCoachAttachments.ts';
import { SteerBox } from '../plan/SteerBox.tsx';
import { LogByChat } from '../food/LogByChat.tsx';
import { DescribeSheet } from '../food/meal/DescribeSheet.tsx';

const VIEWS = ['coach', 'meal chat', 'pencil', 'steer'] as const;
type View = (typeof VIEWS)[number];

/** `?preview=photos` — the camera on each chat that carries it (owner, 2026-11-01). Nothing is
 *  sent: picks land in a real tray (upload needs a session) or in an alert for the meal doors. */
export function PhotoButtonPreview() {
  const [view, setView] = useState<View>('coach');
  const [text, setText] = useState('');
  const tray = useCoachAttachments();
  const said = (photo: string, caption: string) => window.alert(`photo ${photo.length} chars · caption "${caption}"`);
  return (
    <div className="app" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 6, padding: 12, flexWrap: 'wrap' }}>
        {VIEWS.map((v) => (
          <button key={v} className={v === view ? 'lockbtn' : 'lockbtn ghost'} onClick={() => setView(v)}>
            {v}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
        {view === 'coach' && (
          <ChatComposer
            value={text}
            onChange={setText}
            onSend={() => {}}
            streaming={false}
            showDisclaimer
            tray={tray}
          />
        )}
        {view === 'meal chat' && <LogByChat meal="dinner" onLogged={() => {}} onBack={() => {}} onPhoto={said} />}
        {view === 'pencil' && <DescribeSheet meal="lunch" onAdd={async () => true} onClose={() => {}} onPhoto={said} />}
        {view === 'steer' && (
          <div style={{ padding: 16 }}>
            <SteerBox value={text} onChange={setText} onPhotos={(f) => void tray.add(f)} />
          </div>
        )}
      </div>
    </div>
  );
}
