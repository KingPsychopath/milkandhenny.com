export function RevealLine({ children }: { children: string }) {
  return (
    <span className="pitch-night-line">
      <span data-copy-line>{children}</span>
    </span>
  );
}

export function SceneNumber({ children }: { children: string }) {
  return <span className="pitch-night-scene-number">{children}</span>;
}
