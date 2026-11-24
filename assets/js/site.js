/* Express Bilservice, expressbilservice.no. Laget av Velmo.
 * Åpningstidene kommer fra tools/build.mjs som window.SITE.hours (mandag først, null = stengt).
 * Alt innhold er synlig uten skript; skriptet legger bare på status, meny og bevegelse.
 */
(() => {
  const root = document.documentElement;
  const body = document.body;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const make = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SITE = Object.assign({ hours: [] }, window.SITE || {});
  let lenis = null;

  /* ---------- Lys og mørk ---------- */
  const modeBtn = $('[data-mode-toggle]');
  const mode = () => root.dataset.mode || 'light'; // hvit er standard (kundens palett), mørk modus må velges
  const syncMode = () => {
    if (!modeBtn) return;
    const m = mode();
    modeBtn.setAttribute('aria-pressed', String(m === 'dark'));
    modeBtn.setAttribute('aria-label', m === 'dark' ? 'Bytt til lys modus' : 'Bytt til mørk modus');
  };
  if (modeBtn) modeBtn.addEventListener('click', () => {
    const next = mode() === 'dark' ? 'light' : 'dark';
    root.dataset.mode = next;
    try { localStorage.setItem('ebs-mode', next); } catch (e) { /* bytter likevel */ }
    syncMode();
  });

  // Kartet hentes fra OpenStreetMap først når den besøkende ber om det, så ingen tredjepart får IP-adressen før det.
  document.querySelectorAll('[data-map-load]').forEach((btn) => btn.addEventListener('click', () => {
    const f = document.createElement('iframe');
    f.src = btn.dataset.src; f.title = btn.dataset.title; f.referrerPolicy = 'no-referrer';
    const box = btn.closest('[data-map]'); box.replaceChildren(f); f.focus();
  }));

  /* ---------- Bestillingsskjema (/bestill/) ---------- */
  // Fire steg: bil, tjenester, tidspunkt, kontakt, med en oppsummering som fylles ut underveis. Sendes til /api/bestill
  // (Cloudflare Pages Function som sender e-post); finnes ikke serveren (forhåndsvisningen), lages en ferdig utfylt e-post.
  // Uten JS står alle stegene under hverandre og skjemaet postes vanlig. Ligger før bevegelseskoden, så det virker med redusert bevegelse.
  const booking = document.querySelector('[data-booking]');
  if (booking) {
    const steps = [...booking.querySelectorAll('.step')];
    const tabs = [...booking.querySelectorAll('[data-goto]')];
    const prev = booking.querySelector('[data-prev]'), next = booking.querySelector('[data-next]'), send = booking.querySelector('[data-send]');
    const errBox = booking.querySelector('.booking__error'), done = document.querySelector('.booking__done');
    const plate = booking.elements.regnr, melding = booking.elements.melding, melH = booking.querySelector('[data-melding-h]');
    const sendLabel = send.textContent, band = booking.querySelector('.skilt__band').outerHTML;
    const UKE = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
    const MND = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
    const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const cap = (v) => v.charAt(0).toUpperCase() + v.slice(1);
    const today = iso(new Date());
    let at = 0, reached = 0;

    // Dagene: de neste ti hverdagene som knapper (etter kl. 14 starter vi på neste dag). Datofeltet er reserven uten JS.
    booking.querySelector('[data-day-fallback]')?.remove();
    const dag = new Date(); dag.setHours(12, 0, 0, 0);
    if (new Date().getHours() >= 14) dag.setDate(dag.getDate() + 1);
    let days = '<label class="day day--first"><input type="radio" name="dag" value="" checked><span><span class="day__d">Første</span><span class="day__m">ledige tid</span></span></label>';
    for (let n = 0; n < 10; dag.setDate(dag.getDate() + 1)) {
      if (dag.getDay() === 0 || dag.getDay() === 6) continue;
      n += 1;
      const v = iso(dag);
      days += `<label class="day"><input type="radio" name="dag" value="${v}" aria-label="${UKE[dag.getDay()]} ${dag.getDate()}. ${MND[dag.getMonth()]}"><span><span class="day__w">${v === today ? 'i dag' : UKE[dag.getDay()].slice(0, 3)}</span><span class="day__d">${dag.getDate()}</span><span class="day__m">${MND[dag.getMonth()]}</span></span></label>`;
    }
    booking.querySelector('[data-days]').innerHTML = days;

    // Knappene på resten av siden sender med ?tjeneste=, så riktig kort er valgt
    const pre = new URLSearchParams(location.search).get('tjeneste');
    booking.querySelectorAll('input[name="tjenester"]').forEach((c) => { if (pre && c.dataset.slug === pre) c.checked = true; });

    // Skiltnummeret: store bokstaver, og mellomrom etter to bokstaver i vanlige skilt (AB 12345)
    const fmt = (v) => { const t = v.toUpperCase().replace(/[^A-ZÆØÅ0-9]/g, '').slice(0, 8); return /^[A-ZÆØÅ]{2}\d/.test(t) ? `${t.slice(0, 2)} ${t.slice(2)}` : t; };
    plate.addEventListener('input', () => {
      const end = plate.selectionStart === plate.value.length, v = fmt(plate.value);
      if (v !== plate.value) { plate.value = v; if (end) plate.setSelectionRange(v.length, v.length); }
    });

    const data = () => {
      const f = new FormData(booking), g = (k) => String(f.get(k) || '').trim();
      return { tjenester: f.getAll('tjenester'), regnr: g('regnr'), dag: g('dag'), tid: g('tid') || 'Når som helst', navn: g('navn'), telefon: g('telefon'), epost: g('epost'), melding: g('melding'), firma: g('firma') };
    };
    const dagTekst = (v) => { if (!v) return 'første ledige tid'; const d = new Date(`${v}T12:00`); return `${v === today ? 'i dag, ' : ''}${UKE[d.getDay()]} ${d.getDate()}. ${MND[d.getMonth()]}`; };
    const naar = (d) => `${cap(dagTekst(d.dag))}, ${d.tid.charAt(0).toLowerCase()}${d.tid.slice(1)}`;
    const render = () => {
      const d = data();
      const html = `<p class="sum__t">Din bestilling</p>${d.regnr ? `<span class="skilt skilt--s">${band}<span class="skilt__txt">${esc(d.regnr)}</span></span>` : ''}<dl class="sum__l"><div><dt>Tjenester</dt><dd>${d.tjenester.length ? esc(d.tjenester.join(', ')) : '<span class="sum__empty">Ikke valgt ennå</span>'}</dd></div><div><dt>Når</dt><dd>${esc(naar(d))}</dd></div>${d.navn || d.telefon ? `<div><dt>Kontakt</dt><dd>${esc([d.navn, d.telefon].filter(Boolean).join(', '))}</dd></div>` : ''}</dl>`;
      document.querySelectorAll('[data-summary]').forEach((el) => { el.innerHTML = html; });
    };
    const label = () => { next.textContent = at === 0 && !plate.value.trim() ? 'Hopp over' : 'Neste'; };
    const annet = () => {
      const on = !!booking.querySelector('input[name="tjenester"][value="Annet"]:checked');
      melding.required = on; melH.textContent = on ? '(beskriv kort hva det gjelder)' : '(valgfritt)';
    };

    const show = (i, back = false) => {
      at = i; reached = Math.max(reached, i);
      steps.forEach((s, n) => { s.classList.toggle('is-active', n === i); s.classList.toggle('is-back', n === i && back); });
      tabs.forEach((t, n) => {
        if (n === i) t.setAttribute('aria-current', 'step'); else t.removeAttribute('aria-current');
        t.disabled = n > reached; t.parentElement.classList.toggle('is-done', n !== i && n <= reached);
      });
      prev.hidden = i === 0; next.hidden = i === steps.length - 1; send.hidden = i !== steps.length - 1;
      errBox.hidden = true; label();
    };
    const go = (i, back = false) => {
      show(i, back);
      if (booking.getBoundingClientRect().top < 0) booking.scrollIntoView({ block: 'start' });
      steps[i].querySelector('.step__h').focus({ preventScroll: true });
    };
    const msg = { navn: 'Skriv inn navnet ditt.', telefon: 'Skriv inn et telefonnummer vi kan ringe deg på.', epost: 'Skriv inn en gyldig e-postadresse, eller la feltet stå tomt.', melding: 'Beskriv kort hva bilen trenger.' };
    const fail = (t, el) => { errBox.textContent = t; errBox.hidden = false; if (el) el.focus(); };
    const check = (i) => {
      if (i === 0 && plate.value && plate.value.replace(/\s/g, '').length < 2) return ['Skriv hele skiltnummeret, for eksempel AB 12345.', plate];
      if (i === 1 && !booking.querySelector('input[name="tjenester"]:checked')) return ['Velg minst én tjeneste.', booking.querySelector('input[name="tjenester"]')];
      if (i === 3) for (const k of ['navn', 'telefon', 'epost', 'melding']) { const el = booking.elements[k]; if (!el.checkValidity()) return [msg[k], el]; }
      return null;
    };
    const tryTo = (i) => {
      for (let k = Math.min(at, i); k < i; k += 1) { const bad = check(k); if (bad) { if (k !== at) go(k, k < at); return fail(...bad); } }
      go(i, i < at);
    };
    next.addEventListener('click', () => tryTo(at + 1));
    prev.addEventListener('click', () => go(at - 1, true));
    tabs.forEach((t, n) => t.addEventListener('click', () => (n > at ? tryTo(n) : go(n, n < at))));
    booking.addEventListener('input', () => { errBox.hidden = true; label(); render(); });
    booking.addEventListener('change', () => { errBox.hidden = true; annet(); render(); });

    const finish = (d, viaMail) => {
      render();
      done.querySelector('[data-done-h]').textContent = viaMail ? 'Nesten ferdig' : `Takk, ${d.navn.split(' ')[0]}!`;
      done.querySelector('[data-done-text]').textContent = viaMail
        ? `E-posten med bestillingen er klar i e-postprogrammet ditt. Trykk send der, så ringer vi deg på ${d.telefon}.`
        : `Bestillingen er sendt. Vi ringer deg på ${d.telefon} for å bekrefte tiden.`;
      booking.hidden = true; document.querySelector('.booking__sum').hidden = true; done.hidden = false;
      if (done.getBoundingClientRect().top < 0) done.scrollIntoView({ block: 'start' });
      done.focus({ preventScroll: true });
    };
    const mailto = (d) => {
      const subject = `Bestilling: ${d.tjenester.join(', ')}${d.regnr ? ' – ' + d.regnr : ''}`;
      const body = ['Bestilling fra nettsiden', '', `Tjenester: ${d.tjenester.join(', ')}`, `Skiltnummer: ${d.regnr || '-'}`, `Når: ${naar(d)}`, `Navn: ${d.navn}`, `Telefon: ${d.telefon}`, `E-post: ${d.epost || '-'}`, '', 'Hva gjelder det:', d.melding || '-'].join('\n');
      return `mailto:${booking.dataset.mailto}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    };
    booking.addEventListener('submit', async (e) => {
      e.preventDefault(); errBox.hidden = true;
      if (at < steps.length - 1) return tryTo(at + 1); // Enter i et felt går til neste steg
      for (const k of [0, 1, 3]) { const bad = check(k); if (bad) { if (k !== at) go(k, true); return fail(...bad); } }
      const d = data();
      if (d.firma) return;
      send.disabled = true; send.textContent = 'Sender …';
      try {
        const r = await fetch(booking.action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) });
        const j = await r.json().catch(() => null);
        if (r.ok && j && j.ok) return finish(d, false);
        if (r.status === 400 && j && j.error) return fail(j.error);
        throw new Error('ingen server');
      } catch (x) {
        location.href = mailto(d); finish(d, true);
      } finally { send.disabled = false; send.textContent = sendLabel; }
    });
    show(0); annet(); render();
  }
  syncMode();

  /* ---------- Åpent nå, og dagens rad i tabellen ---------- */
  if (Array.isArray(SITE.hours) && SITE.hours.length === 7) {
    const DAYS = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    const today = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday);
    const now = (parseInt(p.hour, 10) % 24) * 60 + parseInt(p.minute, 10);
    const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const kl = (t) => t.replace(':', '.');
    let text = ''; let open = false;
    const h = SITE.hours[today];
    if (h && now >= mins(h[0]) && now < mins(h[1])) { open = true; text = 'Åpent nå, stenger kl. ' + kl(h[1]); }
    else if (h && now < mins(h[0])) text = 'Stengt nå, åpner kl. ' + kl(h[0]);
    else {
      for (let k = 1; k <= 7; k += 1) {
        const d = (today + k) % 7; const x = SITE.hours[d];
        if (x) { text = 'Stengt nå, åpner ' + (k === 1 ? 'i morgen' : DAYS[d]) + ' kl. ' + kl(x[0]); break; }
      }
    }
    $$('[data-status]').forEach((n) => { n.textContent = text; n.hidden = !text; n.classList.toggle('is-open', open); });
    $$('[data-hours]').forEach((dl) => {
      const day = dl.children[today];
      if (!day) return;
      day.classList.add('is-today');
      $('dt', day).append(make('span', 'hours__today', ', i dag'));
    });
  }
  $$('[data-year]').forEach((n) => { n.textContent = String(new Date().getFullYear()); });

  /* ---------- Meny ---------- */
  const burger = $('.burger');
  const menu = $('#meny');
  const setMenu = (open) => {
    if (!burger || !menu) return;
    burger.setAttribute('aria-expanded', String(open));
    $('.burger__label', burger).textContent = open ? 'Lukk' : 'Meny';
    menu.hidden = !open;
    body.classList.toggle('menu-open', open);
    root.style.overflow = open ? 'hidden' : '';
    if (lenis) { if (open) lenis.stop(); else lenis.start(); }
    if (open) {
      const links = $$('a', menu);
      if (window.gsap && !reduce) gsap.fromTo($$('li', menu), { yPercent: 40, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.45, ease: 'power3.out', stagger: 0.04 });
      if (links[0]) links[0].focus({ preventScroll: true });
    }
  };
  if (burger) burger.addEventListener('click', () => setMenu(burger.getAttribute('aria-expanded') !== 'true'));
  if (menu) menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && body.classList.contains('menu-open')) { setMenu(false); burger.focus(); }
    if (e.key === 'Tab' && body.classList.contains('menu-open')) {
      const f = [burger, ...$$('a, button', menu)];
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  });

  /* ---------- Nav, fremdrift og bestillingsknapp på mobil ---------- */
  const nav = $('.nav'); const progress = $('.progress'); const dock = $('.dock'); const foot = $('.foot');
  let lastY = window.scrollY; let ticking = false; let atFoot = false;
  const onScroll = () => {
    const y = window.scrollY; const max = root.scrollHeight - window.innerHeight;
    if (nav) {
      nav.classList.toggle('is-hidden', y > lastY && y > 480 && !body.classList.contains('menu-open') && !nav.contains(document.activeElement));
      nav.classList.toggle('is-solid', nav.hasAttribute('data-solid') || y > 40);
    }
    if (progress) progress.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0) + ')';
    if (dock) { const on = y > window.innerHeight * 0.6 && !atFoot; dock.classList.toggle('is-on', on); dock.inert = !on; }
    lastY = y; ticking = false;
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  if (nav) nav.addEventListener('focusin', () => nav.classList.remove('is-hidden'));
  if (foot && dock && 'IntersectionObserver' in window) new IntersectionObserver(([e]) => { atFoot = e.isIntersecting; onScroll(); }).observe(foot);
  onScroll();

  /* ---------- Video i loop med synlig pauseknapp ---------- */
  $$('[data-loop]').forEach((wrap) => {
    const v = $('video', wrap); const btn = $('[data-loop-toggle]', wrap);
    if (!v || !btn) return;
    let held = reduce; let seen = false;
    const sync = () => {
      if (seen && !held) v.play().catch(() => {}); else v.pause();
      btn.textContent = held ? 'Spill av' : 'Pause';
      btn.setAttribute('aria-pressed', String(!held));
    };
    btn.addEventListener('click', () => { held = !held; sync(); });
    // Videoen lastes ikke før man nærmer seg den (preload="none" i HTML), så den ikke stjeler båndbredde fra toppbildet.
    if ('IntersectionObserver' in window) { const near = new IntersectionObserver(([e]) => { if (e.isIntersecting) { v.preload = 'auto'; near.disconnect(); } }, { rootMargin: '600px 0px' }); near.observe(wrap); }
    if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { seen = e.isIntersecting; sync(); }, { threshold: 0.2 }).observe(wrap);
    else { seen = true; sync(); }
  });

  /* ---------- Rader tennes når de passerer midten ---------- */
  if ('IntersectionObserver' in window) {
    const mid = new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle('is-active', e.isIntersecting)), { rootMargin: '-42% 0px -42% 0px' });
    $$('.row').forEach((r) => mid.observe(r));
  }

  /* ---------- Bevegelse ---------- */
  // Lasteskjermen vises når man kommer utenfra, gardinen når man går mellom sidene. Avgjøres av referrer, så ingenting lagres i nettleseren.
  const still = () => { root.classList.remove('is-first', 'is-nav'); };
  if (!window.gsap || !window.ScrollTrigger || reduce) { still(); return; }
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });
  gsap.defaults({ ease: 'expo.out' });

  if (window.Lenis) {
    // Myk scrolling på hele siden: lav lerp gir en glatt, «flytende» følelse på mus og styreflate.
    // Mobil beholder telefonens egen scrolling (den er allerede myk), men ankerlenker glir også der.
    lenis = new Lenis({ lerp: 0.085, smoothWheel: true, anchors: { offset: -96, duration: 1.3, easing: (x) => 1 - Math.pow(1 - x, 4) } });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  const split = (node, cls = 'w') => {
    const walk = (n) => [...n.childNodes].forEach((c) => {
      if (c.nodeType === 3) {
        const frag = document.createDocumentFragment();
        c.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.append(' '); return; }
          const w = make('span', cls); w.append(make('span', cls + '__i', part)); frag.append(w);
        });
        c.replaceWith(frag);
      } else if (c.nodeType === 1 && c.tagName !== 'BR') walk(c);
    });
    walk(node);
    return $$('.' + cls + '__i', node);
  };

  /* inngang: overskriften løftes ut ord for ord, platen skyves inn, bildet setter seg */
  const heroEl = $('.hero, .phero, .banner');
  const heroWords = heroEl ? $$('[data-split]', heroEl).flatMap((h) => split(h)) : [];
  const intro = gsap.timeline({ paused: true });
  if (heroEl) {
    const media = $('.hero__media img, .phero__media img', heroEl);
    if (media) intro.fromTo(media, { scale: 1.1 }, { scale: 1, duration: 1.8, ease: 'expo.out' }, 0);
    const plate = $('.phero__plate', heroEl);
    if (plate) intro.fromTo(plate, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.85, ease: 'expo.inOut', clearProps: 'clipPath' }, 0.05);
    intro.fromTo(heroWords, { yPercent: 112 }, { yPercent: 0, duration: 0.95, stagger: 0.06 }, plate ? 0.45 : 0.12);
    const ruleEl = $('.hero__rule', heroEl);
    if (ruleEl) intro.fromTo(ruleEl, { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: 'expo.inOut' }, 0.35).add(() => ruleEl.classList.add('is-lit'), 1.25);
    const rest = $$('.hero__say > *, .hero__corner, .phero__plate > :not(h1), .banner__in > :not(h1)', heroEl);
    if (rest.length) intro.fromTo(rest, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, stagger: 0.06, ease: 'power3.out' }, plate ? 0.75 : 0.5);
    if (nav) intro.fromTo(nav, { yPercent: -140 }, { yPercent: 0, duration: 0.8, clearProps: 'transform' }, 0.2);
  }

  const loader = $('.loader'); const curtain = $('.curtain');
  if (root.classList.contains('is-first') && loader) {
    const bar = $('.loader__bar i', loader); const count = $('.loader__count', loader); const n = { v: 0 };
    gsap.timeline({ onComplete: () => { root.classList.remove('is-first'); } })
      .fromTo($$('.loader__word .li', loader), { yPercent: 110 }, { yPercent: 0, duration: 0.7, stagger: 0.08 }, 0)
      .to(bar, { scaleX: 1, duration: 0.95, ease: 'power2.inOut' }, 0.15)
      .to(n, { v: 100, duration: 0.95, ease: 'power2.inOut', onUpdate: () => { count.textContent = String(Math.round(n.v)).padStart(3, '0') + ' %'; } }, 0.15)
      .to(loader, { yPercent: -100, duration: 0.8, ease: 'expo.inOut' }, 1.2)
      .add(() => intro.play(), 1.45);
  } else if (root.classList.contains('is-nav') && curtain) {
    gsap.fromTo(curtain, { scaleY: 1, transformOrigin: '50% 0%' }, { scaleY: 0, duration: 0.7, ease: 'expo.inOut', onComplete: () => { root.classList.remove('is-nav'); gsap.set(curtain, { clearProps: 'all' }); } });
    gsap.delayedCall(0.28, () => intro.play());
  } else { still(); intro.play(); }

  /* overskrifter løftes inn når de kommer til syne */
  $$('[data-split]').filter((h) => !heroEl || !heroEl.contains(h)).forEach((h) => {
    gsap.fromTo(split(h), { yPercent: 112 }, { yPercent: 0, duration: 0.85, stagger: 0.045, scrollTrigger: { trigger: h, start: 'top 88%' } });
  });

  /* blokkene løftes rolig inn */
  $$('[data-stamp]').forEach((p) => {
    gsap.fromTo(p, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, ease: 'expo.out', clearProps: 'transform,opacity', scrollTrigger: { trigger: p, start: 'top 88%' } });
  });

  /* snittkarakteren teller opp med én desimal */
  $$('[data-count-dec]').forEach((n) => {
    const end = parseFloat(n.dataset.countDec.replace(',', '.')); const o = { v: 0 };
    const fmt = (v) => v.toFixed(1).replace('.', ',');
    n.textContent = fmt(0);
    gsap.to(o, { v: end, duration: 1.2, ease: 'power2.out', scrollTrigger: { trigger: n, start: 'top 88%' }, onUpdate: () => { n.textContent = fmt(o.v); } });
  });

  /* bildene avdekkes nedenfra */
  $$('[data-reveal]').forEach((f) => {
    const img = $('img', f); const st = { trigger: f, start: 'top 88%' };
    gsap.fromTo(f, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.05, ease: 'expo.inOut', clearProps: 'clipPath', scrollTrigger: st });
    if (img) gsap.fromTo(img, { scale: 1.16 }, { scale: 1, duration: 1.4, clearProps: 'transform', scrollTrigger: st });
  });

  /* bildet over hele bredden åpner seg fra margen og ut til kanten */
  $$('[data-bleed]').forEach((f) => {
    const img = $('img', f); const st = { trigger: f, start: 'top 82%' };
    const g = () => getComputedStyle($('.container')).paddingLeft;
    gsap.fromTo(f, { clipPath: () => 'inset(7% ' + g() + ' 7% ' + g() + ')' }, { clipPath: 'inset(0% 0px 0% 0px)', duration: 1.3, ease: 'expo.inOut', clearProps: 'clipPath', scrollTrigger: st });
    if (img) gsap.fromTo(img, { scale: 1.18 }, { scale: 1, duration: 1.7, clearProps: 'transform', scrollTrigger: st });
  });

  /* lister og faktarader kommer inn i rekkefølge */
  $$('[data-stagger]').forEach((list) => {
    gsap.fromTo([...list.children], { y: 22, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, stagger: 0.05, ease: 'power3.out', scrollTrigger: { trigger: list, start: 'top 86%' } });
  });

  /* det løpende båndet går av seg selv, lener seg inn i scrollingen og stopper når pekeren står på det */
  $$('.band').forEach((m) => {
    const track = $('.band__track', m); const group = $('.band__group', m);
    let x = 0; let dir = -1; let on = true; let held = false; let W = 0;
    const measure = () => { W = group.offsetWidth + parseFloat(getComputedStyle(track).columnGap || 0); };
    measure(); window.addEventListener('resize', measure); if (document.fonts) document.fonts.ready.then(measure);
    m.addEventListener('mouseenter', () => { held = true; }); m.addEventListener('mouseleave', () => { held = false; });
    new IntersectionObserver(([e]) => { on = e.isIntersecting; }).observe(m);
    gsap.ticker.add(() => {
      if (!on || held || !W) return;
      const v = lenis ? lenis.velocity : 0;
      if (Math.abs(v) > 0.5) dir = v > 0 ? -1 : 1;
      x += dir * (1.1 + Math.min(Math.abs(v) * 0.35, 22));
      if (x <= -W) x += W; if (x > 0) x -= W;
      track.style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,0)';
    });
  });

  /* sitatet fylles inn ord for ord med scrollingen */
  $$('[data-scrub]').forEach((p) => {
    gsap.fromTo(split(p, 'sw'), { opacity: 0.48 }, { opacity: 1, ease: 'none', stagger: 0.1, scrollTrigger: { trigger: p, start: 'top 82%', end: 'bottom 48%', scrub: true } });
  });

  /* telefonnummeret ruller inn tall for tall */
  $$('[data-digits]').forEach((a) => {
    const txt = a.textContent.trim();
    a.setAttribute('aria-label', a.getAttribute('aria-label') || txt);
    a.textContent = '';
    const inner = [...txt].map((c) => { const o = make('span', 'dg'); o.setAttribute('aria-hidden', 'true'); const i = make('span', 'dg__i', c); o.append(i); a.append(o); return i; });
    gsap.fromTo(inner, { yPercent: 105 }, { yPercent: 0, duration: 0.8, stagger: 0.035, scrollTrigger: { trigger: a, start: 'top 88%' } });
  });

  /* tallet i figurplaten */
  $$('[data-count]').forEach((n) => {
    const end = parseInt(n.dataset.count, 10); const suffix = n.dataset.suffix || ''; const o = { v: Math.max(0, end - 24) };
    n.textContent = String(o.v) + suffix;
    gsap.to(o, { v: end, duration: 1.1, ease: 'power2.out', scrollTrigger: { trigger: n, start: 'top 88%' }, onUpdate: () => { n.textContent = String(Math.round(o.v)) + suffix; } });
  });

  /* tjenestene kjøres sideveis mens seksjonen står fast, på alle skjermer */
  const rail = $('.rail');
  if (rail) {
    const vp = $('.rail__viewport', rail); const track = $('.rail__track', rail); const bar = $('.rail__bar i', rail);
    rail.classList.add('is-pinned');
    const dist = () => {
      const cs = getComputedStyle(vp);
      const room = vp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return Math.max(0, track.scrollWidth - room);
    };
    const tween = gsap.to(track, {
      x: () => -dist(), ease: 'none',
      scrollTrigger: { trigger: rail, pin: $('.rail__pin', rail), start: 'top top', end: () => '+=' + Math.round(Math.max(dist(), 1) * 1.15), scrub: 0.6, invalidateOnRefresh: true, anticipatePin: 1,
        onUpdate: (s) => { if (bar) bar.style.transform = 'scaleX(' + s.progress.toFixed(4) + ')'; } },
    });
    track.addEventListener('focusin', (e) => {
      const p = e.target.closest('.panel'); const st = tween.scrollTrigger; const d = dist();
      if (!p || !st || !d) return;
      const target = st.start + (st.end - st.start) * Math.min(1, Math.max(0, p.offsetLeft / d));
      if (lenis) lenis.scrollTo(target, { immediate: true }); else window.scrollTo(0, target);
    });
  }

  /* navnet i bunnteksten reiser seg bokstav for bokstav */
  const mast = $('.foot__mast');
  if (mast) {
    $$(':scope > span', mast).forEach((line) => {
      const t = line.textContent; line.textContent = '';
      const chars = [...t].map((c) => { const s = make('span', 'ch', c === ' ' ? ' ' : c); line.append(s); return s; });
      gsap.fromTo(chars, { yPercent: 105 }, { yPercent: 0, duration: 0.9, stagger: 0.03, scrollTrigger: { trigger: mast, start: 'top 94%' } });
    });
  }

  /* gardin mellom sidene */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || !curtain || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (!/^https?:$/.test(url.protocol) || url.origin !== location.origin || url.pathname === location.pathname) return;
    e.preventDefault();
    curtain.classList.add('is-on');
    gsap.fromTo(curtain, { scaleY: 0, transformOrigin: '50% 100%' }, { scaleY: 1, duration: 0.55, ease: 'expo.inOut', onComplete: () => { location.href = url.href; } });
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted && curtain) { curtain.classList.remove('is-on'); gsap.set(curtain, { clearProps: 'all' }); root.classList.remove('is-nav'); } });

  window.addEventListener('load', () => ScrollTrigger.refresh());
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
})();
