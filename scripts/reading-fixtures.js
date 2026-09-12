// Synthetic text using the source site's HTML structure, without copying its articles.
export const articleHtml = `<article lang="ja">
<h3><ruby>図書館<rt>としょかん</rt></ruby>のニュース</h3>
<h4><a href="/story/123/"><time datetime="2026-09-10T08:00:00Z">Date</time></a></h4>
<p><ruby>図書館<rp>(</rp><rt>としょかん</rt><rp>)</rp></ruby>に<ruby>本<rt>ほん</rt></ruby>が三冊あります。今日は休みではありません。</p>
<p>先生は「明日は休みですか？　いいえ。」と話しました。<script>bad()</script>子どもも来ました。</p>
<table class="links"><tr><td><a href="https://www3.nhk.or.jp/news/easy/test/test.html">Original</a></td><td><a href="/story/123/" class="permalink">Permalink</a></td></tr></table>
</article>`;

export function englishFor(article) {
  const lines = ['There are three books in the library.', 'It is not closed today.', 'The teacher said, “Is it closed tomorrow? No.”', 'Children also came.'];
  return { title: 'Library news', sentences: article.sentences.map(({ id }, index) => ({ id, text: lines[index] || `Sentence ${index + 1}` })) };
}
