// generate-blog-post.js
// Generates SEO blog posts using Claude with web search
// Uses delimiter-based parsing to avoid JSON escaping issues

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SITE_CONFIG = {
  domain:         process.env.SITE_DOMAIN,
  siteName:       process.env.SITE_NAME,
  blogPath:       process.env.BLOG_PATH || 'blog',
  topicArea:      process.env.TOPIC_AREA,
  targetAudience: process.env.TARGET_AUDIENCE,
  productDesc:    process.env.PRODUCT_DESC,
  ctaText:        process.env.CTA_TEXT,
  ctaUrl:         process.env.CTA_URL || ('https://' + process.env.SITE_DOMAIN),
  primaryColor:   process.env.PRIMARY_COLOR || '#1a3a5c',
  netlifyHook:    process.env.NETLIFY_HOOK,
};

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ── STEP 1: RESEARCH TOPIC ───────────────────────────────────────────────────
async function researchTopics() {
  console.log('Researching current topics...');

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const thisMonth = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const isStateSpecific = SITE_CONFIG.topicArea.toLowerCase().includes('alternate');
  const weekNum = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const doStateSpecific = isStateSpecific && (weekNum % 2 === 0);
  const US_STATES = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado',
    'Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana',
    'Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan',
    'Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire',
    'New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio',
    'Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota',
    'Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia',
    'Wisconsin','Wyoming'];
  const targetState = US_STATES[weekNum % US_STATES.length];
  const stateDirective = doStateSpecific
    ? 'THIS WEEK: Write a state-specific guide for ' + targetState + '. Verify all ' + targetState + '-specific rules and figures from official government sources.'
    : 'THIS WEEK: Write a general evergreen how-to article.';

  const prompt = 'Today is ' + today + '. You are an SEO strategist for ' + SITE_CONFIG.siteName + ' (' + SITE_CONFIG.domain + '), a ' + SITE_CONFIG.productDesc + ' for ' + SITE_CONFIG.targetAudience + '.\n\n' + stateDirective + '\n\nSearch for current high-traffic topic opportunities in: ' + SITE_CONFIG.topicArea + '\n\nChoose ONE specific topic that has clear search intent, can be answered accurately, and ties naturally to ' + SITE_CONFIG.productDesc + '.\n\nRespond using EXACTLY this format:\n\nTITLE: [exact SEO-optimised title]\nSLUG: [url-slug-with-hyphens]\nMETA: [155 char meta description]\nKEYWORD: [primary keyword phrase]\nWHY_NOW: [one sentence why this is relevant now]\nSOURCES: [source1] | [source2]\nOUTLINE: [H2 one] | [H2 two] | [H2 three] | [H2 four] | [H2 five]';

  const response = await callClaude(prompt, true);

  const get = (key) => {
    const match = response.match(new RegExp(key + ': ([^\n]+)'));
    return match ? match[1].trim() : '';
  };

  const topic = {
    title:    get('TITLE'),
    slug:     get('SLUG'),
    metaDescription: get('META'),
    targetKeyword:   get('KEYWORD'),
    whyNow:   get('WHY_NOW'),
    sources:  get('SOURCES').split('|').map(s => s.trim()),
    outline:  get('OUTLINE').split('|').map(s => s.trim()),
  };

  if (!topic.title || !topic.slug) {
    console.error('Research response:', response.slice(0, 300));
    throw new Error('Could not parse topic from response');
  }

  console.log('Topic: ' + topic.title);
  return topic;
}

