// generate-blog-post.js
// Node.js script run inside GitHub Actions
// Calls Claude API with web search to generate a truthful, SEO-optimised blog post
// Commits the article + updates blog index + sitemap automatically

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── CONFIG (injected via environment variables from GitHub Actions) ──────────
const SITE_CONFIG = {
  domain:      process.env.SITE_DOMAIN,       // e.g. shadowaipolicy.com
  siteName:    process.env.SITE_NAME,         // e.g. Shadow AI Policy
  blogPath:    process.env.BLOG_PATH || 'blog',
  topicArea:   process.env.TOPIC_AREA,        // e.g. "AI governance and workplace AI policy"
  targetAudience: process.env.TARGET_AUDIENCE, // e.g. "HR managers and compliance teams"
  productDesc: process.env.PRODUCT_DESC,      // e.g. "AI acceptable use policy generator"
  ctaText:     process.env.CTA_TEXT,          // e.g. "Generate your AI policy in 10 minutes"
  ctaUrl:      process.env.CTA_URL || `https://${process.env.SITE_DOMAIN}`,
  primaryColor: process.env.PRIMARY_COLOR || '#1a3a5c',
  netlifyHook: process.env.NETLIFY_HOOK,
};

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ── STEP 1: RESEARCH CURRENT TOPICS ─────────────────────────────────────────
async function researchTopics() {
  console.log('🔍 Researching current topics with web search...');
  
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const thisMonth = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  
  // State-specific alternation for LeaseHelper and SmallClaims
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
    ? `THIS WEEK: Write a state-specific guide for ${targetState}. Title should follow the pattern "[Topic] in ${targetState}: [Key Info]". Verify all ${targetState}-specific rules, limits, fees, and forms from the official state government or court website — these vary significantly and accuracy is critical. If you cannot find a specific verified figure, say so rather than guessing.`
    : `THIS WEEK: Write a general evergreen how-to article (not state-specific).`;
  
  const researchPrompt = `Today is ${today}. You are an SEO content strategist for ${SITE_CONFIG.siteName} (${SITE_CONFIG.domain}), a ${SITE_CONFIG.productDesc} for ${SITE_CONFIG.targetAudience}.

${stateDirective}

  Search the web for accurate, current information in "${SITE_CONFIG.topicArea}" for ${thisMonth}.

Look for:
1. Recent news, law changes, or regulatory updates relevant to ${SITE_CONFIG.topicArea}
2. High-volume search queries people are asking right now about ${SITE_CONFIG.topicArea}
3. Common problems or questions from ${SITE_CONFIG.targetAudience} that haven't been well answered yet

Then choose ONE specific topic that:
- Has clear search intent (people are actively searching for this)
- Can be answered factually and accurately
- Is relevant to ${SITE_CONFIG.targetAudience}
- Hasn't been written about yet on ${SITE_CONFIG.domain}
- Can be tied naturally to ${SITE_CONFIG.productDesc}

Output ONLY a JSON object with these exact fields:
{
  "title": "exact article title optimised for SEO",
  "slug": "url-slug-with-hyphens",
  "metaDescription": "155 char meta description",
  "targetKeyword": "primary keyword phrase",
  "secondaryKeywords": ["kw1", "kw2", "kw3"],
  "searchIntent": "informational|transactional|navigational",
  "whyNow": "why this topic is relevant right now in one sentence",
  "sources": ["source1 found in search", "source2"],
  "outline": ["H2 section 1", "H2 section 2", "H2 section 3", "H2 section 4", "H2 section 5"]
}`;

  const response = await callClaude(researchPrompt, true); // true = use web search
  
  try {
    const jsonStart = response.indexOf('{');
    const jsonEnd = response.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON in response: ' + response.slice(0,100));
    let clean = response.slice(jsonStart, jsonEnd + 1);
    const data = JSON.parse(clean);
    console.log(`✅ Topic selected: "${data.title}"`);
    console.log(`   Slug: ${data.slug}`);
    console.log(`   Keyword: ${data.targetKeyword}`);
    return data;
  } catch(e) {
    console.error('Failed to parse topic JSON:', response.slice(0, 200));
    throw e;
  }
}

