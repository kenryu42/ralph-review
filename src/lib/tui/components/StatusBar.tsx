interface StatusBarProps {
  hasSession: boolean;
}

export function StatusBar({ hasSession }: StatusBarProps) {
  return (
    <box flexDirection="row" justifyContent="center" gap={3} paddingTop={1}>
      <text>
        <span fg="#60a5fa">[q]</span>
        <span fg="#9ca3af"> Quit</span>
      </text>
      {hasSession && (
        <text>
          <span fg="#60a5fa">[s]</span>
          <span fg="#9ca3af"> Stop</span>
        </text>
      )}
    </box>
  );
}
