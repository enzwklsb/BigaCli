// Use the same ReactMarkdown + GFM renderer dependencies as CloudCLI's chat.
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ReactMarkdown, {defaultUrlTransform} from 'react-markdown';
import remarkGfm from 'remark-gfm';

const external = href => /^(https?:|mailto:|tel:|#)/i.test(href || '');
const components = {
  table: ({children}) => <div className="tableScroll" tabIndex={0}><table>{children}</table></div>,
  a: ({href, children}) => external(href)
    ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    : <a href="#" className="file-link" data-file={href} data-name={typeof children === 'string' ? children : href}>{children}</a>,
};
export function render(source) {
  return renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}
    urlTransform={(url, key) => key === 'href' && (/^[A-Za-z]:[\\/]/.test(url) || !/^[a-z][a-z\d+.-]*:/i.test(url)) ? url : defaultUrlTransform(url)}>{source}</ReactMarkdown>);
}
