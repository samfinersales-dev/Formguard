// generate-blog-post.js — lean version, ~$0.15-0.20 per run
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

const API_KEY = process.env.ANTHROPIC_API_KEY;

// ── API CALL ─────────────────────────────────────────────────────────────────
function callClaude(prompt, model, useSearch) {
  return new Promise(function(resolve, reject) {
    var payload = {
      model: model,
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }]
    };
    if (useSearch) payload.tools = [{ type: 'web_search_20250305', name: 'web_search' }];

    var body = JSON.stringify(payload);
    var req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var parsed = JSON.parse(data);
          var text = (parsed.content || [])
            .filter(function(b) { return b.type === 'text'; })
            .map(function(b) { return b.text; })
            .join('\n').trim();
          if (!text) reject(new Error('Empty response: ' + data.slice(0,200)));
          else resolve(text);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── STEP 1: PICK TOPIC (cheap model, no search) ───────────────────────────────
async function pickTopic() {
  console.log('Picking topic...');
  var weekNum = Math.floor(Date.now() / (7*24*60*60*1000));
  var states = ['California','Texas','Florida','New York','Illinois','Pennsylvania',
    'Ohio','Georgia','North Carolina','Michigan','New Jersey','Virginia','Washington',
    'Arizona','Tennessee','Indiana','Missouri','Maryland','Wisconsin','Colorado',
    'Minnesota','South Carolina','Alabama','Louisiana','Kentucky','Oregon','Oklahoma',
    'Connecticut','Iowa','Utah','Nevada','Arkansas','Mississippi','Kansas','New Mexico',
    'Nebraska','West Virginia','Idaho','Hawaii','New Hampshire','Maine','Montana',
    'Rhode Island','Delaware','South Dakota','North Dakota','Alaska','Vermont','Wyoming'];
  var doState = weekNum % 2 === 0;
  var state = states[weekNum % states.length];
  var stateNote = doState ? ('Focus on ' + state + '-specific rules and figures.') : 'Write a general evergreen article.';

  var prompt = 'You are an SEO writer for ' + SITE_CONFIG.siteName + ' (' + SITE_CONFIG.domain + ').\n' +
    'Product: ' + SITE_CONFIG.productDesc + '\n' +
    'Audience: ' + SITE_CONFIG.targetAudience + '\n' +
    'Topic area: ' + SITE_CONFIG.topicArea + '\n' +
    stateNote + '\n\n' +
    'Choose ONE specific blog topic with high search volume and clear how-to intent.\n\n' +
    'YOU MUST RESPOND WITH ONLY THESE LINES AND NOTHING ELSE:\n' +
    'TITLE: [title here]\n' +
    'SLUG: [slug-here]\n' +
    'META: [155 char description]\n' +
    'KEYWORD: [primary keyword]\n' +
    'H2A: [section 1 heading]\n' +
    'H2B: [section 2 heading]\n' +
    'H2C: [section 3 heading]\n' +
    'H2D: [section 4 heading]\n' +
    'H2E: [section 5 heading]\n\n' +
    'No preamble. No explanation. Just those 9 lines.';

  var response = await callClaude(prompt, 'claude-haiku-4-5-20251001', false);
  console.log('Raw topic response:\n' + response.slice(0,200));

  var get = function(key) {
    var m = response.match(new RegExp('^' + key + ':\\s*(.+)$', 'm'));
    return m ? m[1].trim() : '';
  };

  var topic = {
    title:    get('TITLE'),
    slug:     get('SLUG').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g,'-'),
    meta:     get('META'),
    keyword:  get('KEYWORD'),
    sections: [get('H2A'), get('H2B'), get('H2C'), get('H2D'), get('H2E')].filter(Boolean)
  };

  if (!topic.title || topic.sections.length < 3) {
    throw new Error('Could not parse topic. Response was:\n' + response);
  }
  console.log('Topic: ' + topic.title);
  return topic;
}

