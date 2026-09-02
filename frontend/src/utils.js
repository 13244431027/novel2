export function stripHtml(html = '') {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}

export function fmtWord(words) {
  const n = Number(words);
  if (!n) return '';
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万字`;
  return `${n}字`;
}

export function fmtScore(score) {
  if (!score) return '';
  return `${score}分`;
}
