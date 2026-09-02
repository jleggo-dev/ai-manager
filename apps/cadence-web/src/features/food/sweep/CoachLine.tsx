/**
 * The coach's leaf-and-bubble row as the sweep surfaces draw it (canvas S3/S4). The avatar is the
 * canvas's own leaf mark — presentation only: to the user there is only the coach, and this row is
 * how her one line of the sweep is spoken.
 */
export function CoachLeaf() {
  return (
    <span className="sw-ava" aria-hidden>
      <svg width="17" height="17" viewBox="0 0 24 24">
        <path d="M12 3c5 1 8 4 8 9 0 5-4 9-9 9-1.5 0-3-.4-4-1 4-1 7-4 8-9-2 3-5 5-8 5 2-6 5-11 5-13z" fill="white" />
      </svg>
    </span>
  );
}

export function CoachLine({ text }: { text: string }) {
  return (
    <div className="sw-coach">
      <CoachLeaf />
      <span className="sw-bubble">{text}</span>
    </div>
  );
}