// ── STEP 2: WRITE ARTICLE (sonnet with search) ────────────────────────────────
async function writeArticle(topic) {
  console.log('Writing article...');
  var today = new Date().toISOString().split('T')[0];

  var sectionBlocks = topic.sections.map(function(h) {
    return 'SECTION\nHEADING: ' + h + '\nWrite 150-200 words of plain text here. Separate paragraphs with blank lines. Start list items with "- ". No HTML.\nENDSECTION';
  }).join('\n\n');

  var prompt = 'Write a blog article for ' + SITE_CONFIG.siteName + '.\n\n' +
    'Title: ' + topic.title + '\n' +
    'Audience: ' + SITE_CONFIG.targetAudience + '\n' +
    'CTA: ' + SITE_CONFIG.ctaText + ' at ' + SITE_CONFIG.ctaUrl + '\n\n' +
    'CRITICAL: Use EXACTLY the format below. Replace placeholder text. No HTML tags. Plain text only.\n\n' +
    'INTRO\n[Write 2-3 sentence intro]\nENDINTRO\n\n' +
    sectionBlocks + '\n\n' +
    'CONCLUSION\n[Write 2 sentence conclusion with CTA]\nENDCONCLUSION\n\n' +
    'FAQ\nQ: [question 1]\nA: [answer 1]\n\nQ: [question 2]\nA: [answer 2]\n\nQ: [question 3]\nA: [answer 3]\nENDFAQ';

  var response = await callClaude(prompt, 'claude-sonnet-4-6', true);

  var article = { title: topic.title, slug: topic.slug, meta: topic.meta, keyword: topic.keyword, date: today };

  var introM = response.match(/INTRO\n([\s\S]*?)\nENDINTRO/);
  article.intro = introM ? introM[1].trim() : '';

  article.sections = [];
  var sReg = /SECTION\nHEADING: ([^\n]+)\n([\s\S]*?)\nENDSECTION/g;
  var m;
  while ((m = sReg.exec(response)) !== null) {
    article.sections.push({ h: m[1].trim(), body: m[2].trim() });
  }

  var concM = response.match(/CONCLUSION\n([\s\S]*?)\nENDCONCLUSION/);
  article.conclusion = concM ? concM[1].trim() : '';

  article.faqs = [];
  var faqM = response.match(/FAQ\n([\s\S]*?)\nENDFAQ/);
  if (faqM) {
    var pairs = faqM[1].split(/\n\n+/);
    pairs.forEach(function(p) {
      var q = p.match(/Q: ([^\n]+)/);
      var a = p.match(/A: ([\s\S]+)/);
      if (q && a) article.faqs.push({ q: q[1].trim(), a: a[1].trim() });
    });
  }

  if (!article.sections.length) {
    throw new Error('No sections parsed. Response:\n' + response.slice(0,400));
  }
  console.log('Written: ' + article.sections.length + ' sections');
  return article;
}

