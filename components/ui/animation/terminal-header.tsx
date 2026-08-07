'use client';

interface TerminalHeaderProps {
  expanded: boolean;
  onClose: () => void;
  onMinimize: () => void;
  onToggleExpand: () => void;
  onStartDrag: (clientX: number, clientY: number) => void;
}

/** macOS traffic-light header with window controls + drag handle. */
export default function TerminalHeader({
  expanded,
  onClose,
  onMinimize,
  onToggleExpand,
  onStartDrag,
}: TerminalHeaderProps) {
  return (
    <div
      onMouseDown={(e) => onStartDrag(e.clientX, e.clientY)}
      onTouchStart={(e) => onStartDrag(e.touches[0].clientX, e.touches[0].clientY)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        borderBottom: '1px solid rgba(34,197,94,0.2)',
        background: '#0d130d',
        cursor: 'move',
        userSelect: 'none',
        touchAction: 'none',
        position: 'relative',
        zIndex: 10,
      }}
    >
      <button
        onClick={onClose}
        title="Close"
        aria-label="Close terminal"
        className="w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-500 transition-colors cursor-pointer"
        style={{ border: 'none', padding: 0, flexShrink: 0 }}
      />
      <button
        onClick={onMinimize}
        title="Minimize"
        aria-label="Minimize terminal"
        className="w-3 h-3 rounded-full bg-yellow-500/80 hover:bg-yellow-500 transition-colors cursor-pointer"
        style={{ border: 'none', padding: 0, flexShrink: 0 }}
      />
      <button
        onClick={onToggleExpand}
        title={expanded ? 'Restore size' : 'Expand'}
        aria-label={expanded ? 'Restore terminal size' : 'Expand terminal'}
        className="w-3 h-3 rounded-full bg-green-500/80 hover:bg-green-500 transition-colors cursor-pointer"
        style={{ border: 'none', padding: 0, flexShrink: 0 }}
      />
      <span className="ml-2 text-xs text-green-500/60 font-mono flex-1">
        moony@dev: ~/portfolio
      </span>
    </div>
  );
}