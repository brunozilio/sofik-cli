import React from "react";
import { Box, Text } from "ink";

type Segment = { text: string; bold?: boolean; code?: boolean; italic?: boolean };

function parseInline(text: string): Segment[] {
  const segments: Segment[] = [];
  // Match **bold**, *italic*, `code`
  const re = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ text: text.slice(lastIdx, match.index) });
    }
    const part = match[0]!;
    if (part.startsWith("**")) {
      segments.push({ text: part.slice(2, -2), bold: true });
    } else if (part.startsWith("`")) {
      segments.push({ text: part.slice(1, -1), code: true });
    } else if (part.startsWith("*")) {
      segments.push({ text: part.slice(1, -1), italic: true });
    }
    lastIdx = match.index + part.length;
  }

  if (lastIdx < text.length) {
    segments.push({ text: text.slice(lastIdx) });
  }
  return segments;
}

function InlineMd({ text }: { text: string }) {
  const segments = parseInline(text);
  if (segments.length === 1 && !segments[0]!.bold && !segments[0]!.code && !segments[0]!.italic) {
    return <Text>{text}</Text>;
  }
  return (
    <Text>
      {segments.map((seg, i) =>
        seg.code ? (
          <Text key={i} color="green">
            {seg.text}
          </Text>
        ) : seg.bold ? (
          <Text key={i} bold>
            {seg.text}
          </Text>
        ) : seg.italic ? (
          <Text key={i} italic>
            {seg.text}
          </Text>
        ) : (
          <Text key={i}>{seg.text}</Text>
        )
      )}
    </Text>
  );
}

export function Markdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeBlockKey = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Fenced code block
    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLines = [];
        codeBlockKey = i;
      } else {
        inCodeBlock = false;
        const captured = codeLines;
        const key = codeBlockKey;
        elements.push(
          <Box key={`code-${key}`} borderStyle="single" paddingX={1} marginY={0} flexDirection="column">
            {captured.map((cl, j) => (
              <Text key={j} color="green">
                {cl || " "}
              </Text>
            ))}
          </Box>
        );
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Headers
    if (line.startsWith("# ")) {
      elements.push(
        <Text key={i} bold color="cyan">
          {line.slice(2)}
        </Text>
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <Text key={i} bold underline>
          {line.slice(3)}
        </Text>
      );
    } else if (line.startsWith("### ")) {
      elements.push(
        <Text key={i} bold>
          {line.slice(4)}
        </Text>
      );
    } else if (line.startsWith("#### ")) {
      elements.push(
        <Text key={i} bold dimColor>
          {line.slice(5)}
        </Text>
      );
    } else if (/^[-*+] /.test(line)) {
      // Bullet list
      elements.push(
        <Box key={i} flexDirection="row">
          <Text color="cyan">{"  • "}</Text>
          <InlineMd text={line.slice(2)} />
        </Box>
      );
    } else if (/^\d+\. /.test(line)) {
      // Numbered list
      const m = line.match(/^(\d+)\. (.*)$/)!;
      elements.push(
        <Box key={i} flexDirection="row">
          <Text color="cyan">{`  ${m[1]}. `}</Text>
          <InlineMd text={m[2]!} />
        </Box>
      );
    } else if (line === "---" || line === "***" || line === "___") {
      elements.push(
        <Text key={i} dimColor>
          {"─".repeat(60)}
        </Text>
      );
    } else if (line.trim() === "") {
      elements.push(<Text key={i}>{""}</Text>);
    } else {
      elements.push(
        <Box key={i}>
          <InlineMd text={line} />
        </Box>
      );
    }
  }

  return <Box flexDirection="column">{elements}</Box>;
}