// ── STEP 3: BUILD HTML ────────────────────────────────────────────────────────
function buildHTML(a) {
  var c = SITE_CONFIG.primaryColor;
  var siteUrl = 'https://' + SITE_CONFIG.domain;
  var pageUrl = siteUrl + '/blog/' + a.slug;
  var pubDate = new Date(a.date).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});

  var sectionsHTML = a.sections.map(function(s) {
    var paras = s.body.split(/\n\n+/).map(function(para) {
      para = para.trim();
      if (!para) return '';
      var lines = para.split('\n');
      if (lines.some(function(l){return l.trim().startsWith('-');})) {
        return '<ul>' + lines.filter(Boolean).map(function(l){
          return '<li>' + l.replace(/^-\s*/,'') + '</li>';
        }).join('') + '</ul>';
      }
      return '<p>' + para + '</p>';
    }).filter(Boolean).join('\n');
    return '<section class="s"><h2>' + s.h + '</h2>' + paras + '</section>';
  }).join('\n');

  var faqHTML = a.faqs.length ? '<section class="faqs"><h2>Frequently asked questions</h2>' +
    a.faqs.map(function(f){
      return '<div class="fi"><h3>' + f.q + '</h3><p>' + f.a + '</p></div>';
    }).join('\n') + '</section>' : '';

  var articleSchema = JSON.stringify({
    "@context":"https://schema.org","@type":"Article",
    "headline":a.title,"description":a.meta,"datePublished":a.date,
    "author":{"@type":"Organization","name":SITE_CONFIG.siteName},
    "publisher":{"@type":"Organization","name":SITE_CONFIG.siteName,"url":siteUrl},
    "mainEntityOfPage":pageUrl
  });

  var bcSchema = JSON.stringify({
    "@context":"https://schema.org","@type":"BreadcrumbList",
    "itemListElement":[
      {"@type":"ListItem","position":1,"name":"Home","item":siteUrl+"/"},
      {"@type":"ListItem","position":2,"name":"Blog","item":siteUrl+"/blog/"},
      {"@type":"ListItem","position":3,"name":a.title,"item":pageUrl}
    ]
  });

  var faqSchema = a.faqs.length ? '<script type="application/ld+json">' + JSON.stringify({
    "@context":"https://schema.org","@type":"FAQPage",
    "mainEntity":a.faqs.map(function(f){
      return {"@type":"Question","name":f.q,"acceptedAnswer":{"@type":"Answer","text":f.a}};
    })
  }) + '</script>' : '';

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + a.title + ' | ' + SITE_CONFIG.siteName + '</title>' +
    '<meta name="description" content="' + a.meta + '">' +
    '<link rel="canonical" href="' + pageUrl + '">' +
    '<meta property="og:title" content="' + a.title + '">' +
    '<meta property="og:description" content="' + a.meta + '">' +
    '<meta property="og:url" content="' + pageUrl + '">' +
    '<meta property="og:type" content="article">' +
    '<meta name="robots" content="index,follow">' +
    '<script type="application/ld+json">' + articleSchema + '</script>' +
    '<script type="application/ld+json">' + bcSchema + '</script>' +
    faqSchema +
    '<style>*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:Georgia,serif;color:#1a1a2e;background:#f7f5f0;line-height:1.7}' +
    '.hdr{background:' + c + ';padding:16px 24px;display:flex;align-items:center;justify-content:space-between}' +
    '.hdr a{color:#fff;text-decoration:none}.hdr .logo{font-size:1.1rem;font-weight:600}' +
    '.hdr nav a{font-size:.9rem;opacity:.8;margin-left:20px}' +
    '.hero{background:' + c + ';color:#fff;padding:56px 24px 44px;text-align:center}' +
    '.hero h1{font-size:clamp(1.5rem,4vw,2.3rem);font-weight:400;max-width:740px;margin:0 auto 14px;line-height:1.3}' +
    '.meta{font-size:.85rem;opacity:.7}' +
    '.body{max-width:740px;margin:0 auto;padding:44px 24px}' +
    '.intro{font-size:1.05rem;line-height:1.8;color:#2a2a3e;margin-bottom:32px;padding-bottom:24px;border-bottom:1px solid #e0ddd8}' +
    '.s{margin-bottom:36px}.s h2{font-size:1.4rem;font-weight:400;color:' + c + ';margin-bottom:14px}' +
    '.s p{margin-bottom:12px;font-size:1rem;color:#333}' +
    '.s ul{padding-left:22px;margin-bottom:12px}.s li{margin-bottom:7px;color:#333}' +
    '.concl{background:#fff;border-left:4px solid ' + c + ';border-radius:4px;padding:22px 26px;margin:32px 0}' +
    '.cta{background:' + c + ';color:#fff;border-radius:8px;padding:28px;text-align:center;margin:36px 0}' +
    '.cta h3{font-size:1.3rem;font-weight:400;margin-bottom:10px}' +
    '.cta a{display:inline-block;background:#fff;color:' + c + ';font-weight:700;padding:12px 26px;border-radius:4px;text-decoration:none;font-size:.95rem;margin-top:12px}' +
    '.faqs{margin:44px 0}.faqs h2{font-size:1.4rem;font-weight:400;color:' + c + ';margin-bottom:20px}' +
    '.fi{border-bottom:1px solid #e0ddd8;padding:18px 0}.fi h3{font-size:1rem;font-weight:600;margin-bottom:8px}' +
    '.fi p{font-size:.95rem;color:#444;line-height:1.7}' +
    '.ftr{background:#1a1a2e;color:rgba(255,255,255,.5);padding:28px 24px;text-align:center;font-size:.85rem}' +
    '.ftr a{color:rgba(255,255,255,.4);text-decoration:none}' +
    '@media(max-width:600px){.hero{padding:36px 18px 28px}.body{padding:28px 18px}}</style>' +
    '</head><body>' +
    '<header class="hdr"><a href="' + siteUrl + '" class="logo">' + SITE_CONFIG.siteName + '</a>' +
    '<nav><a href="' + siteUrl + '/blog/">Blog</a><a href="' + siteUrl + '">Get started</a></nav></header>' +
    '<div class="hero"><h1>' + a.title + '</h1><div class="meta">Published ' + pubDate + ' &middot; ' + SITE_CONFIG.siteName + '</div></div>' +
    '<main class="body">' +
    '<p class="intro">' + a.intro + '</p>' +
    sectionsHTML +
    '<div class="concl">' + a.conclusion + '</div>' +
    '<div class="cta"><h3>' + SITE_CONFIG.ctaText + '</h3>' +
    '<p style="opacity:.75;margin-bottom:4px">Used by ' + SITE_CONFIG.targetAudience + '.</p>' +
    '<a href="' + SITE_CONFIG.ctaUrl + '">Get started &rarr;</a></div>' +
    faqHTML +
    '</main>' +
    '<footer class="ftr"><p>&copy; ' + new Date().getFullYear() + ' ' + SITE_CONFIG.siteName +
    ' &middot; <a href="' + siteUrl + '">Home</a> &middot; <a href="' + siteUrl + '/blog/">Blog</a>' +
    ' &middot; Not legal advice.</p></footer>' +
    '</body></html>';
}