// ── STEP 2: WRITE ARTICLE ────────────────────────────────────────────────────
async function generateArticle(topic) {
  console.log('Writing article...');

  const today = new Date().toISOString().split('T')[0];

  const sectionsTemplate = topic.outline.map(function(heading) {
    return 'SECTION_START\nheading: ' + heading + '\nWrite 200-300 words of plain prose here. No HTML tags. Separate paragraphs with a blank line. Start list items with a hyphen on its own line.\nSECTION_END';
  }).join('\n\n');

  const prompt = 'You are a content writer for ' + SITE_CONFIG.siteName + '. Write a complete blog article.\n\nTITLE: ' + topic.title + '\nKEYWORD: ' + topic.targetKeyword + '\nAUDIENCE: ' + SITE_CONFIG.targetAudience + '\nSECTIONS: ' + topic.outline.join(' | ') + '\nSOURCES TO REFERENCE: ' + topic.sources.join(', ') + '\nCTA: ' + SITE_CONFIG.ctaText + ' at ' + SITE_CONFIG.ctaUrl + '\n\nRULES:\n1. Only include verifiable facts — cite sources inline\n2. Plain English, practical and actionable\n3. 1200-1800 words total\n4. Plain text only — absolutely no HTML tags anywhere\n\nWrite the article using EXACTLY this format:\n\nMETA_TITLE: ' + topic.title + '\nMETA_SLUG: ' + topic.slug + '\nMETA_DESC: ' + topic.metaDescription + '\nMETA_KEYWORD: ' + topic.targetKeyword + '\nMETA_DATE: ' + today + '\n\nINTRO_START\nWrite 2-3 sentence intro here.\nINTRO_END\n\n' + sectionsTemplate + '\n\nCONCLUSION_START\nWrite concluding paragraph with natural CTA here.\nCONCLUSION_END\n\nFAQ_START\nQ: First question from article?\nA: Full answer here.\n\nQ: Second question?\nA: Full answer here.\n\nQ: Third question?\nA: Full answer here.\nFAQ_END';

  const response = await callClaude(prompt, true);

  const article = {};

  // Parse metadata
  ['META_TITLE','META_SLUG','META_DESC','META_KEYWORD','META_DATE'].forEach(function(key) {
    var match = response.match(new RegExp(key + ': ([^\n]+)'));
    var field = key.replace('META_', '').toLowerCase();
    if (field === 'title') article.title = match ? match[1].trim() : topic.title;
    else if (field === 'slug') article.slug = match ? match[1].trim() : topic.slug;
    else if (field === 'desc') article.metaDescription = match ? match[1].trim() : topic.metaDescription;
    else if (field === 'keyword') article.targetKeyword = match ? match[1].trim() : topic.targetKeyword;
    else if (field === 'date') article.datePublished = match ? match[1].trim() : today;
  });

  // Fallbacks
  if (!article.title) article.title = topic.title;
  if (!article.slug) article.slug = topic.slug;
  if (!article.metaDescription) article.metaDescription = topic.metaDescription;
  if (!article.targetKeyword) article.targetKeyword = topic.targetKeyword;
  if (!article.datePublished) article.datePublished = today;

  // Parse intro
  var introMatch = response.match(/INTRO_START\n([\s\S]*?)\nINTRO_END/);
  article.intro = introMatch ? introMatch[1].trim() : '';

  // Parse sections
  article.sections = [];
  var sectionRegex = /SECTION_START\nheading: ([^\n]+)\n([\s\S]*?)\nSECTION_END/g;
  var sectionMatch;
  while ((sectionMatch = sectionRegex.exec(response)) !== null) {
    article.sections.push({ heading: sectionMatch[1].trim(), body: sectionMatch[2].trim() });
  }

  // Parse conclusion
  var conclusionMatch = response.match(/CONCLUSION_START\n([\s\S]*?)\nCONCLUSION_END/);
  article.conclusion = conclusionMatch ? conclusionMatch[1].trim() : '';

  // Parse FAQ
  article.faqSchema = [];
  var faqBlock = response.match(/FAQ_START\n([\s\S]*?)\nFAQ_END/);
  if (faqBlock) {
    var pairs = faqBlock[1].split(/\n\n+/);
    pairs.forEach(function(pair) {
      var qMatch = pair.match(/Q: ([^\n]+)/);
      var aMatch = pair.match(/A: ([\s\S]+)/);
      if (qMatch && aMatch) {
        article.faqSchema.push({ question: qMatch[1].trim(), answer: aMatch[1].trim() });
      }
    });
  }

  if (!article.sections.length) {
    console.error('No sections parsed. Response preview:', response.slice(0, 500));
    throw new Error('Could not parse article sections');
  }

  article.wordCount = response.split(' ').length;
  console.log('Article: ' + article.sections.length + ' sections, ~' + article.wordCount + ' words');
  return article;
}

