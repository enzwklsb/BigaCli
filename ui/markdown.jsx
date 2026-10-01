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
  if (key === 'href' && /^[A-Za-z]:(?:%5c|[\\/])/i.test(url)) {
    return url.replace(/%5c|\\/gi, '/');
  }
  return key === 'href' && (/^file:\/\//i.test(url) || !/^[a-z][a-z\d+.-]*:/i.test(url))
    ? url : defaultUrlTransform(url);
}
const components = {
  table: ({children}) => <div className="tableScroll" tabIndex={0}><table>{children}</table></div>,
  a: ({href, children}) => external(href)
    ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    : <a href="#" className="file-link" data-file={href} data-name={typeof children === 'string' ? children : href}>{children}</a>,
};
export function render(source) {
  return renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm,remarkPunctuationStrong]} components={components}
    urlTransform={transformUrl}>{source}</ReactMarkdown>);
}
