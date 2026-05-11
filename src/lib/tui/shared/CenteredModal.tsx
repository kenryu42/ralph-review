import type { ReactNode } from "react";

interface CenteredModalProps {
  title: string;
  width: number;
  height?: number;
  padding?: number;
  backgroundColor?: string;
  children: ReactNode;
}

export function CenteredModal({
  title,
  width,
  height,
  padding = 2,
  backgroundColor = "#1a1a2e",
  children,
}: CenteredModalProps) {
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
        padding={padding}
        width={width}
        height={height}
        backgroundColor={backgroundColor}
      >
        {children}
      </box>
    </box>
  );
}