// ── STEP 3: RENDER HTML ──────────────────────────────────────────────────────
function renderHTML(article) {
  var sectionsHTML = article.sections.map(function(s) {
    var body = s.body || '';
    var paragraphs = body.split(/\n\n+/).map(function(para) {
      para = para.trim();
      if (!para) return '';
      var lines = para.split('\n');
      var isList = lines.some(function(l) { return l.trim().startsWith('-'); });
      if (isList) {
        var items = lines.filter(function(l) { return l.trim(); }).map(function(l) {
          return '<li>' + l.replace(/^-\s*/, '') + '</li>';
        }).join('');
        return '<ul>' + items + '</ul>';
      }
      return '<p>' + para + '</p>';
    }).filter(Boolean).join('\n');
    return '<section class="article-section"><h2>' + s.heading + '</h2>' + paragraphs + '</section>';
  }).join('\n');

  var faqItemsHTML = article.faqSchema.map(function(f) {
    return '<div class="faq-item" itemscope itemprop="mainEntity" itemtype="https://schema.org/Question"><h3 class="faq-q" itemprop="name">' + f.question + '</h3><div class="faq-a" itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer"><span itemprop="text">' + f.answer + '</span></div></div>';
  }).join('\n');

  var articleSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": article.title,
    "description": article.metaDescription,
    "datePublished": article.datePublished,
    "dateModified": article.datePublished,
    "author": { "@type": "Organization", "name": SITE_CONFIG.siteName },
    "publisher": { "@type": "Organization", "name": SITE_CONFIG.siteName, "url": "https://" + SITE_CONFIG.domain },
    "mainEntityOfPage": "https://" + SITE_CONFIG.domain + "/blog/" + article.slug
  }, null, 2);

  var breadcrumbSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://" + SITE_CONFIG.domain + "/" },
      { "@type": "ListItem", "position": 2, "name": "Blog", "item": "https://" + SITE_CONFIG.domain + "/blog/" },
      { "@type": "ListItem", "position": 3, "name": article.title, "item": "https://" + SITE_CONFIG.domain + "/blog/" + article.slug }
    ]
  }, null, 2);

  var faqSchema = article.faqSchema.length ? JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": article.faqSchema.map(function(f) {
      return { "@type": "Question", "name": f.question, "acceptedAnswer": { "@type": "Answer", "text": f.answer } };
    })
  }, null, 2) : null;

  var pubDate = new Date(article.datePublished).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<title>' + article.title + ' | ' + SITE_CONFIG.siteName + '</title>\n' +
    '<meta name="description" content="' + article.metaDescription + '">\n' +
    '<link rel="canonical" href="https://' + SITE_CONFIG.domain + '/blog/' + article.slug + '">\n' +
    '<meta property="og:title" content="' + article.title + '">\n' +
    '<meta property="og:description" content="' + article.metaDescription + '">\n' +
    '<meta property="og:url" content="https://' + SITE_CONFIG.domain + '/blog/' + article.slug + '">\n' +
    '<meta property="og:type" content="article">\n' +
    '<meta name="robots" content="index, follow">\n' +
    '<script type="application/ld+json">' + articleSchema + '</script>\n' +
    '<script type="application/ld+json">' + breadcrumbSchema + '</script>\n' +
    (faqSchema ? '<script type="application/ld+json">' + faqSchema + '</script>\n' : '') +
    '<style>\n' +
    '*{box-sizing:border-box;margin:0;padding:0}\n' +
    'body{font-family:Georgia,serif;color:#1a1a2e;background:#f7f5f0;line-height:1.7}\n' +
    '.site-header{background:' + SITE_CONFIG.primaryColor + ';padding:16px 24px;display:flex;align-items:center;justify-content:space-between}\n' +
    '.site-header a{color:#fff;text-decoration:none}\n' +
    '.site-header .logo{font-size:1.1rem;font-weight:600}\n' +
    '.site-header nav a{font-size:.9rem;opacity:.8;margin-left:20px}\n' +
    '.article-hero{background:' + SITE_CONFIG.primaryColor + ';color:#fff;padding:60px 24px 48px;text-align:center}\n' +
    '.article-hero h1{font-size:clamp(1.6rem,4vw,2.4rem);font-weight:400;max-width:760px;margin:0 auto 16px;line-height:1.3}\n' +
    '.article-meta{font-size:.85rem;opacity:.7}\n' +
    '.article-body{max-width:760px;margin:0 auto;padding:48px 24px}\n' +
    '.article-intro{font-size:1.1rem;line-height:1.8;color:#2a2a3e;margin-bottom:36px;padding-bottom:28px;border-bottom:1px solid #e0ddd8}\n' +
    '.article-section{margin-bottom:40px}\n' +
    '.article-section h2{font-size:1.5rem;font-weight:400;color:' + SITE_CONFIG.primaryColor + ';margin-bottom:16px}\n' +
    '.article-section p{margin-bottom:14px;font-size:1rem;color:#333}\n' +
    '.article-section ul{padding-left:24px;margin-bottom:14px}\n' +
    '.article-section li{margin-bottom:8px;font-size:1rem;color:#333}\n' +
    '.article-conclusion{background:#fff;border:1px solid #e0ddd8;border-left:4px solid ' + SITE_CONFIG.primaryColor + ';border-radius:4px;padding:24px 28px;margin:36px 0}\n' +
    '.cta-block{background:' + SITE_CONFIG.primaryColor + ';color:#fff;border-radius:8px;padding:32px;text-align:center;margin:40px 0}\n' +
    '.cta-block h3{font-size:1.4rem;font-weight:400;margin-bottom:12px}\n' +
    '.cta-btn{display:inline-block;background:#fff;color:' + SITE_CONFIG.primaryColor + ';font-weight:700;padding:14px 28px;border-radius:4px;text-decoration:none;font-size:.95rem}\n' +
    '.faq-section{margin:48px 0}\n' +
    '.faq-section h2{font-size:1.5rem;font-weight:400;color:' + SITE_CONFIG.primaryColor + ';margin-bottom:24px}\n' +
    '.faq-item{border-bottom:1px solid #e0ddd8;padding:20px 0}\n' +
    '.faq-q{font-size:1rem;font-weight:600;color:#1a1a2e;margin-bottom:10px}\n' +
    '.faq-a{font-size:.95rem;color:#444;line-height:1.7}\n' +
    '.article-footer{background:#1a1a2e;color:rgba(255,255,255,.6);padding:32px 24px;text-align:center;font-size:.85rem}\n' +
    '.article-footer a{color:rgba(255,255,255,.5);text-decoration:none}\n' +
    '@media(max-width:600px){.article-hero{padding:40px 20px 32px}.article-body{padding:32px 20px}}\n' +
    '</style>\n</head>\n<body>\n' +
    '<header class="site-header"><a href="https://' + SITE_CONFIG.domain + '" class="logo">' + SITE_CONFIG.siteName + '</a><nav><a href="https://' + SITE_CONFIG.domain + '/blog/">Blog</a><a href="https://' + SITE_CONFIG.domain + '">Get started</a></nav></header>\n' +
    '<div class="article-hero"><h1>' + article.title + '</h1><div class="article-meta">Published ' + pubDate + ' &middot; ' + SITE_CONFIG.siteName + '</div></div>\n' +
    '<main class="article-body">\n' +
    '<p class="article-intro">' + article.intro + '</p>\n' +
    sectionsHTML + '\n' +
    '<div class="article-conclusion">' + article.conclusion + '</div>\n' +
    '<div class="cta-block"><h3>' + SITE_CONFIG.ctaText + '</h3><p style="opacity:.8;margin-bottom:20px">Join thousands of ' + SITE_CONFIG.targetAudience + ' who use ' + SITE_CONFIG.siteName + '.</p><a href="' + SITE_CONFIG.ctaUrl + '" class="cta-btn">Get started &rarr;</a></div>\n' +
    (article.faqSchema.length ? '<section class="faq-section" itemscope itemtype="https://schema.org/FAQPage"><h2>Frequently asked questions</h2>' + faqItemsHTML + '</section>\n' : '') +
    '</main>\n' +
    '<footer class="article-footer"><p>&copy; ' + new Date().getFullYear() + ' ' + SITE_CONFIG.siteName + ' &middot; <a href="https://' + SITE_CONFIG.domain + '">Home</a> &middot; <a href="https://' + SITE_CONFIG.domain + '/blog/">Blog</a> &middot; Not legal advice.</p></footer>\n' +
    '</body>\n</html>';
}

