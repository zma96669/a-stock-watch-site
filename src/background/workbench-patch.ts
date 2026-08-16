export function allowLocalBridge(html: string): string {
  return addDirectiveSource(html, 'connect-src', 'http://127.0.0.1:*');
}

function addDirectiveSource(html: string, directive: string, source: string): string {
  const pattern = new RegExp(`(${directive}\\s+[\\s\\S]*?)(\\s*;)`);
  return html.replace(pattern, (full: string, body: string, ending: string) => {
    if (body.split(/\s+/).includes(source)) return full;
    const indentation = body.match(/\n([ \t]+)[^\n]*$/)?.[1] ?? '\t\t\t\t\t';
    return `${body}\n${indentation}${source}${ending}`;
  });
}