// ── STEP 2: GENERATE FULL ARTICLE ────────────────────────────────────────────
async function generateArticle(topic) {
  console.log(`\n✍️  Writing article: "${topic.title}"...`);
  
  const today = new Date().toISOString().split('T')[0];
  
  const writePrompt = `You are a specialist content writer for ${SITE_CONFIG.siteName}. Write a complete, accurate, SEO-optimised blog article.

TOPIC BRIEF:
Title: ${topic.title}
Target keyword: ${topic.targetKeyword}
Secondary keywords: ${topic.secondaryKeywords.join(', ')}
Target audience: ${SITE_CONFIG.targetAudience}
Why timely: ${topic.whyNow}
Sources found: ${topic.sources.join(', ')}
Outline: ${topic.outline.join(' | ')}

CRITICAL ACCURACY RULES:
1. ONLY include facts verified from web search or authoritative sources — no invented statistics
2. For state-specific content: verify filing fees, dollar limits, form names against the official state court or government website. If you cannot verify a specific figure, write 'check your state court website for current fees' rather than guessing
3. Cite sources inline naturally (e.g. 'According to the Texas Courts website...' or 'Per USCIS...')
4. Do not invent case studies, quotes, or numbers not found in research
5. Write for ${SITE_CONFIG.targetAudience} — practical, specific, actionable
6. 1,200–1,800 words total
7. Natural CTA near the end linking to ${SITE_CONFIG.ctaUrl}: "${SITE_CONFIG.ctaText}"
8. CRITICAL: In your JSON response, escape all apostrophes as \' and all double quotes inside string values as \". Never include raw newlines inside JSON string values — use \n instead. Keep section content as a single string with \n for line breaks.
8. Plain English. No jargon without explanation.

You MUST respond with ONLY a raw JSON object. No preamble, no explanation, no markdown, no code fences. Start your response with { and end with }.

{
  "title": "${topic.title}",
  "slug": "${topic.slug}",
  "metaDescription": "${topic.metaDescription}",
  "datePublished": "${today}",
  "targetKeyword": "${topic.targetKeyword}",
  "wordCount": approximate_word_count_as_number,
  "intro": "2-3 sentence intro as plain text, no HTML",
  "sections": [
    {
      "heading": "H2 heading text",
      "body": "Full section as plain text. Double newline between paragraphs. Start list items with a hyphen. No HTML tags whatsoever."
    }
  ],
  "conclusion": "Concluding paragraph as plain text, no HTML",
  "faqSchema": [
    {"question": "Q from article", "answer": "Full answer matching article content"},
    {"question": "Q from article", "answer": "Full answer"},
    {"question": "Q from article", "answer": "Full answer"}
  ]
}`;

  const response = await callClaude(writePrompt, true); // web search for accuracy
  
  try {
    const jsonStart = response.indexOf('{');
    const jsonEnd = response.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON in response: ' + response.slice(0,100));
    let clean = response.slice(jsonStart, jsonEnd + 1);
    
    // Robust JSON repair: fix common Claude JSON issues
    
    let article;
    try {
      article = JSON.parse(clean);
    } catch(e) {
      // Last resort: ask Claude to fix its own JSON
      console.error('JSON parse failed, attempting recovery...');
      console.error('Error at:', e.message);
      console.error('Context around position:', clean.slice(Math.max(0, parseInt(e.message.match(/position (\d+)/)?.[1] || 0) - 50), parseInt(e.message.match(/position (\d+)/)?.[1] || 0) + 50));
      throw new Error('Article JSON parse failed: ' + e.message);
    }
    console.log(`✅ Article written: ~${article.wordCount} words`);
    return article;
  } catch(e) {
    console.error('Failed to parse article JSON:', response.slice(0, 300));
    throw e;
  }
}

