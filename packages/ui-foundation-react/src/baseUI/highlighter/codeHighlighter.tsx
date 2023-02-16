// eslint-disable-next-line import/no-extraneous-dependencies
import React, { memo } from 'react';
import type { SyntaxHighlighterProps } from 'react-syntax-highlighter';
import Highlighter from 'react-syntax-highlighter/dist/esm/light';
import ts from 'react-syntax-highlighter/dist/esm/languages/hljs/typescript';
import defaultTheme from 'react-syntax-highlighter/dist/esm/styles/hljs/xcode';

Highlighter.registerLanguage('typescript', ts);

export const CodeHighlighter = memo(function SnippetWrapper(props: SyntaxHighlighterProps) {
  return <Highlighter theme={defaultTheme} {...props} />;
});
