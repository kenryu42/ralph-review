import type { ReactNode } from "react";

interface CenteredModalProps {
  title: string;
  width: number;
  children: ReactNode;
}

export function CenteredModal({ title, width, children }: CenteredModalProps) {
  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <box
        border
        borderStyle="double"
        title={title}
        titleAlignment="left"
        padding={2}
        width={width}
        backgroundColor="#1a1a2e"
      >
        {children}
      </box>
    </box>
  );
}
