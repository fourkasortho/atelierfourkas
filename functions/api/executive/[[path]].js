// Cloudflare Pages Function for the Executive «Ρωτήστε μας» form.
//
//   POST /api/executive          visitor submits name, surname, area, email
//                                -> the practice gets an email with an «Έγκριση» link
//   GET  /api/executive/approve  the practice opens the link and sees the request and a send button
//   POST /api/executive/approve  pressing the button sends the Executive Protocol text to the visitor
//
// Nothing is stored: the approval link carries the request, signed with HMAC so it cannot be forged.
// The GET only shows a page (mail scanners that open links never send anything); sending needs the button.
//
// Needs, in Cloudflare:
//   - Workers Paid plan, and atelierfourkas.com onboarded in Email Service > Email Sending
//   - Pages secret CF_EMAIL_TOKEN: an API token allowed to send email (also used as the signing key)
//   - optional variable CF_ACCOUNT_ID (defaults to the account below)
//   Secrets only reach the site on the next deployment: after changing CF_EMAIL_TOKEN, redeploy.

const ACCOUNT_ID = '353bc0840f8f901e8c693d6e453d29db';
const SITE = 'https://atelierfourkas.com';
const FROM = { address: 'executive@atelierfourkas.com', name: 'Atelier Ορθοδοντικής Φούρκα' };
const OWNER = 'fourkas@outlook.com'; // Reply-To on the info email; also receives the approval email
// Extra approval recipients: Pages variable APPROVER_EMAILS (comma-separated).
const approvers = (env) => [OWNER, ...String(env.APPROVER_EMAILS || '').split(',').map((x) => x.trim()).filter(Boolean)];
const LINK_DAYS = 14;

