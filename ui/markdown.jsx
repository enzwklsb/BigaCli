// Use the same ReactMarkdown + GFM renderer dependencies as CloudCLI's chat.
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ReactMarkdown, {defaultUrlTransform} from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Repair only literal strong markers left unparsed at a punctuation/letter boundary.
// Already-parsed strong nodes, code and escaped source remain owned by the parser.
function remarkPunctuationStrong() {
  return (tree, file) => {
    const source=String(file);
    function walk(parent) {
      if(!parent.children||['strong','code','inlineCode','html'].includes(parent.type))return;
      parent.children=parent.children.flatMap(node=>{
        if(node.type!=='text'){walk(node);return [node];}
        if(source.slice(node.position?.start.offset,node.position?.end.offset)!==node.value)return [node];
        const parts=[];let end=0;
        for(const match of node.value.matchAll(/\*\*([^*\n]+\p{P})\*\*(?=[\p{L}\p{N}])/gu)){
          if(/^\s/u.test(match[1]))continue;
          if(match.index>end)parts.push({type:'text',value:node.value.slice(end,match.index)});
          parts.push({type:'strong',children:[{type:'text',value:match[1]}]});end=match.index+match[0].length;
        }
        if(!end)return [node];
        if(end<node.value.length)parts.push({type:'text',value:node.value.slice(end)});
        return parts;
      });
    }
    walk(tree);
  };
}

const external = href => /^(https?:|mailto:|tel:|#)/i.test(href || '');
function transformUrl(url, key) {
  // Markdown encodes Windows backslashes as %5C before URL filtering.
  if ((key === 'href' || key === 'src') && /^[A-Za-z]:(?:%5c|[\\/])/i.test(url)) {
    return url.replace(/%5c|\\/gi, '/');
  }
  return (key === 'href' || key === 'src') && (/^file:\/\//i.test(url) || !/^[a-z][a-z\d+.-]*:/i.test(url))
    ? url : defaultUrlTransform(url);
}
const components = {
  table: ({children}) => <div className="tableScroll" tabIndex={0}><table>{children}</table></div>,
  a: ({href, children}) => external(href)
    ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    : <a href="#" className="file-link" data-file={href} data-name={typeof children === 'string' ? children : href}>{children}</a>,
};
export function render(source, {imageUrl = src => src, copyLabel = 'Copy'} = {}) {
  const copyButton = <button type="button" className="codeBlockCopy" aria-label={copyLabel} title={copyLabel}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>;
  const pre = ({children}) => <div className="codeBlock"><pre>{children}</pre>{copyButton}</div>;
  const blockquote = ({children}) => <div className="quoteBlock"><blockquote>{children}</blockquote>{copyButton}</div>;
  const img = ({src, alt, title}) => {
    if (!src) return <span>{alt}</span>;
    const local = !/^(?:https?:)?\/\//i.test(src);
    return <button type="button" className="markdownImage thumbnailButton" data-file={local ? src : undefined}
      data-image-url={local ? undefined : src} data-name={alt || src} title={title || alt || src}>
      <img src={local ? imageUrl(src) : src} alt={alt || src} loading="lazy" />
    </button>;
  };
  return renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm,remarkPunctuationStrong]} components={{...components, img, pre, blockquote}}
    urlTransform={transformUrl}>{source}</ReactMarkdown>);
}
