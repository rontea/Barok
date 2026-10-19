import React from 'react';
import { describe, it, expect } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { FinalAnswerRenderer } from '../../ui/src/components/FinalAnswerRenderer';

describe('FinalAnswerRenderer', () => {
  it('renders markdown tables correctly', () => {
    const content = `
| Feature | Status |
| --- | --- |
| Table Support | Passed |
| Blockquotes | Passed |
`;
    const html = renderToStaticMarkup(React.createElement(FinalAnswerRenderer, { content }));
    expect(html).toContain('<table');
    expect(html).toContain('<thead');
    expect(html).toContain('<th');
    expect(html).toContain('Feature');
    expect(html).toContain('Table Support');
    expect(html).toMatchSnapshot();
  });

  it('renders horizontal rules correctly', () => {
    const content = `
Section 1
---
Section 2
***
Section 3
`;
    const html = renderToStaticMarkup(React.createElement(FinalAnswerRenderer, { content }));
    expect(html).toContain('<hr');
    expect(html).toMatchSnapshot();
  });

  it('renders blockquotes with callout styling', () => {
    const content = `
> This is an important note regarding the deployment.
> Make sure to verify credentials first.
`;
    const html = renderToStaticMarkup(React.createElement(FinalAnswerRenderer, { content }));
    expect(html).toContain('<blockquote');
    expect(html).toContain('border-cyan-600');
    expect(html).toContain('This is an important note regarding the deployment.');
    expect(html).toMatchSnapshot();
  });

  it('renders markdown links with cyan styling and target blank', () => {
    const content = 'Check the [documentation](https://docs.example.com) for details.';
    const html = renderToStaticMarkup(React.createElement(FinalAnswerRenderer, { content }));
    expect(html).toContain('<a');
    expect(html).toContain('href="https://docs.example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('documentation');
    expect(html).toMatchSnapshot();
  });

  it('renders nested bullet lists with indentation', () => {
    const content = `
- Root item 1
  - Child item 1.1
  - Child item 1.2
- Root item 2
`;
    const html = renderToStaticMarkup(React.createElement(FinalAnswerRenderer, { content }));
    expect(html).toContain('<ul');
    expect(html).toContain('<li');
    expect(html).toContain('Root item 1');
    expect(html).toContain('Child item 1.1');
    expect(html).toMatchSnapshot();
  });

  it('renders code blocks with syntax highlighting container', () => {
    const content = `
\`\`\`typescript
const greeting = "hello world";
console.log(greeting);
\`\`\`
`;
    const html = renderToStaticMarkup(React.createElement(FinalAnswerRenderer, { content }));
    expect(html).toContain('<pre');
    expect(html).toContain('<code');
    expect(html).toContain('hljs');
    expect(html).toContain('typescript');
    expect(html).toMatchSnapshot();
  });
});