// ── STEP 4: UPDATE BLOG INDEX ─────────────────────────────────────────────────
function updateBlogIndex(article) {
  var indexPath = path.join(SITE_CONFIG.blogPath, 'index.html');
  if (!fs.existsSync(indexPath)) { console.log('No blog/index.html — skipping'); return; }
  var index = fs.readFileSync(indexPath, 'utf8');
  var newCard = '\n    <a href="https://' + SITE_CONFIG.domain + '/blog/' + article.slug + '" class="post-card">' +
    '<div class="post-card-body"><h3>' + article.title + '</h3><p>' + article.metaDescription + '</p>' +
    '<div class="post-card-footer"><span>' + new Date(article.datePublished).toLocaleDateString('en-US',{month:'long',year:'numeric'}) + '</span><span class="post-card-read">Read &rarr;</span></div></div></a>';
  if (index.includes('class="post-grid"')) {
    index = index.replace(/(<\/a>\s*\n\s*<\/div>\s*\n\s*<(?:div|section)[^>]*(?:cta|footer))/, newCard + '\n  $1');
    fs.writeFileSync(indexPath, index);
    console.log('Blog index updated');
  }
}

// ── STEP 5: UPDATE SITEMAP ────────────────────────────────────────────────────
function updateSitemap(article) {
  var sitemapPath = 'sitemap.xml';
  if (!fs.existsSync(sitemapPath)) { console.log('No sitemap.xml — skipping'); return; }
  var sitemap = fs.readFileSync(sitemapPath, 'utf8');
  var entry = '  <url>\n    <loc>https://' + SITE_CONFIG.domain + '/blog/' + article.slug + '</loc>\n    <lastmod>' + article.datePublished + '</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>\n\n';
  sitemap = sitemap.replace('</urlset>', entry + '</urlset>');
  fs.writeFileSync(sitemapPath, sitemap);
  console.log('Sitemap updated');
}