const COPY = {
  el: {
    subject: 'Executive Protocol · Atelier Ορθοδοντικής Φούρκα',
    hello: () => 'Καλημέρα σας,',
    thanks: 'Σας ευχαριστούμε για το ενδιαφέρον σας.',
    intro: 'Το Executive Protocol είναι ένα πρωτόκολλο θεραπείας για ενήλικες με γεμάτο πρόγραμμα: αόρατη θεραπεία, λίγες επισκέψεις, και ένας άνθρωπος που γνωρίζει την περίπτωσή σας και απαντά στο τηλέφωνό σας.',
    items: [
      ['Αόρατη θεραπεία', 'Διαφανείς νάρθηκες (ICTINUS) ή γλωσσικά brackets (Alias). Κανείς απέναντί σας στο τραπέζι δεν το καταλαβαίνει.'],
      ['Παρακολούθηση από το κινητό σας', 'Στέλνετε λίγες φωτογραφίες σε τακτά διαστήματα. Ο ορθοδοντικός τις εξετάζει, ώστε οι επισκέψεις στο ιατρείο να είναι μόνο οι απαραίτητες.'],
      ['Επισκέψεις εκτός ωραρίου', 'Νωρίς το πρωί ή το βράδυ, σύντομες και στην ώρα τους, ώστε να χωρούν γύρω από τη δουλειά σας.'],
      ['Προσωπική συντονίστρια', 'Ένας άνθρωπος κανονίζει κάθε ραντεβού, κάθε αλλαγή και κάθε απορία. Έχετε το απευθείας τηλέφωνό της.'],
    ],
    kit: 'Την πρώτη μέρα παραλαμβάνετε δερμάτινη θήκη για τους νάρθηκες και μια κάρτα με το προσωπικό τηλέφωνο της συντονίστριάς σας.',
    five: 'Οι θέσεις του Executive Protocol είναι μέρος των πέντε νέων θεραπειών που ξεκινούν κάθε μήνα στο Atelier.',
    next: 'Για μια πρώτη γνωριμία, απαντήστε σε αυτό το email ή καλέστε στο 210 623 3398.',
    sign: ['Atelier Ορθοδοντικής Φούρκα', 'Κυριαζή 6, 145 62 Κηφισιά', 'fourkas@outlook.com · atelierfourkas.com'],
  },
  en: {
    subject: 'Executive Protocol · Atelier Fourkas Orthodontics',
    hello: (n) => `Dear ${n},`,
    thanks: 'Thank you for your interest.',
    intro: 'The Executive Protocol is a treatment protocol for adults whose diary is full: invisible treatment, few visits, and a single person who knows your case and answers your call.',
    items: [
      ['Invisible', 'Clear aligners (ICTINUS) or lingual brackets (Alias). Nobody across the table can tell.'],
      ['Followed from your phone', 'You send a few photographs at set intervals. The orthodontist reviews them, so the chair visits are only the necessary ones.'],
      ['Outside office hours', 'Visits early in the morning or in the evening, short and on time, so they fit around your working day.'],
      ['A personal coordinator', 'One person arranges every appointment, every change and every question. You have her direct number.'],
    ],
    kit: "On the first day you receive a leather aligner case and a card with your coordinator's personal number.",
    five: 'Executive Protocol places are part of the five new treatments that begin at the Atelier each month.',
    next: 'For a first meeting, reply to this email or call +30 210 623 3398.',
    sign: ['Atelier · Fourkas Orthodontics', '6 Kyriazi St, 145 62 Kifisia, Greece', 'fourkas@outlook.com · atelierfourkas.com'],
  },
};
const ROMAN = ['I', 'II', 'III', 'IV'];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (v, max = 80) => String(v || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

export function buildReply(req) {
  const c = COPY[req.lang] || COPY.el;
  const name = `${req.first} ${req.last}`.trim();
  const text = [c.hello(name), '', c.thanks, '', c.intro, '',
    ...c.items.flatMap(([h, p], i) => [`${ROMAN[i]}. ${h}`, p, '']),
    c.kit, '', c.five, '', c.next, '', '—', ...c.sign].join('\n');
  const sans = 'font-family:Helvetica,Arial,sans-serif';
  const html = `<!doctype html><html lang="${req.lang === 'en' ? 'en' : 'el'}"><body style="margin:0;background:#0E0D0C">
<div style="max-width:560px;margin:0 auto;padding:40px 28px;font-family:Georgia,'Times New Roman',serif;color:#ECE6DA;background:#0E0D0C">
<div style="font-size:12px;letter-spacing:.3em;color:#B8933A">EXECUTIVE PROTOCOL</div>
<p style="font-size:22px;line-height:1.3;margin:18px 0 6px">${esc(c.hello(name))}</p>
<p style="${sans};font-size:15px;line-height:1.7;color:#BDB6A9;margin:0 0 12px">${c.thanks}</p>
<p style="${sans};font-size:15px;line-height:1.7;color:#BDB6A9">${c.intro}</p>
${c.items.map(([h, p], i) => `<div style="border-top:1px solid #2A2825;padding:16px 0"><div style="font-size:18px"><span style="color:#B8933A;font-size:13px;letter-spacing:.12em;margin-right:12px">${ROMAN[i]}</span>${h}</div><div style="${sans};font-size:14px;line-height:1.6;color:#8F887C;margin-top:4px">${p}</div></div>`).join('\n')}
<p style="${sans};font-size:14px;line-height:1.6;color:#8F887C;border-left:1px solid #B8933A;padding-left:14px;margin:22px 0">${c.kit}</p>
<p style="${sans};font-size:14px;line-height:1.6;color:#8F887C">${c.five}</p>
<p style="${sans};font-size:15px;line-height:1.6;color:#ECE6DA;margin-top:22px">${c.next}</p>
<div style="border-top:1px solid #2A2825;margin-top:30px;padding-top:16px;${sans};font-size:12px;line-height:1.7;color:#8F887C">${c.sign.join('<br>')}</div>
</div></body></html>`;
  return { subject: c.subject, text, html };
}

// ---- signing (HMAC-SHA256, key = CF_EMAIL_TOKEN) ----
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
export async function sign(secret, req) {
  const body = b64u(enc.encode(JSON.stringify(req)));
  return `${body}.${await hmac(secret, body)}`;
}
export async function verify(secret, token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const want = await hmac(secret, body);
  if (want.length !== sig.length) return null;
  let diff = 0; for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff) return null;
  const req = JSON.parse(new TextDecoder().decode(unb64u(body)));
  if (Date.now() - req.ts > LINK_DAYS * 864e5) return null;
  return req;
}