// ── STEP 3: RENDER ARTICLE TO HTML ───────────────────────────────────────────
function renderHTML(article) {
  const sectionsHTML = article.sections.map(s => {
    // Convert plain text to HTML paragraphs
    const body = s.body || s.content || '';
    const paragraphs = body.split(/\n\n+/).map(para => {
      para = para.trim();
      if (!para) return '';
      // Check if it's a list (lines starting with -)
      if (para.includes('\n-') || para.startsWith('-')) {
        const items = para.split('\n').filter(l => l.trim()).map(l => `<li>${l.replace(/^-\s*/, '')}</li>`).join('');
        return `<ul>${items}</ul>`;
      }
      return `<p>${para}</p>`;
    }).filter(Boolean).join('\n');
    return `
    <section class="article-section">
      <h2>${s.heading}</h2>
      ${paragraphs}
    </section>`;
  }).join('\n');

  const faqItemsHTML = article.faqSchema.map(f => `
      <div class="faq-item" itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">
        <h3 class="faq-q" itemprop="name">${f.question}</h3>
        <div class="faq-a" itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">
          <span itemprop="text">${f.answer}</span>
        </div>
      </div>`).join('\n');

  const faqSchemaData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": article.faqSchema.map(f => ({
      "@type": "Question",
      "name": f.question,
      "acceptedAnswer": { "@type": "Answer", "text": f.answer }
    }))
  };

  const articleSchemaData = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": article.title,
    "description": article.metaDescription,
    "datePublished": article.datePublished,
    "dateModified": article.datePublished,
    "keywords": [article.targetKeyword],
    "author": { "@type": "Organization", "name": SITE_CONFIG.siteName, "url": `https://${SITE_CONFIG.domain}` },
    "publisher": { "@type": "Organization", "name": SITE_CONFIG.siteName, "url": `https://${SITE_CONFIG.domain}` },
    "mainEntityOfPage": `https://${SITE_CONFIG.domain}/blog/${article.slug}`
  };

  const breadcrumbSchemaData = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": `https://${SITE_CONFIG.domain}/` },
      { "@type": "ListItem", "position": 2, "name": "Blog", "item": `https://${SITE_CONFIG.domain}/blog/` },
      { "@type": "ListItem", "position": 3, "name": article.title, "item": `https://${SITE_CONFIG.domain}/blog/${article.slug}` }
    ]
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${article.title} | ${SITE_CONFIG.siteName}</title>
  <meta name="description" content="${article.metaDescription}">
  <link rel="canonical" href="https://${SITE_CONFIG.domain}/blog/${article.slug}">
  <meta property="og:title" content="${article.title}">
  <meta property="og:description" content="${article.metaDescription}">
  <meta property="og:url" content="https://${SITE_CONFIG.domain}/blog/${article.slug}">
  <meta property="og:type" content="article">
  <meta name="robots" content="index, follow">
  <script type="application/ld+json">${JSON.stringify(articleSchemaData, null, 2)}</script>
  <script type="application/ld+json">${JSON.stringify(breadcrumbSchemaData, null, 2)}</script>
  <script type="application/ld+json">${JSON.stringify(faqSchemaData, null, 2)}</script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Georgia,serif;color:#1a1a2e;background:#f7f5f0;line-height:1.7}
    .site-header{background:${SITE_CONFIG.primaryColor};padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
    .site-header a{color:#fff;text-decoration:none;font-family:'DM Sans',sans-serif}
    .site-header .logo{font-size:1.1rem;font-weight:600}
    .site-header nav a{font-size:.9rem;opacity:.8;margin-left:20px}
    .article-hero{background:${SITE_CONFIG.primaryColor};color:#fff;padding:60px 24px 48px;text-align:center}
    .article-hero h1{font-family:'DM Serif Display',Georgia,serif;font-size:clamp(1.6rem,4vw,2.4rem);font-weight:400;max-width:760px;margin:0 auto 16px;line-height:1.3}
    .article-meta{font-size:.85rem;opacity:.7;font-family:'DM Sans',sans-serif}
    .article-body{max-width:760px;margin:0 auto;padding:48px 24px}
    .article-intro{font-size:1.1rem;line-height:1.8;color:#2a2a3e;margin-bottom:36px;padding-bottom:28px;border-bottom:1px solid #e0ddd8}
    .article-section{margin-bottom:40px}
    .article-section h2{font-family:'DM Serif Display',Georgia,serif;font-size:1.5rem;font-weight:400;color:${SITE_CONFIG.primaryColor};margin-bottom:16px;line-height:1.3}
    .article-section p{margin-bottom:14px;font-size:1rem;color:#333}
    .article-section ul,.article-section ol{padding-left:24px;margin-bottom:14px}
    .article-section li{margin-bottom:8px;font-size:1rem;color:#333}
    .article-section strong{color:#1a1a2e}
    .article-conclusion{background:#fff;border:1px solid #e0ddd8;border-left:4px solid ${SITE_CONFIG.primaryColor};border-radius:4px;padding:24px 28px;margin:36px 0;font-size:1rem;line-height:1.8}
    .cta-block{background:${SITE_CONFIG.primaryColor};color:#fff;border-radius:8px;padding:32px;text-align:center;margin:40px 0}
    .cta-block h3{font-family:'DM Serif Display',Georgia,serif;font-size:1.4rem;font-weight:400;margin-bottom:12px}
    .cta-block p{opacity:.8;font-size:.95rem;margin-bottom:20px}
    .cta-btn{display:inline-block;background:#fff;color:${SITE_CONFIG.primaryColor};font-weight:700;padding:14px 28px;border-radius:4px;text-decoration:none;font-family:'DM Sans',sans-serif;font-size:.95rem}
    .faq-section{margin:48px 0}
    .faq-section h2{font-family:'DM Serif Display',Georgia,serif;font-size:1.5rem;font-weight:400;color:${SITE_CONFIG.primaryColor};margin-bottom:24px}
    .faq-item{border-bottom:1px solid #e0ddd8;padding:20px 0}
    .faq-q{font-family:'DM Sans',sans-serif;font-size:1rem;font-weight:600;color:#1a1a2e;margin-bottom:10px}
    .faq-a{font-size:.95rem;color:#444;line-height:1.7}
    .article-footer{background:#1a1a2e;color:rgba(255,255,255,.6);padding:32px 24px;text-align:center;font-size:.85rem;font-family:'DM Sans',sans-serif}
    .article-footer a{color:rgba(255,255,255,.5);text-decoration:none}
    @media(max-width:600px){.article-hero{padding:40px 20px 32px}.article-body{padding:32px 20px}}
  </style>
</head>
<body>
  <header class="site-header">
    <a href="https://${SITE_CONFIG.domain}" class="logo">${SITE_CONFIG.siteName}</a>
    <nav>
      <a href="https://${SITE_CONFIG.domain}/blog/">Blog</a>
      <a href="https://${SITE_CONFIG.domain}">Get started</a>
    </nav>
  </header>

  <div class="article-hero">
    <h1>${article.title}</h1>
    <div class="article-meta">Published ${new Date(article.datePublished).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})} · ${SITE_CONFIG.siteName}</div>
  </div>

  <main class="article-body">
    <p class="article-intro">${article.intro}</p>

    ${sectionsHTML}

    <div class="article-conclusion">${article.conclusion}</div>

    <div class="cta-block">
      <h3>${SITE_CONFIG.ctaText}</h3>
      <p>Join thousands of ${SITE_CONFIG.targetAudience} who use ${SITE_CONFIG.siteName}.</p>
      <a href="${SITE_CONFIG.ctaUrl}" class="cta-btn">Get started →</a>
    </div>

    <section class="faq-section" itemscope itemtype="https://schema.org/FAQPage">
      <h2>Frequently asked questions</h2>
      ${faqItemsHTML}
    </section>
  </main>

  <footer class="article-footer">
    <p>© ${new Date().getFullYear()} ${SITE_CONFIG.siteName} · <a href="https://${SITE_CONFIG.domain}">Home</a> · <a href="https://${SITE_CONFIG.domain}/blog/">Blog</a> · Not legal advice. Informational content only.</p>
  </footer>
</body>
</html>`;
}

// ── STEP 4: UPDATE BLOG INDEX ─────────────────────────────────────────────────
function updateBlogIndex(article) {
  const indexPath = path.join(SITE_CONFIG.blogPath, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.log('⚠️  No blog/index.html found — skipping blog index update');
    return;
  }

  let index = fs.readFileSync(indexPath, 'utf8');
  
  // Build new card matching the existing card style
  const newCard = `
    <a href="https://${SITE_CONFIG.domain}/blog/${article.slug}" class="post-card">
      <div class="post-card-header"><div class="post-card-icon">📝</div><div class="post-card-tag">${article.targetKeyword.split(' ').slice(0,2).map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ')}</div></div>
      <div class="post-card-body">
        <h3>${article.title}</h3>
        <p>${article.metaDescription}</p>
        <div class="post-card-footer"><span>${new Date(article.datePublished).toLocaleDateString('en-US',{month:'long',year:'numeric'})} · ${Math.ceil(article.wordCount/200)} min read</span><span class="post-card-read">Read →</span></div>
      </div>
    </a>`;

  // Insert before closing post-grid div or cta-strip
  if (index.includes('class="post-grid"')) {
    index = index.replace(
      /(<\/div>\s*\n\s*<div class="cta-strip|cta-block|cta_block)/, 
      `${newCard}\n  $1`
    );
    // Also update featured article if it's the first post
    fs.writeFileSync(indexPath, index);
    console.log(`✅ Blog index updated with new card`);
  } else {
    console.log('⚠️  Could not find post-grid in blog index');
  }
}

// ── STEP 5: UPDATE SITEMAP ────────────────────────────────────────────────────
function updateSitemap(article) {
  const sitemapPath = 'sitemap.xml';
  if (!fs.existsSync(sitemapPath)) {
    console.log('⚠️  No sitemap.xml found');
    return;
  }
  
  let sitemap = fs.readFileSync(sitemapPath, 'utf8');
  const newEntry = `  <url>
    <loc>https://${SITE_CONFIG.domain}/blog/${article.slug}</loc>
    <lastmod>${article.datePublished}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>

`;
  sitemap = sitemap.replace('</urlset>', newEntry + '</urlset>');
  fs.writeFileSync(sitemapPath, sitemap);
  console.log(`✅ Sitemap updated`);
}

// ── CLAUDE API CALL ───────────────────────────────────────────────────────────
function callClaude(prompt, useWebSearch = false) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: 'You are a JSON API. You MUST respond with only valid JSON. Never include explanations, preamble, or markdown. Always start your response with { and end with }.',
      ...(useWebSearch ? { tools: [{ type: 'web_search_20250305', name: 'web_search' }] } : {}),
      messages: [{ role: 'user', content: prompt }]
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // Extract text from all content blocks (web search returns multiple)
          const text = (parsed.content || [])
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('\n')
            .trim();
          if (!text) {
            console.error('Empty response:', JSON.stringify(parsed).slice(0, 300));
            reject(new Error('Empty response from Claude'));
          } else {
            resolve(text);
          }
        } catch(e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 Auto Blog Generator — ${SITE_CONFIG.siteName}`);
  console.log(`   Domain: ${SITE_CONFIG.domain}`);
  console.log(`   Topic area: ${SITE_CONFIG.topicArea}\n`);

  // 1. Research topic
  const topic = await researchTopics();
  
  // 2. Generate article
  const article = await generateArticle(topic);
  
  // 3. Render to HTML
  const html = renderHTML(article);
  
  // 4. Save article file
  const filePath = path.join(SITE_CONFIG.blogPath, `${article.slug}.html`);
  fs.mkdirSync(SITE_CONFIG.blogPath, { recursive: true });
  fs.writeFileSync(filePath, html);
  console.log(`✅ Article saved: ${filePath}`);
  
  // 5. Update blog index
  updateBlogIndex(article);
  
  // 6. Update sitemap
  updateSitemap(article);
  
  // 7. Git commit
  execSync('git config user.name "blog-bot[bot]"');
  execSync('git config user.email "blog-bot[bot]@users.noreply.github.com"');
  execSync(`git add ${filePath} ${SITE_CONFIG.blogPath}/index.html sitemap.xml 2>/dev/null || true`);
  execSync(`git diff --staged --quiet || git commit -m "feat: auto-publish ${article.slug} [ai-blog-bot]"`);
  execSync('git push origin main');
  console.log(`✅ Committed and pushed`);
  
  // 8. Trigger Netlify deploy
  if (SITE_CONFIG.netlifyHook) {
    const hookReq = https.request(new URL(SITE_CONFIG.netlifyHook), { method: 'POST' });
    hookReq.end();
    console.log(`✅ Netlify deploy triggered`);
  }
  
  console.log(`\n🎉 Done! Article live at: https://${SITE_CONFIG.domain}/blog/${article.slug}`);
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