// ── CLAUDE API ────────────────────────────────────────────────────────────────
function callClaude(prompt, useWebSearch) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: 'You are a helpful assistant. Follow the exact output format specified in each request.',
      tools: useWebSearch ? [{ type: 'web_search_20250305', name: 'web_search' }] : undefined,
      messages: [{ role: 'user', content: prompt }]
    });
    var req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }
    }, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var parsed = JSON.parse(data);
          var text = (parsed.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('\n').trim();
          if (!text) { reject(new Error('Empty response from Claude: ' + JSON.stringify(parsed).slice(0,200))); return; }
          resolve(text);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Auto Blog Generator — ' + SITE_CONFIG.siteName);
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  if (!SITE_CONFIG.domain) throw new Error('SITE_DOMAIN not set');

  var topic = await researchTopics();
  var article = await generateArticle(topic);
  var html = renderHTML(article);

  var filePath = path.join(SITE_CONFIG.blogPath, article.slug + '.html');
  fs.mkdirSync(SITE_CONFIG.blogPath, { recursive: true });
  fs.writeFileSync(filePath, html);
  console.log('Saved: ' + filePath);

  updateBlogIndex(article);
  updateSitemap(article);

  execSync('git config user.name "blog-bot[bot]"');
  execSync('git config user.email "blog-bot[bot]@users.noreply.github.com"');
  execSync('git add ' + filePath + ' ' + SITE_CONFIG.blogPath + '/index.html sitemap.xml 2>/dev/null || true');
  execSync('git diff --staged --quiet || git commit -m "feat: auto-publish ' + article.slug + ' [blog-bot]"');
  execSync('git push origin main');
  console.log('Committed and pushed');

  if (SITE_CONFIG.netlifyHook) {
    https.request(new URL(SITE_CONFIG.netlifyHook), { method: 'POST' }, function() {}).end();
    console.log('Netlify deploy triggered');
  }

  console.log('Done! https://' + SITE_CONFIG.domain + '/blog/' + article.slug);
}

main().catch(function(err) {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