async function sendMail(env, msg) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID || ACCOUNT_ID}/email/sending/send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.CF_EMAIL_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: FROM, ...msg }),
  });
  if (!res.ok) console.log('email send failed', res.status, (await res.text()).slice(0, 500));
  return res.ok;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const page = (title, inner, status = 200) => new Response(`<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{margin:0;background:#0E0D0C;color:#ECE6DA;font:300 17px/1.6 Helvetica,Arial,sans-serif}main{max-width:520px;margin:0 auto;padding:48px 22px}h1{font:400 28px/1.2 Georgia,serif;margin:0 0 22px}.k{font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#B8933A;margin-bottom:16px}dl{margin:0 0 28px;border-top:1px solid #2A2825}dt{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#8F887C;margin-top:14px}dd{margin:2px 0 12px;font-size:18px;word-break:break-word}button{all:unset;cursor:pointer;display:block;width:100%;box-sizing:border-box;text-align:center;background:#E9B422;color:#0E0D0C;padding:18px;font-size:13px;letter-spacing:.24em;text-transform:uppercase}p{color:#BDB6A9}</style></head>
<body><main><div class="k">Executive Protocol</div>${inner}</main></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

function details(r) {
  return `<dl><dt>Όνομα</dt><dd>${esc(r.first)}</dd><dt>Επώνυμο</dt><dd>${esc(r.last)}</dd><dt>Περιοχή</dt><dd>${esc(r.area)}</dd><dt>Email</dt><dd>${esc(r.email)}</dd><dt>Γλώσσα απάντησης</dt><dd>${r.lang === 'en' ? 'English' : 'Ελληνικά'}</dd></dl>`;
}

async function submit(request, env) {
  let d;
  try { d = await request.json(); } catch { return json({ ok: false, error: 'body' }, 400); }
  if (d.botcheck) return json({ ok: true });
  const r = { first: clean(d.first), last: clean(d.last), area: clean(d.area), email: clean(d.email, 200).toLowerCase(), lang: d.lang === 'en' ? 'en' : 'el', ts: Date.now() };
  if (!r.first || !r.last || !r.area || !/^[^\s@<>",;]+@[^\s@<>",;]+\.[a-z]{2,}$/i.test(r.email)) return json({ ok: false, error: 'fields' }, 400);
  if (!env.CF_EMAIL_TOKEN) return json({ ok: false, error: 'not-configured' }, 503);
  const link = `${SITE}/api/executive/approve?t=${await sign(env.CF_EMAIL_TOKEN, r)}`;
  const rows = [['Όνομα', r.first], ['Επώνυμο', r.last], ['Περιοχή', r.area], ['Email', r.email]];
  const ok = await sendMail(env, {
    to: approvers(env),
    reply_to: r.email,
    subject: `Executive Protocol · ${r.first} ${r.last} · ${r.area}`,
    text: `Νέο αίτημα πληροφοριών για το Executive Protocol.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nΓια να σταλεί η αυτόματη απάντηση, ανοίξτε τον σύνδεσμο, τσεκάρετε την επιβεβαίωση και πατήστε «Αποστολή» (ισχύει 14 ημέρες, μία φορά):\n${link}\n\nΑν δεν εγκρίνετε, απλώς αγνοήστε αυτό το email.`,
    html: `<div style="font:15px/1.6 Helvetica,Arial,sans-serif;color:#1a1a1a;max-width:520px"><p style="font-size:12px;letter-spacing:.2em;color:#8a6d1f">EXECUTIVE PROTOCOL · ΝΕΟ ΑΙΤΗΜΑ</p><table style="border-collapse:collapse;margin:12px 0 24px">${rows.map(([k, v]) => `<tr><td style="padding:4px 18px 4px 0;color:#777">${k}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join('')}</table><p><a href="${link}" style="display:inline-block;background:#E9B422;color:#0E0D0C;text-decoration:none;padding:14px 26px;letter-spacing:.18em;font-size:13px">ΕΓΚΡΙΣΗ</a></p><p style="color:#777;font-size:13px">Ο σύνδεσμος ανοίγει μια σελίδα με τα στοιχεία. Η απάντηση φεύγει μόνο όταν τσεκάρετε την επιβεβαίωση και πατήσετε «Αποστολή», μία φορά. Ισχύει 14 ημέρες. Αν δεν εγκρίνετε, αγνοήστε αυτό το email.</p></div>`,
  });
  return ok ? json({ ok: true }) : json({ ok: false, error: 'send' }, 502);
}