// ── STEP 4: SAVE & COMMIT ────────────────────────────────────────────────────
function saveAndCommit(article, html) {
  var blogDir = SITE_CONFIG.blogPath;
  fs.mkdirSync(blogDir, { recursive: true });

  // Save article
  var filePath = path.join(blogDir, article.slug + '.html');
  fs.writeFileSync(filePath, html);
  console.log('Saved: ' + filePath);

  // Update blog index
  var indexPath = path.join(blogDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    var index = fs.readFileSync(indexPath, 'utf8');
    var card = '\n    <a href="/blog/' + article.slug + '" class="post-card">' +
      '<div class="post-card-body"><h3>' + article.title + '</h3>' +
      '<p>' + article.meta + '</p>' +
      '<div class="post-card-footer"><span>' + new Date(article.date).toLocaleDateString('en-US',{month:'long',year:'numeric'}) + '</span>' +
      '<span class="post-card-read">Read &rarr;</span></div></div></a>';
    if (index.includes('class="post-grid"')) {
      index = index.replace('class="post-grid">', 'class="post-grid">' + card);
      fs.writeFileSync(indexPath, index);
      console.log('Blog index updated');
    }
  }

  // Update sitemap
  if (fs.existsSync('sitemap.xml')) {
    var sitemap = fs.readFileSync('sitemap.xml', 'utf8');
    var entry = '  <url>\n    <loc>https://' + SITE_CONFIG.domain + '/blog/' + article.slug + '</loc>\n' +
      '    <lastmod>' + article.date + '</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>\n\n';
    sitemap = sitemap.replace('</urlset>', entry + '</urlset>');
    fs.writeFileSync('sitemap.xml', sitemap);
    console.log('Sitemap updated');
  }

  // Git commit and push
  execSync('git config user.name "blog-bot"');
  execSync('git config user.email "blog-bot@users.noreply.github.com"');
  execSync('git add ' + filePath);
  try { execSync('git add ' + indexPath); } catch(e) {}
  try { execSync('git add sitemap.xml'); } catch(e) {}
  execSync('git diff --staged --quiet || git commit -m "blog: ' + article.slug + '"');
  execSync('git push origin main');
  console.log('Pushed to GitHub');

  // Trigger Netlify
  if (SITE_CONFIG.netlifyHook) {
    https.request(new URL(SITE_CONFIG.netlifyHook), { method: 'POST' }, function(){}).end();
    console.log('Netlify deploy triggered');
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Auto Blog — ' + SITE_CONFIG.siteName);
  if (!API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  if (!SITE_CONFIG.domain) throw new Error('SITE_DOMAIN not set');

  var topic = await pickTopic();
  var article = await writeArticle(topic);
  var html = buildHTML(article);
  saveAndCommit(article, html);
  console.log('Done: https://' + SITE_CONFIG.domain + '/blog/' + article.slug);
}

main().catch(function(e) {
  console.error('Fatal error:', e.message || e);
  process.exit(1);
});