// Best-effort single use: remember sent links in the edge cache (per data centre) for the link lifetime.
const usedKey = (token) => new Request(`${SITE}/__executive_used/${encodeURIComponent(String(token).split('.')[1] || '')}`);
async function wasUsed(token) { try { return !!(await caches.default.match(usedKey(token))); } catch { return false; } }
async function markUsed(token) {
  try { await caches.default.put(usedKey(token), new Response('1', { headers: { 'cache-control': `public, max-age=${LINK_DAYS * 86400}` } })); } catch {}
}

async function approve(request, env, url) {
  if (!env.CF_EMAIL_TOKEN) return page('Executive', '<h1>Η υπηρεσία δεν έχει ρυθμιστεί.</h1>', 503);
  const form = request.method === 'POST' ? await request.formData() : null;
  const token = form ? form.get('t') : url.searchParams.get('t');
  const r = await verify(env.CF_EMAIL_TOKEN, token).catch(() => null);
  if (!r) return page('Executive', '<h1>Ο σύνδεσμος δεν ισχύει ή έχει λήξει.</h1>', 400);
  const used = await wasUsed(token);
  if (request.method !== 'POST') {
    if (used) return page('Executive', `<h1>Έχει ήδη σταλεί.</h1><p>Οι πληροφορίες στάλθηκαν ήδη στο ${esc(r.email)}.</p>${details(r)}`);
    // Two deliberate steps (tick + press), and the form only gets its token from a real click,
    // so mail-security scanners that open links or submit forms cannot send anything.
    return page('Έγκριση · Executive', `<h1>Να σταλούν οι πληροφορίες του Executive Protocol;</h1>${details(r)}
<form method="post" id="f"><input type="hidden" name="h" value=""><input type="hidden" name="t" value="">
<label style="display:flex;gap:12px;align-items:flex-start;margin:0 0 22px;font-size:16px;color:#BDB6A9;text-transform:none;letter-spacing:0"><input type="checkbox" id="c" style="width:22px;height:22px;accent-color:#E9B422;margin-top:2px"> Επιβεβαιώνω την αποστολή στο ${esc(r.email)}</label>
<button type="submit" id="b" disabled style="opacity:.4">Αποστολή</button></form>
<script>var c=document.getElementById('c'),b=document.getElementById('b'),f=document.getElementById('f');
c.onchange=function(){b.disabled=!c.checked;b.style.opacity=c.checked?1:.4};
f.onsubmit=function(e){if(!e.isTrusted||!c.checked){e.preventDefault();return}f.t.value=${JSON.stringify(String(token))};f.h.value='1';b.disabled=true;b.textContent='Αποστολή…'};</script>`);
  }
  if (form.get('h') !== '1') return page('Executive', '<h1>Δεν στάλθηκε.</h1><p>Ανοίξτε ξανά τον σύνδεσμο, τσεκάρετε την επιβεβαίωση και πατήστε «Αποστολή».</p>', 400);
  if (used) return page('Executive', `<h1>Έχει ήδη σταλεί.</h1><p>Οι πληροφορίες στάλθηκαν ήδη στο ${esc(r.email)}.</p>`);
  const msg = buildReply(r);
  const ok = await sendMail(env, { to: r.email, reply_to: OWNER, ...msg });
  console.log('executive approve', ok ? 'sent' : 'failed', new Date(r.ts).toISOString(), request.headers.get('user-agent'));
  if (ok) await markUsed(token);
  return ok
    ? page('Εστάλη · Executive', `<h1>Εστάλη.</h1><p>Οι πληροφορίες για το Executive Protocol στάλθηκαν στο ${esc(r.email)}.</p>`)
    : page('Σφάλμα · Executive', '<h1>Η αποστολή απέτυχε.</h1><p>Δοκιμάστε ξανά σε λίγο από τον ίδιο σύνδεσμο.</p>', 502);
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '/api/executive' && request.method === 'POST') return submit(request, env);
  if (path === '/api/executive/approve' && (request.method === 'GET' || request.method === 'POST')) return approve(request, env, url);
  return new Response('Not found', { status: 404 });
}
